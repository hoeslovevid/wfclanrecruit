import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import { Transform } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword, newToken, verifyPassword } from "./auth.js";
import { initStorage, paths, postgresEnabled, readDb, storageLabel, writeDb, closePg } from "./db.js";
import { rateLimit } from "./ratelimit.js";
import {
  HEARTBEAT_MS,
  KEEP_MINUTES,
  STATUSES,
  forget as forgetPresence,
  keepUntil,
  listingPresence,
  normalizeStatus,
  presenceOf,
  touch as touchPresence,
} from "./presence.js";
import { inspectDiscordInvite, listingsNeedingInviteCheck, applyInviteCheck, INVITE_RECHECK_GAP_MS } from "./invite.js";
import {
  REPORT_REASONS,
  activityAt as listingActivity,
  applyAllianceRoster,
  listingConflict,
  whisperName,
  withListingState,
} from "./listing.js";
import { aboutTooLong, normalizeAbout, plainTextFromHtml } from "../src/richtext.js";
import { normalizeContact, wantsDiscord } from "../src/data.js";
import {
  FLUSH_MS,
  addStats,
  countView,
  countWhisper,
  drain,
  looksLikeBot,
  pendingCount,
  recentStats,
} from "./stats.js";
import {
  RECRUITER_MAX,
  bestPresence,
  inviteBlocker,
  listingContacts,
  normalizeRecruiters,
  pendingInvitesFor,
  recruiterEntry,
  recruitingOn,
} from "./recruiters.js";
import {
  DISCORD_MIN_AGE_DAYS,
  FORUM_CHECK_COOLDOWN_MS,
  discordAgeDays,
  discordConfigured,
  listingCreateWait,
  newForumToken,
  normalizeForumUrl,
  ingameName,
  forumNameFromUrl,
  profileHasToken,
  publicAccount,
  publishGate,
  readForumProfile,
  uniqueDiscordUsername,
} from "./verify.js";
import {
  applySocialMeta,
  defaultSocial,
  listingFromPath,
  listingSocial,
  robotsTxt,
  sitemapXml,
} from "./meta.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = "wfr_session";
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || (isProd ? 3001 : 5173));
const TIER_CAPS = {
  Ghost: 10,
  Shadow: 30,
  Storm: 100,
  Mountain: 300,
  Moon: 1000,
};

const IMAGE_MAX = 2 * 1024 * 1024;
const VIDEO_MAX = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".m4v", ".mov"]);
const EXT_BY_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

const MAX_BY_FIELD = { image: IMAGE_MAX, video: VIDEO_MAX };

// multer only supports one global fileSize limit, so count bytes per field and
// abort the stream as soon as a field passes its own cap.
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, paths.uploadDir),
  filename: (_req, file, cb) => {
    // Never trust originalname: a .html name with an image MIME used to be
    // written verbatim and then served as text/html from our own origin.
    const ext = EXT_BY_TYPE[file.mimetype] || ".bin";
    cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`);
  },
});

const cappedStorage = {
  _handleFile(req, file, cb) {
    const cap = MAX_BY_FIELD[file.fieldname] ?? IMAGE_MAX;
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _enc, next) {
        bytes += chunk.length;
        if (bytes > cap) {
          next(Object.assign(new Error("File too large."), { code: "LIMIT_FILE_SIZE", field: file.fieldname }));
          return;
        }
        next(null, chunk);
      },
    });
    // multer 2 exposes file.stream read-only, so hand the disk engine a
    // prototype-linked view whose stream is the counted one.
    const counted = Object.create(file, {
      stream: { value: file.stream.pipe(counter), configurable: true },
    });
    diskStorage._handleFile(req, counted, cb);
  },
  _removeFile(req, file, cb) {
    diskStorage._removeFile(req, file, cb);
  },
};

const upload = multer({
  storage: cappedStorage,
  limits: { fileSize: VIDEO_MAX, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (file.fieldname === "image") {
      const ok = IMAGE_TYPES.has(file.mimetype) && IMAGE_EXTS.has(ext);
      cb(ok ? null : new Error("Image must be PNG, JPG, WEBP, or GIF."), ok);
      return;
    }
    if (file.fieldname === "video") {
      const ok = VIDEO_TYPES.has(file.mimetype) && VIDEO_EXTS.has(ext);
      cb(ok ? null : new Error("Video must be MP4 or WEBM."), ok);
      return;
    }
    cb(new Error("Unexpected file."), false);
  },
});

const listingUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(
  "/uploads",
  express.static(paths.uploadDir, {
    setHeaders: (res) => {
      // Defence in depth: even if an active-content file reaches this dir it
      // must not execute against our origin.
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    },
  })
);
app.use("/images", express.static(path.join(root, "..", "public", "images")));

function currentUser(req) {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const db = readDb();
  const session = db.sessions.find((item) => item.token === token && item.expires > Date.now());
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) ?? null;
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (!user.admin) {
    res.status(403).json({ error: "Admin only." });
    return;
  }
  req.user = user;
  next();
}

function requirePoster(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in with Discord to continue." });
    return;
  }
  req.user = user;
  const gate = publishGate(user, { isProd });
  if (!gate.ok) {
    res.status(403).json({ error: gate.message, code: gate.reason });
    return;
  }
  next();
}

const registerLimiter = rateLimit({ name: "register", limit: 5, windowMs: 60 * 60 * 1000 });
const discordStartLimiter = rateLimit({ name: "discord-start", limit: 20, windowMs: 15 * 60 * 1000 });
const exportLimiter = rateLimit({ name: "export", limit: 10, windowMs: 60 * 60 * 1000 });
const listingLimiter = rateLimit({ name: "listing", limit: 20, windowMs: 60 * 60 * 1000 });
const reportLimiter = rateLimit({
  name: "report",
  limit: 8,
  windowMs: 60 * 60 * 1000,
  message: "Too many reports. Try again later.",
});
const forumCheckLimiter = rateLimit({
  name: "forum-check",
  limit: 10,
  windowMs: 10 * 60 * 1000,
  message: "Too many verification checks. Wait a few minutes and try again.",
});
const loginLimiter = rateLimit({
  name: "login",
  limit: 5,
  windowMs: 15 * 60 * 1000,
  keyOn: (req) => String(req.body?.username || "").toLowerCase(),
  message: "Too many sign-in attempts. Try again in a few minutes.",
});
const loginIpLimiter = rateLimit({
  name: "login-ip",
  limit: 30,
  windowMs: 15 * 60 * 1000,
  message: "Too many sign-in attempts. Try again in a few minutes.",
});

function canRemove(user, listing) {
  return Boolean(user.admin) || listing.ownerId === user.id;
}

function publicOrigin(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  // #9: x-forwarded-host is caller-controlled, so only honour it when it is a
  // host we already trust. Otherwise fall back to the socket's own host.
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const forwarded = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const candidate = forwarded ? `${proto}://${forwarded}` : "";
  if (candidate && configuredOrigins().has(candidate)) return candidate;
  return `${proto}://${req.get("host")}`;
}

function discordRedirectUri(req) {
  return process.env.DISCORD_REDIRECT_URI || `${publicOrigin(req)}/api/auth/discord/callback`;
}

function safeNextPath(value) {
  const next = String(value || "/account");
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/account";
  return next.slice(0, 180);
}

const OAUTH_COOKIE = "wfr_oauth";

function encodeOauth(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeOauth(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

const BUMP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function activityAt(item) {
  return listingActivity(item);
}

function bumpWaitMessage(item) {
  const elapsed = Date.now() - new Date(activityAt(item)).getTime();
  const wait = BUMP_COOLDOWN_MS - elapsed;
  if (wait <= 0) return null;
  const hours = Math.max(1, Math.ceil(wait / (60 * 60 * 1000)));
  return `You can bump this post again in ${hours} hour${hours === 1 ? "" : "s"}.`;
}

function withBumpState(item) {
  const readyAt = new Date(new Date(activityAt(item)).getTime() + BUMP_COOLDOWN_MS).toISOString();
  return withListingState({
    ...item,
    canBump: Date.now() >= new Date(readyAt).getTime(),
    bumpReadyAt: readyAt,
  });
}

function listingFile(req, name) {
  return req.files?.[name]?.[0] || null;
}

function discardUploads(req) {
  for (const list of Object.values(req.files || {})) {
    for (const file of list || []) {
      fs.rmSync(file.path, { force: true });
    }
  }
}

function removeStoredFile(url) {
  if (url?.startsWith("/uploads/")) {
    fs.rmSync(path.join(paths.uploadDir, path.basename(url)), { force: true });
  }
}

function savedUpload(file) {
  return file ? `/uploads/${file.filename}` : null;
}

function nextImage(existing, file) {
  if (!file) return existing ?? null;
  removeStoredFile(existing);
  return savedUpload(file);
}

function nextVideo(existing, file, remove) {
  if (file) {
    removeStoredFile(existing);
    return savedUpload(file);
  }
  if (String(remove || "") === "1") {
    removeStoredFile(existing);
    return null;
  }
  return existing ?? null;
}

function assertListingFiles(req, res) {
  const image = listingFile(req, "image");
  const video = listingFile(req, "video");
  if (image && image.size > IMAGE_MAX) {
    discardUploads(req);
    res.status(400).json({ error: "Image must be 2 MB or smaller." });
    return false;
  }
  if (video && video.size > VIDEO_MAX) {
    discardUploads(req);
    res.status(400).json({ error: "Video must be 25 MB or smaller." });
    return false;
  }
  return true;
}

function parseClanBody(body, user) {
  const playstyles = asArray(body.playstyles);
  const members = Number(body.members);
  const mrRequired = Number(body.mrRequired || 0);
  const tier = String(body.tier || "");
  const allianceId = String(body.allianceId || "") || null;

  if (!body.name || !body.tag || !body.headline || !body.summary) {
    return { error: "Fill every required field." };
  }
  const about = normalizeAbout(body.about);
  if (!plainTextFromHtml(about)) {
    return { error: "Write the full post." };
  }
  const tooLong = aboutTooLong(about);
  if (tooLong) return { error: tooLong };
  if (playstyles.length === 0) {
    return { error: "Pick at least one playstyle." };
  }
  const contact = normalizeContact(body.contact);
  if (wantsDiscord({ contact }) && !validateDiscord(body.discord)) {
    return { error: "Use a discord.gg or discord.com/invite link." };
  }
  // A whisper-only listing whose owner has no verified forum name would show no
  // way to reach anyone at all.
  if (!wantsDiscord({ contact }) && !user.forumName) {
    return { error: "Verify your Warframe Forum profile before you post a whisper-only listing." };
  }
  if (!TIER_CAPS[tier]) {
    return { error: "Choose a valid clan tier." };
  }
  if (!Number.isFinite(members) || members < 1 || members > TIER_CAPS[tier]) {
    return { error: `${tier} clans cap at ${TIER_CAPS[tier]} members.` };
  }

  return {
    fields: {
      name: String(body.name).slice(0, 48),
      tag: String(body.tag).toUpperCase().slice(0, 5),
      platform: String(body.platform || "PC"),
      tier,
      members,
      mrRequired: Math.max(0, Math.min(36, mrRequired)),
      playstyles,
      region: String(body.region || "Global"),
      language: String(body.language || "English"),
      status: String(body.status || "Open"),
      leader: String(body.leader || user.forumName || user.username).slice(0, 32),
      contact,
      discord: wantsDiscord({ contact }) ? String(body.discord) : "",
      paused: String(body.paused || "") === "1" || body.paused === true || body.paused === "true",
      founded: String(body.founded || new Date().getFullYear()),
      allianceId,
      headline: String(body.headline).slice(0, 90),
      summary: String(body.summary).slice(0, 220),
      about,
      offering: lines(body.offering),
      requirements: lines(body.requirements),
    },
  };
}

function parseAllianceBody(body) {
  const platforms = asArray(body.platforms);
  const clanCount = Number(body.clanCount);
  const members = Number(body.members);

  if (!body.name || !body.tag || !body.headline || !body.summary) {
    return { error: "Fill every required field." };
  }
  const about = normalizeAbout(body.about);
  if (!plainTextFromHtml(about)) {
    return { error: "Write the full post." };
  }
  const tooLong = aboutTooLong(about);
  if (tooLong) return { error: tooLong };
  if (platforms.length === 0) {
    return { error: "Pick at least one platform." };
  }
  if (!validateDiscord(body.discord)) {
    return { error: "Use a discord.gg or discord.com/invite link." };
  }
  if (!Number.isFinite(clanCount) || clanCount < 1) {
    return { error: "Enter how many clans are in the alliance." };
  }

  return {
    fields: {
      name: String(body.name).slice(0, 48),
      tag: String(body.tag).toUpperCase().slice(0, 5),
      platforms,
      region: String(body.region || "Global"),
      language: String(body.language || "English"),
      status: String(body.status || "Open"),
      clanCount,
      members: Number.isFinite(members) ? members : 0,
      discord: String(body.discord),
      paused: String(body.paused || "") === "1" || body.paused === true || body.paused === "true",
      rosterIds: asArray(body.rosterIds),
      headline: String(body.headline).slice(0, 90),
      summary: String(body.summary).slice(0, 220),
      about,
      offering: lines(body.offering),
      requirements: lines(body.requirements),
    },
  };
}

function configuredOrigins() {
  const list = [
    process.env.PUBLIC_URL,
    process.env.FRONTEND_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
  ];
  if (!isProd) {
    list.push(
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3001",
      "http://127.0.0.1:3001"
    );
  }
  return new Set(list.filter(Boolean).map((item) => String(item).replace(/\/$/, "")));
}

// #7: this used to allow any origin ending in .railway.app with credentials,
// so any tenant on the shared domain was a trusted origin.
function allowedOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }
  callback(null, configuredOrigins().has(origin.replace(/\/$/, "")));
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/",
  };
}

function setSession(res, token) {
  res.cookie(COOKIE, token, cookieOptions());
}

function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "listing"}-${Date.now().toString(36)}`;
}

function lines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean);
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* ignore */
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateDiscord(url) {
  return /^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i.test(String(url || ""));
}

async function attachInvite(fields) {
  // A whisper-only listing carries no invite, so there is nothing to check.
  if (!fields.discord) return fields;
  const invite = await inspectDiscordInvite(fields.discord);
  if (!invite.ok) return { error: invite.error };
  return {
    ...fields,
    discord: invite.url,
    inviteOk: true,
    inviteCheckedAt: invite.checkedAt,
  };
}

function sortListings(a, b) {
  if (a.recruiting !== b.recruiting) return a.recruiting ? -1 : 1;
  return new Date(activityAt(b)) - new Date(activityAt(a));
}

function listingTaken(db, fields) {
  return listingConflict([...(db.clans || []), ...(db.alliances || [])], fields);
}

function decorateClan(clan, db) {
  const alliance = db.alliances.find((item) => item.id === clan.allianceId);
  const contacts = listingContacts(clan, db.users, presenceOf);
  // `recruiters` carries user ids and pending invites. Accepted recruiters are
  // already public through `contacts`; a pending one has not agreed to be named
  // yet, so the raw roster never leaves the server.
  // `stats` is the owner's business, not a competitor's.
  const { recruiters, stats, ...publicClan } = clan;
  return withBumpState({
    ...publicClan,
    allianceName: alliance?.name || null,
    allianceTag: alliance?.tag || null,
    whisperName: whisperName(clan, db.users),
    contacts,
    ...bestPresence(contacts),
  });
}

// The owner's view of the roster: pending invites included, keyed by username
// so the owner recognises who they invited.
// Owners (and admins) see their own numbers; nobody else does.
function withOwnerStats(decorated, raw, user) {
  if (!user || !canRemove(user, raw)) return decorated;
  return { ...decorated, stats: raw.stats || null, recent: recentStats(raw.stats) };
}

function rosterFor(clan, db) {
  return normalizeRecruiters(clan.recruiters).map((entry) => {
    const user = (db.users || []).find((item) => item.id === entry.userId);
    return {
      userId: entry.userId,
      username: user?.username || "(deleted account)",
      forumName: user?.forumName || null,
      status: entry.status,
    };
  });
}

function decorateAlliance(alliance, db) {
  return withBumpState({
    ...alliance,
    ...listingPresence(alliance, db.users),
    memberClans: (db.clans || [])
      .filter((clan) => clan.allianceId === alliance.id)
      .map((clan) => decorateClan(clan, db)),
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "WF Clan Recruit", storage: postgresEnabled() ? "postgres" : "file" });
});

app.get("/api/auth/me", (req, res) => {
  const user = currentUser(req);
  const account = publicAccount(user, { isProd });
  res.json({
    user: account
      ? {
          ...account,
          presence: presenceOf(user),
          keepMinutes: KEEP_MINUTES,
          invites: pendingInvitesFor(readDb(), user.id),
          recruitingOn: recruitingOn(readDb(), user.id),
        }
      : null,
    auth: {
      discord: discordConfigured(),
      minAgeDays: DISCORD_MIN_AGE_DAYS,
      passwordRegister: !isProd,
    },
  });
});

// A heartbeat only writes to the in-memory map in presence.js, so this is
// cheap enough to allow generously - the limit is here to stop a stuck client
// from hammering it, not to police normal use.
const statsLimiter = rateLimit({
  name: "stats",
  limit: 60,
  windowMs: 10 * 60 * 1000,
  message: "Too many requests.",
});

const presenceLimiter = rateLimit({
  name: "presence",
  limit: 120,
  windowMs: 10 * 60 * 1000,
  message: "Too many presence updates. Try again shortly.",
});

app.post("/api/presence/heartbeat", requireUser, presenceLimiter, (req, res) => {
  touchPresence(req.user.id);
  res.json({ presence: presenceOf(req.user), heartbeatMs: HEARTBEAT_MS });
});

app.post("/api/presence", requireUser, presenceLimiter, async (req, res) => {
  const status = normalizeStatus(req.body?.status);
  if (!STATUSES.includes(req.body?.status)) {
    res.status(400).json({ error: "Pick a status." });
    return;
  }
  const minutes = Number(req.body?.keepMinutes || 0);
  if (!KEEP_MINUTES.includes(minutes)) {
    res.status(400).json({ error: "Pick how long to keep that status." });
    return;
  }
  const until = keepUntil(minutes);
  await writeDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (user) {
      user.presenceStatus = status;
      user.presenceUntil = until;
    }
    return db;
  });
  // Going invisible should drop the dot immediately rather than linger for a
  // heartbeat window.
  if (status === "invisible") forgetPresence(req.user.id);
  else touchPresence(req.user.id);
  res.json({ presence: { status, online: status !== "invisible", until } });
});

app.get("/api/auth/discord", discordStartLimiter, (req, res) => {
  const mode = req.query.mode === "register" ? "register" : "login";
  if (!discordConfigured()) {
    res.redirect(`${publicOrigin(req)}/${mode}?error=discord-config`);
    return;
  }
  const state = newToken();
  const next = safeNextPath(req.query.next);
  res.cookie(
    OAUTH_COOKIE,
    encodeOauth({ state, next, mode }),
    { ...cookieOptions(), maxAge: 10 * 60 * 1000 }
  );
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: discordRedirectUri(req),
    response_type: "code",
    scope: "identify email",
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const origin = publicOrigin(req);
  let stored = {};
  try {
    stored = decodeOauth(req.cookies[OAUTH_COOKIE]);
  } catch {
    stored = {};
  }
  const storedMode = stored.mode === "register" ? "register" : "login";
  const fail = (code) => {
    res.clearCookie(OAUTH_COOKIE, cookieOptions());
    res.redirect(`${origin}/${storedMode}?error=${encodeURIComponent(code)}`);
  };
  if (!discordConfigured()) {
    fail("discord-config");
    return;
  }
  if (!req.query.code || !req.query.state || req.query.state !== stored.state) {
    fail("discord-state");
    return;
  }
  if (req.query.error) {
    fail("discord-denied");
    return;
  }

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(req.query.code),
        redirect_uri: discordRedirectUri(req),
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      fail("discord-token");
      return;
    }
    const profileRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await profileRes.json();
    if (!profileRes.ok || !discordUser.id) {
      fail("discord-profile");
      return;
    }
    if (isProd && discordUser.verified === false) {
      fail("discord-email");
      return;
    }
    if (discordAgeDays(discordUser.id) < DISCORD_MIN_AGE_DAYS) {
      fail("discord-age");
      return;
    }

    const linked = currentUser(req);
    const sessionToken = newToken();
    const placeholderPassword = await hashPassword(newToken());
    const next = safeNextPath(stored.next);
    let errorCode = null;
    await writeDb((db) => {
      const byDiscord = db.users.find((item) => item.discordId === discordUser.id);
      const bySession = linked ? db.users.find((item) => item.id === linked.id) : null;
      if (byDiscord && bySession && byDiscord.id !== bySession.id) {
        errorCode = "discord-linked";
        return db;
      }
      let user = byDiscord || (bySession && !bySession.discordId ? bySession : null);
      if (!user) {
        user = {
          id: `user-discord-${discordUser.id}`,
          username: uniqueDiscordUsername(db, discordUser),
          password: placeholderPassword,
          admin: false,
          createdAt: new Date().toISOString(),
        };
        db.users.push(user);
      }
      user.discordId = discordUser.id;
      user.discordUsername = discordUser.global_name || discordUser.username;
      user.discordEmail = discordUser.email || null;
      db.sessions.push({
        token: sessionToken,
        userId: user.id,
        expires: Date.now() + 1000 * 60 * 60 * 24 * 30,
      });
      return db;
    });
    if (errorCode) {
      fail(errorCode);
      return;
    }
    res.clearCookie(OAUTH_COOKIE, cookieOptions());
    setSession(res, sessionToken);
    res.redirect(`${origin}${next.startsWith("/") ? next : `/${next}`}`);
  } catch {
    fail("discord-error");
  }
});

app.post("/api/auth/forum/start", requireUser, (req, res) => {
  const profileUrl = normalizeForumUrl(req.body.profileUrl || req.user.forumProfileUrl);
  if (!profileUrl) {
    res.status(400).json({ error: "Paste your Warframe Forum profile URL (forums.warframe.com/profile/...)." });
    return;
  }
  writeDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return db;
    }
    if (!user.forumToken) user.forumToken = newForumToken();
    if (user.forumVerified && user.forumProfileUrl && user.forumProfileUrl !== profileUrl) {
      user.forumVerified = false;
      user.forumToken = newForumToken();
    }
    user.forumProfileUrl = profileUrl;
    user.forumName = forumNameFromUrl(profileUrl);
    res.json({ user: publicAccount(user, { isProd }) });
    return db;
  });
});

app.post("/api/auth/forum/check", requireUser, forumCheckLimiter, async (req, res) => {
  const profileUrl = normalizeForumUrl(req.body.profileUrl || req.user.forumProfileUrl);
  if (!profileUrl) {
    res.status(400).json({ error: "Paste your Warframe Forum profile URL first." });
    return;
  }
  const wait = req.user.forumCheckedAt
    ? FORUM_CHECK_COOLDOWN_MS - (Date.now() - new Date(req.user.forumCheckedAt).getTime())
    : 0;
  if (wait > 0) {
    res.status(429).json({ error: "Wait a few seconds before checking again." });
    return;
  }

  let token = req.user.forumToken;
  await writeDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return db;
    if (!user.forumToken) user.forumToken = newForumToken();
    user.forumProfileUrl = profileUrl;
    user.forumName = forumNameFromUrl(profileUrl);
    user.forumCheckedAt = new Date().toISOString();
    token = user.forumToken;
    return db;
  });

  try {
    const profile = await readForumProfile(profileUrl);
    if (!profileHasToken(profile.html, token)) {
      res.status(400).json({
        error:
          "We loaded that profile, but your code is not in About Me yet. Open the About Me tab, paste the code, click Save, then check again.",
      });
      return;
    }
    writeDb((db) => {
      const user = db.users.find((item) => item.id === req.user.id);
      if (!user) {
        res.status(404).json({ error: "Account not found." });
        return db;
      }
      user.forumVerified = true;
      user.forumProfileUrl = profile.url;
      // The forum display name is the in-game name: shown across the site and
      // copied into whisper text. It is NOT the account key - username carries
      // a unique index and identity rests on discordId, so two Tenno with the
      // same forum name can both hold accounts.
      user.forumName = ingameName(profile.owner);
      user.forumVerifiedAt = new Date().toISOString();
      res.json({ user: publicAccount(user, { isProd }) });
      return db;
    });
  } catch (error) {
    res.status(400).json({
      error: error.message || "Could not read that Warframe Forum profile. Try again in a few seconds.",
    });
  }
});

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  if (isProd) {
    res.status(403).json({ error: "Create an account with Discord." });
    return;
  }
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    res.status(400).json({ error: "Username must be 3–20 letters, numbers, or underscores." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  const passwordHash = await hashPassword(password);
  writeDb((db) => {
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      res.status(409).json({ error: "That username is taken." });
      return db;
    }
    const user = {
      id: slugify(username),
      username,
      password: passwordHash,
      admin: false,
      createdAt: new Date().toISOString(),
    };
    const token = newToken();
    db.users.push(user);
    db.sessions.push({ token, userId: user.id, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    setSession(res, token);
    res.status(201).json({ user: publicAccount(user, { isProd }) });
    return db;
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ error: error.message });
  });
});

app.post("/api/auth/login", loginIpLimiter, loginLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await verifyPassword(password, user.password))) {
    res.status(401).json({ error: "Wrong username or password." });
    return;
  }
  const token = newToken();
  writeDb((next) => {
    next.sessions.push({ token, userId: user.id, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    return next;
  }).then(() => {
    setSession(res, token);
    res.json({ user: publicAccount(user, { isProd }) });
  });
});

app.post("/api/auth/logout", (req, res) => {
  const token = req.cookies[COOKIE];
  forgetPresence(currentUser(req)?.id);
  writeDb((db) => {
    db.sessions = db.sessions.filter((item) => item.token !== token);
    return db;
  }).then(() => {
    res.clearCookie(COOKIE, cookieOptions());
    res.json({ ok: true });
  });
});

app.get("/api/auth/export", requireUser, exportLimiter, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json({
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      admin: Boolean(user.admin),
      discordId: user.discordId || null,
      discordUsername: user.discordUsername || null,
      discordEmail: user.discordEmail || null,
      forumVerified: Boolean(user.forumVerified),
      forumName: user.forumName || null,
      forumProfileUrl: user.forumProfileUrl || null,
      forumVerifiedAt: user.forumVerifiedAt || null,
      forumCheckedAt: user.forumCheckedAt || null,
      presenceStatus: user.presenceStatus || null,
      presenceUntil: user.presenceUntil || null,
    },
    // Listings that are not yours but carry your name as a contact.
    recruitingOn: recruitingOn(db, user.id),
    recruiterInvites: pendingInvitesFor(db, user.id),
    clans: (db.clans || []).filter((item) => item.ownerId === user.id),
    alliances: (db.alliances || []).filter((item) => item.ownerId === user.id),
    reports: (db.reports || []).filter((item) => item.reporterId === user.id),
  });
});

app.delete("/api/auth/account", requireUser, (req, res) => {
  if (req.user.admin) {
    res.status(403).json({ error: "Admin accounts cannot be deleted from this page." });
    return;
  }
  writeDb((db) => {
    const userId = req.user.id;
    const user = db.users.find((item) => item.id === userId);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return db;
    }
    const droppedAlliances = new Set(
      (db.alliances || []).filter((item) => item.ownerId === userId).map((item) => item.id)
    );
    for (const listing of [...(db.clans || []), ...(db.alliances || [])].filter((item) => item.ownerId === userId)) {
      removeStoredFile(listing.image);
      removeStoredFile(listing.video);
    }
    db.clans = (db.clans || [])
      .filter((item) => item.ownerId !== userId)
      .map((clan) => (droppedAlliances.has(clan.allianceId) ? { ...clan, allianceId: null } : clan))
      // Deleting an account also withdraws it from every listing it recruited
      // for, otherwise a dead user id sits on someone else's public roster.
      .map((clan) =>
        recruiterEntry(clan, userId)
          ? { ...clan, recruiters: normalizeRecruiters(clan.recruiters).filter((item) => item.userId !== userId) }
          : clan
      );
    db.alliances = (db.alliances || []).filter((item) => item.ownerId !== userId);
    db.reports = (db.reports || []).map((item) =>
      item.reporterId === userId ? { ...item, reporterId: null } : item
    );
    db.sessions = (db.sessions || []).filter((item) => item.userId !== userId);
    db.users = (db.users || []).filter((item) => item.id !== userId);
    res.clearCookie(COOKIE, cookieOptions());
    res.json({ ok: true });
    return db;
  });
});

// Browse and the home page render cards; they never show the post body. Shipping
// `about` for every listing meant every visitor downloaded every full post on
// every page load, so list responses carry only what a card and the filters
// read. The detail route still returns the whole record.
const HEAVY_FIELDS = ["about", "offering", "requirements", "video"];

function trimListing(item) {
  const out = { ...item };
  for (const field of HEAVY_FIELDS) delete out[field];
  if (out.memberClans) out.memberClans = out.memberClans.map(trimListing);
  return out;
}

app.get("/api/clans", (req, res) => {
  const db = readDb();
  const user = currentUser(req);
  const clans = db.clans
    .map((clan) => withOwnerStats(decorateClan(clan, db), clan, user))
    .sort(sortListings)
    .map(trimListing);
  res.json({ clans });
});

app.get("/api/clans/:id", (req, res) => {
  const db = readDb();
  const clan = db.clans.find((item) => item.id === req.params.id);
  if (!clan) {
    res.status(404).json({ error: "Clan not found." });
    return;
  }
  // Only the detail route returns the post body, so this is a read of the post
  // rather than a card impression.
  if (!looksLikeBot(req.headers["user-agent"])) countView(clan.id);
  res.json({ clan: withOwnerStats(decorateClan(clan, db), clan, currentUser(req)) });
});

app.post("/api/clans/:id/whisper", statsLimiter, (req, res) => {
  if (!looksLikeBot(req.headers["user-agent"])) countWhisper(String(req.params.id));
  res.json({ ok: true });
});

app.post("/api/clans", requirePoster, listingLimiter, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseClanBody(req.body, req.user);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }
  const invited = await attachInvite(parsed.fields);
  if (invited.error) {
    discardUploads(req);
    res.status(400).json({ error: invited.error });
    return;
  }

  writeDb((db) => {
    const taken = listingTaken(db, invited);
    if (taken) {
      discardUploads(req);
      res.status(409).json({ error: taken });
      return db;
    }
    const wait = listingCreateWait(db, req.user.id);
    if (wait) {
      discardUploads(req);
      res.status(429).json({ error: wait });
      return db;
    }
    if (invited.allianceId && !db.alliances.some((item) => item.id === invited.allianceId)) {
      discardUploads(req);
      res.status(400).json({ error: "That alliance does not exist." });
      return db;
    }
    const now = new Date().toISOString();
    const clan = {
      id: slugify(invited.name),
      ...invited,
      image: savedUpload(listingFile(req, "image")),
      video: savedUpload(listingFile(req, "video")),
      featured: false,
      ownerId: req.user.id,
      createdAt: now,
      bumpedAt: now,
    };
    db.clans.unshift(clan);
    res.status(201).json({ clan: decorateClan(clan, db) });
    return db;
  });
});

app.put("/api/clans/:id", requirePoster, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseClanBody(req.body, req.user);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }
  const invited = await attachInvite(parsed.fields);
  if (invited.error) {
    discardUploads(req);
    res.status(400).json({ error: invited.error });
    return;
  }

  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      discardUploads(req);
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      discardUploads(req);
      res.status(403).json({ error: "You can only edit your own posts." });
      return db;
    }
    const taken = listingTaken(db, { ...invited, id: clan.id });
    if (taken) {
      discardUploads(req);
      res.status(409).json({ error: taken });
      return db;
    }
    if (invited.allianceId && !db.alliances.some((item) => item.id === invited.allianceId)) {
      discardUploads(req);
      res.status(400).json({ error: "That alliance does not exist." });
      return db;
    }
    Object.assign(clan, invited, {
      image: nextImage(clan.image, listingFile(req, "image")),
      video: nextVideo(clan.video, listingFile(req, "video"), req.body.removeVideo),
    });
    res.json({ clan: decorateClan(clan, db) });
    return db;
  });
});

app.post("/api/clans/:id/bump", requirePoster, async (req, res) => {
  const current = readDb().clans.find((item) => item.id === req.params.id);
  if (!current) {
    res.status(404).json({ error: "Clan not found." });
    return;
  }
  if (!canRemove(req.user, current)) {
    res.status(403).json({ error: "You can only bump your own posts." });
    return;
  }
  const wait = bumpWaitMessage(current);
  if (wait) {
    res.status(429).json({ error: wait });
    return;
  }
  const invite = current.discord
    ? await inspectDiscordInvite(current.discord, { required: false })
    : { ok: true, skipped: true };
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!invite.ok) {
      clan.inviteOk = false;
      res.status(400).json({ error: invite.error });
      return db;
    }
    if (!invite.skipped) {
      clan.discord = invite.url;
      clan.inviteOk = true;
      clan.inviteCheckedAt = invite.checkedAt;
    }
    clan.bumpedAt = new Date().toISOString();
    res.json({ clan: decorateClan(clan, db) });
    return db;
  });
});

// Recruiters are contacts, not co-owners: only the owner (or an admin) changes
// the roster, and the invitee is the only one who can accept.
app.get("/api/clans/:id/recruiters", requireUser, (req, res) => {
  const db = readDb();
  const clan = db.clans.find((item) => item.id === req.params.id);
  if (!clan) {
    res.status(404).json({ error: "Clan not found." });
    return;
  }
  if (!canRemove(req.user, clan)) {
    res.status(403).json({ error: "You can only see the roster of your own posts." });
    return;
  }
  res.json({ roster: rosterFor(clan, db), max: RECRUITER_MAX });
});

app.post("/api/clans/:id/recruiters", requireUser, (req, res) => {
  const username = String(req.body?.username || "").trim();
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      res.status(403).json({ error: "You can only add recruiters to your own posts." });
      return db;
    }
    const invitee = db.users.find(
      (user) => user.username.toLowerCase() === username.toLowerCase()
    );
    const blocked = inviteBlocker(clan, invitee, { id: clan.ownerId });
    if (blocked) {
      res.status(400).json({ error: blocked });
      return db;
    }
    clan.recruiters = [
      ...normalizeRecruiters(clan.recruiters),
      { userId: invitee.id, status: "pending", invitedAt: new Date().toISOString(), respondedAt: null },
    ];
    res.json({ clan: decorateClan(clan, db), roster: rosterFor(clan, db) });
    return db;
  });
});

app.post("/api/clans/:id/recruiters/respond", requireUser, (req, res) => {
  const accept = req.body?.accept === true || req.body?.accept === "true";
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    const entry = recruiterEntry(clan, req.user.id);
    if (!entry || entry.status !== "pending") {
      res.status(404).json({ error: "No pending invite for you on that listing." });
      return db;
    }
    const rest = normalizeRecruiters(clan.recruiters).filter((item) => item.userId !== req.user.id);
    clan.recruiters = accept
      ? [...rest, { ...entry, status: "accepted", respondedAt: new Date().toISOString() }]
      : rest;
    res.json({ ok: true, accepted: accept });
    return db;
  });
});

// The owner removes anyone; a recruiter can always remove themselves.
app.delete("/api/clans/:id/recruiters/:userId", requireUser, (req, res) => {
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    const target = String(req.params.userId);
    if (!canRemove(req.user, clan) && target !== req.user.id) {
      res.status(403).json({ error: "You can only remove yourself from a listing." });
      return db;
    }
    clan.recruiters = normalizeRecruiters(clan.recruiters).filter((item) => item.userId !== target);
    res.json({ ok: true, roster: rosterFor(clan, db) });
    return db;
  });
});

app.post("/api/clans/:id/pause", requireUser, (req, res) => {
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      res.status(403).json({ error: "You can only pause your own posts." });
      return db;
    }
    clan.paused = Boolean(req.body.paused);
    res.json({ clan: decorateClan(clan, db) });
    return db;
  });
});

function writeReport(req, res, kind) {
  const reason = String(req.body.reason || "");
  if (!REPORT_REASONS.includes(reason)) {
    res.status(400).json({ error: "Pick a report reason." });
    return;
  }
  const reporter = currentUser(req);
  writeDb((db) => {
    const list = kind === "clan" ? db.clans : db.alliances;
    const listing = list.find((item) => item.id === req.params.id);
    if (!listing) {
      res.status(404).json({ error: "Listing not found." });
      return db;
    }
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const duplicate = (db.reports || []).some(
      (item) =>
        item.listingId === listing.id &&
        item.reason === reason &&
        item.reporterId === (reporter?.id || null) &&
        new Date(item.createdAt).getTime() > hourAgo
    );
    if (duplicate) {
      res.status(429).json({ error: "You already reported this listing." });
      return db;
    }
    db.reports = db.reports || [];
    db.reports.unshift({
      id: `report-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      kind,
      listingId: listing.id,
      listingName: listing.name,
      reason,
      details: String(req.body.details || "").slice(0, 400),
      reporterId: reporter?.id || null,
      createdAt: new Date().toISOString(),
      status: "open",
    });
    res.json({ ok: true });
    return db;
  });
}

app.post("/api/clans/:id/report", reportLimiter, (req, res) => writeReport(req, res, "clan"));

app.delete("/api/clans/:id", requireUser, (req, res) => {
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      res.status(403).json({ error: "You can only remove your own posts." });
      return db;
    }
    removeStoredFile(clan.image);
    removeStoredFile(clan.video);
    const now = new Date().toISOString();
    db.reports = (db.reports || []).map((item) =>
      item.listingId === clan.id && item.status === "open"
        ? { ...item, status: "resolved", resolvedAt: now }
        : item
    );
    db.clans = db.clans.filter((item) => item.id !== clan.id);
    res.json({ ok: true });
    return db;
  });
});

app.get("/api/alliances", (_req, res) => {
  const db = readDb();
  const alliances = db.alliances
    .map((alliance) => decorateAlliance(alliance, db))
    .sort(sortListings)
    .map(trimListing);
  res.json({ alliances });
});

app.get("/api/alliances/:id", (req, res) => {
  const db = readDb();
  const alliance = db.alliances.find((item) => item.id === req.params.id);
  if (!alliance) {
    res.status(404).json({ error: "Alliance not found." });
    return;
  }
  res.json({
    alliance: decorateAlliance(alliance, db),
  });
});

app.post("/api/alliances", requirePoster, listingLimiter, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseAllianceBody(req.body);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { rosterIds, ...base } = parsed.fields;
  const invited = await attachInvite(base);
  if (invited.error) {
    discardUploads(req);
    res.status(400).json({ error: invited.error });
    return;
  }

  writeDb((db) => {
    const taken = listingTaken(db, invited);
    if (taken) {
      discardUploads(req);
      res.status(409).json({ error: taken });
      return db;
    }
    const wait = listingCreateWait(db, req.user.id);
    if (wait) {
      discardUploads(req);
      res.status(429).json({ error: wait });
      return db;
    }
    const now = new Date().toISOString();
    const alliance = {
      id: slugify(invited.name),
      ...invited,
      image: savedUpload(listingFile(req, "image")),
      video: savedUpload(listingFile(req, "video")),
      featured: false,
      ownerId: req.user.id,
      createdAt: now,
      bumpedAt: now,
    };
    db.alliances.unshift(alliance);
    applyAllianceRoster(db, alliance.id, req.user.id, rosterIds);
    res.status(201).json({ alliance: decorateAlliance(alliance, db) });
    return db;
  });
});

app.put("/api/alliances/:id", requirePoster, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseAllianceBody(req.body);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { rosterIds, ...base } = parsed.fields;
  const invited = await attachInvite(base);
  if (invited.error) {
    discardUploads(req);
    res.status(400).json({ error: invited.error });
    return;
  }

  writeDb((db) => {
    const alliance = db.alliances.find((item) => item.id === req.params.id);
    if (!alliance) {
      discardUploads(req);
      res.status(404).json({ error: "Alliance not found." });
      return db;
    }
    if (!canRemove(req.user, alliance)) {
      discardUploads(req);
      res.status(403).json({ error: "You can only edit your own posts." });
      return db;
    }
    const taken = listingTaken(db, { ...invited, id: alliance.id });
    if (taken) {
      discardUploads(req);
      res.status(409).json({ error: taken });
      return db;
    }
    Object.assign(alliance, invited, {
      image: nextImage(alliance.image, listingFile(req, "image")),
      video: nextVideo(alliance.video, listingFile(req, "video"), req.body.removeVideo),
    });
    applyAllianceRoster(db, alliance.id, alliance.ownerId, rosterIds);
    res.json({ alliance: decorateAlliance(alliance, db) });
    return db;
  });
});

app.post("/api/alliances/:id/bump", requirePoster, async (req, res) => {
  const current = readDb().alliances.find((item) => item.id === req.params.id);
  if (!current) {
    res.status(404).json({ error: "Alliance not found." });
    return;
  }
  if (!canRemove(req.user, current)) {
    res.status(403).json({ error: "You can only bump your own posts." });
    return;
  }
  const wait = bumpWaitMessage(current);
  if (wait) {
    res.status(429).json({ error: wait });
    return;
  }
  const invite = current.discord
    ? await inspectDiscordInvite(current.discord, { required: false })
    : { ok: true, skipped: true };
  writeDb((db) => {
    const alliance = db.alliances.find((item) => item.id === req.params.id);
    if (!alliance) {
      res.status(404).json({ error: "Alliance not found." });
      return db;
    }
    if (!invite.ok) {
      alliance.inviteOk = false;
      res.status(400).json({ error: invite.error });
      return db;
    }
    if (!invite.skipped) {
      alliance.discord = invite.url;
      alliance.inviteOk = true;
      alliance.inviteCheckedAt = invite.checkedAt;
    }
    alliance.bumpedAt = new Date().toISOString();
    res.json({ alliance: decorateAlliance(alliance, db) });
    return db;
  });
});

app.post("/api/alliances/:id/pause", requireUser, (req, res) => {
  writeDb((db) => {
    const alliance = db.alliances.find((item) => item.id === req.params.id);
    if (!alliance) {
      res.status(404).json({ error: "Alliance not found." });
      return db;
    }
    if (!canRemove(req.user, alliance)) {
      res.status(403).json({ error: "You can only pause your own posts." });
      return db;
    }
    alliance.paused = Boolean(req.body.paused);
    res.json({ alliance: decorateAlliance(alliance, db) });
    return db;
  });
});

app.post("/api/alliances/:id/report", reportLimiter, (req, res) => writeReport(req, res, "alliance"));

app.get("/api/reports", requireAdmin, (_req, res) => {
  const db = readDb();
  res.json({ reports: db.reports || [] });
});

app.post("/api/reports/:id/resolve", requireAdmin, (req, res) => {
  const status = req.body.status === "dismissed" ? "dismissed" : "resolved";
  writeDb((db) => {
    const report = (db.reports || []).find((item) => item.id === req.params.id);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return db;
    }
    report.status = status;
    report.resolvedAt = new Date().toISOString();
    res.json({ report });
    return db;
  });
});

app.delete("/api/alliances/:id", requireUser, (req, res) => {
  writeDb((db) => {
    const alliance = db.alliances.find((item) => item.id === req.params.id);
    if (!alliance) {
      res.status(404).json({ error: "Alliance not found." });
      return db;
    }
    if (!canRemove(req.user, alliance)) {
      res.status(403).json({ error: "You can only remove your own posts." });
      return db;
    }
    removeStoredFile(alliance.image);
    removeStoredFile(alliance.video);
    const now = new Date().toISOString();
    db.reports = (db.reports || []).map((item) =>
      item.listingId === alliance.id && item.status === "open"
        ? { ...item, status: "resolved", resolvedAt: now }
        : item
    );
    db.clans = db.clans.map((clan) =>
      clan.allianceId === alliance.id ? { ...clan, allianceId: null } : clan
    );
    db.alliances = db.alliances.filter((item) => item.id !== alliance.id);
    res.json({ ok: true });
    return db;
  });
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(robotsTxt(publicOrigin(req)));
});

app.get("/sitemap.xml", (req, res) => {
  const db = readDb();
  res.type("application/xml").send(
    sitemapXml(publicOrigin(req), { clans: db.clans || [], alliances: db.alliances || [] })
  );
});

app.use((error, _req, res, _next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Video must be 25 MB or smaller. Images must be 2 MB." });
    return;
  }
  res.status(400).json({ error: error.message || "Request failed." });
});

const distDir = path.join(root, "..", "dist");
const indexPath = path.join(root, "..", "index.html");

async function sendListingPage(req, res, next, vite) {
  const match = listingFromPath(req.path);
  if (!match) {
    next();
    return;
  }
  const origin = publicOrigin(req);
  const db = readDb();
  const listing =
    match.kind === "clan"
      ? (db.clans || []).find((item) => item.id === match.id)
      : (db.alliances || []).find((item) => item.id === match.id);
  const source = isProd ? path.join(distDir, "index.html") : indexPath;
  let html = fs.readFileSync(source, "utf8");
  html = applySocialMeta(html, listing ? listingSocial(origin, listing, match.kind) : defaultSocial(origin));
  if (vite) html = await vite.transformIndexHtml(req.originalUrl, html);
  res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).end(html);
}

async function attachFrontend() {
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: path.join(root, "..", "vite.config.js"),
      server: {
        middlewareMode: true,
        proxy: {},
      },
      appType: "spa",
    });
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      sendListingPage(req, res, next, vite).catch(next);
    });
    app.use(vite.middlewares);
    return "live";
  }

  if (!fs.existsSync(distDir)) {
    throw new Error("Missing dist/. Run npm run build before starting in production.");
  }

  app.use(express.static(distDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
      next();
      return;
    }
    if (listingFromPath(req.path)) {
      sendListingPage(req, res, next, null).catch(next);
      return;
    }
    const html = applySocialMeta(
      fs.readFileSync(path.join(distDir, "index.html"), "utf8"),
      defaultSocial(publicOrigin(req))
    );
    res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).end(html);
  });
  return "build";
}

let server;
let sessionSweep;
let statsSweep;
let inviteSweep;
let inviteSweepDelay;
let inviteSweepRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recheckInvites() {
  if (inviteSweepRunning) return;
  inviteSweepRunning = true;
  try {
    const batch = listingsNeedingInviteCheck(readDb());
    for (const item of batch) {
      const result = await inspectDiscordInvite(item.discord, { required: false });
      await writeDb((db) => {
        const listing =
          (db.clans || []).find((row) => row.id === item.id) ||
          (db.alliances || []).find((row) => row.id === item.id);
        if (listing) applyInviteCheck(listing, result);
        return db;
      });
      await sleep(INVITE_RECHECK_GAP_MS);
    }
  } catch {
    /* Discord outages should not take the board down. */
  } finally {
    inviteSweepRunning = false;
  }
}

async function start() {
  await initStorage();
  const frontend = await attachFrontend();
  server = app.listen(PORT, "0.0.0.0");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  console.log(`WF Clan Recruit on http://localhost:${PORT}`);
  console.log(`Storage: ${storageLabel()}`);
  console.log(`Frontend: ${frontend === "live" ? "live source (same app as production)" : "production dist build"}`);
  if (!discordConfigured()) {
    console.warn("DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are unset. Discord sign-in is off.");
  }
  sessionSweep = setInterval(() => {
    writeDb((db) => {
      const now = Date.now();
      const sessions = (db.sessions || []).filter((item) => item.expires > now);
      if (sessions.length === (db.sessions || []).length) return db;
      return { ...db, sessions };
    }).catch(() => {});
  }, 60 * 60 * 1000);
  sessionSweep.unref();
  statsSweep = setInterval(() => {
    flushStats().catch(() => {});
  }, FLUSH_MS);
  statsSweep.unref();
  inviteSweepDelay = setTimeout(() => {
    recheckInvites().catch(() => {});
  }, 2 * 60 * 1000);
  inviteSweepDelay.unref();
  inviteSweep = setInterval(() => {
    recheckInvites().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  inviteSweep.unref();
}

start().catch((error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process, then run npm run dev again.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

// One write per listing that saw traffic, rather than one per visitor.
async function flushStats() {
  if (!pendingCount()) return;
  const counts = drain();
  try {
    await writeDb((db) => {
      for (const [id, delta] of counts) {
        const listing = (db.clans || []).find((item) => item.id === id);
        if (!listing) continue;
        listing.stats = addStats(listing.stats, delta);
      }
      return db;
    });
  } catch {
    // Put them back so a failed save does not silently lose the counts.
    for (const [id, delta] of counts) {
      for (let i = 0; i < delta.views; i += 1) countView(id);
      for (let i = 0; i < delta.whispers; i += 1) countWhisper(id);
    }
  }
}

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  if (sessionSweep) clearInterval(sessionSweep);
  if (statsSweep) clearInterval(statsSweep);
  if (inviteSweep) clearInterval(inviteSweep);
  if (inviteSweepDelay) clearTimeout(inviteSweepDelay);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => {
    flushStats()
      .catch(() => {})
      .finally(() => closePg().finally(() => process.exit(0)));
  });
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
