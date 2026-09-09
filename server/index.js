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
  BODY_MAX,
  blockedBetween,
  bodyError,
  normalizeBody,
  openError,
  parseThreadId,
  previewOf,
  threadId as threadIdFor,
} from "./messages.js";
import * as store from "./store.js";
import { PING_MS, publish, subscribe } from "./live.js";
import { dropLegacyVideos } from "../src/video.js";
import { MEDIA_MAX, mediaList, normalizeMedia, setUploadPublicBase, uploadedUrls, videoIdsOf } from "../src/media.js";
import { normalizeContactLabel, normalizeRoles, roleTextError } from "../src/roles.js";
import { resizeEmojiImage, resizeListingImage } from "./image.js";
import { deleteR2Object, putR2Object, r2Enabled, r2PartialEnv, r2PublicUrl, readLocalFile } from "./r2.js";
import {
  HEARTBEAT_MS,
  KEEP_MINUTES,
  STATUSES,
  forget as forgetPresence,
  keepMinutesOf,
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
  isHidden,
  listingConflict,
  ownerVerified,
  whisperName,
  withListingState,
} from "./listing.js";
import {
  aboutTooLong,
  isSafeHref,
  normalizeAbout,
  normalizeSection,
  plainTextFromHtml,
  sectionTooLong,
} from "../src/richtext.js";
import {
  HEADLINE_MAX,
  HOURS,
  LINK_MAX,
  PLAYER_NAME_MAX,
  PLAYER_STATUSES,
  SUMMARY_MAX,
  isDiscordName,
  normalizeDiscordName,
  TAG_MAX,
  VIDEO_MAX,
  normalizeContact,
  normalizeLinks,
  normalizePlaystyles,
  wantsDiscord,
  wantsWhisper,
} from "../src/data.js";
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
  RECRUITER_ROLES,
  RECRUITER_SEARCH_MAX,
  canEditListing,
  findInvitee,
  normalizeRecruiterRole,
  recruiterEntry,
  searchRecruiterCandidates,
  recruitingOn,
} from "./recruiters.js";
import {
  applyTransfer,
  clearTransfer,
  normalizeTransfer,
  offerTransfer,
  transferBlocker,
  transfersFor,
} from "./ownership.js";
import {
  DISCORD_MIN_AGE_DAYS,
  FORUM_CHECK_COOLDOWN_MS,
  discordAgeDays,
  discordConfigured,
  discordAvatarUrl,
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
import {
  applyPendingAdmin,
  grantByUserId,
  grantStaff,
  revokeAdmin,
  searchStaffCandidates,
  staffList,
} from "./admins.js";
import { addEmojiError, normalizeEmojiName, publicEmoji } from "../src/emojis.js";

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
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXT_BY_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

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
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _enc, next) {
        bytes += chunk.length;
        if (bytes > IMAGE_MAX) {
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
  limits: { fileSize: IMAGE_MAX, files: 1 + MEDIA_MAX },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "image" || file.fieldname === "mediaImage") {
      // The type decides, not the name. Chrome on Windows saves JPEGs as
      // .jfif and a dragged screenshot may have no extension at all - both
      // used to be rejected as "not an image" while holding a perfectly good
      // image/jpeg. The name is never trusted for anything else either: the
      // stored file is named from the MIME type and re-encoded by sharp.
      const ok = IMAGE_TYPES.has(file.mimetype);
      cb(ok ? null : new Error("Image must be PNG, JPG, WEBP, or GIF."), ok);
      return;
    }
    cb(new Error("Unexpected file."), false);
  },
});

const listingUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "mediaImage", maxCount: MEDIA_MAX },
]);

// A player profile takes no avatar: the picture is read off the owner's Discord
// account. Accepting an `image` field anyway would write a file to disk that
// nothing ever points at, so the field is simply not offered.
const playerUpload = upload.fields([{ name: "mediaImage", maxCount: MEDIA_MAX }]);
const emojiUpload = upload.fields([{ name: "image", maxCount: 1 }]);

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
// Generous for a conversation, tight enough that an automated account cannot
// turn the inbox into a firehose.
// Set once at boot. False means the message store did not come up, and every
// messaging route says so plainly rather than failing in a different way each
// time it is asked.
let messagingUp = false;

function requireStore(_req, res, next) {
  if (!messagingUp) {
    res.status(503).json({ error: "Messaging is temporarily unavailable." });
    return;
  }
  next();
}

const messageLimiter = rateLimit({ name: "message", limit: 60, windowMs: 10 * 60 * 1000 });
const threadOpenLimiter = rateLimit({ name: "thread-open", limit: 20, windowMs: 60 * 60 * 1000 });
const reportLimiter = rateLimit({
  name: "report",
  limit: 8,
  windowMs: 60 * 60 * 1000,
  message: "Too many reports. Try again later.",
});
const staffLimiter = rateLimit({
  name: "staff",
  limit: 40,
  windowMs: 60 * 60 * 1000,
  message: "Too many staff changes. Try again later.",
});
const forumCheckLimiter = rateLimit({
  name: "forum-check",
  limit: 10,
  windowMs: 10 * 60 * 1000,
  message: "Too many verification checks. Wait a few minutes and try again.",
});
// Typing into the invite box fires one of these per keystroke burst, so the
// window is generous - it is here to stop the endpoint being walked, not to
// slow down someone adding a recruiter.
const recruiterSearchLimiter = rateLimit({ name: "recruiter-search", limit: 120, windowMs: 10 * 60 * 1000 });
const staffSearchLimiter = rateLimit({ name: "staff-search", limit: 120, windowMs: 10 * 60 * 1000 });
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

function canSeeListing(user, listing) {
  if (!isHidden(listing)) return true;
  return Boolean(user && (user.admin || listing.ownerId === user.id));
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
      if (file.publicUrl) removeStoredFile(file.publicUrl);
      fs.rmSync(file.path, { force: true });
    }
  }
}

function removeStoredFile(url) {
  if (!url) return;
  if (url.startsWith("/uploads/")) {
    fs.rmSync(path.join(paths.uploadDir, path.basename(url)), { force: true });
    return;
  }
  deleteR2Object(url).catch((error) => {
    console.warn("Could not delete stored image:", error.message);
  });
}

function savedUpload(file) {
  if (!file) return null;
  return file.publicUrl || `/uploads/${file.filename}`;
}

// Removing an image from the strip should reclaim storage, and so should
// deleting the listing. Compare what the listing used to point at against what
// it points at now; anything dropped is ours to delete because we wrote it.
function dropUnusedMedia(before, after = []) {
  const kept = new Set(uploadedUrls(after));
  for (const url of uploadedUrls(mediaList(before))) {
    if (!kept.has(url)) removeStoredFile(url);
  }
}

function nextImage(existing, file) {
  if (!file) return existing ?? null;
  removeStoredFile(existing);
  return savedUpload(file);
}

function listingWriteFailed(req, res) {
  return (error) => {
    discardUploads(req);
    console.error("Listing write failed:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not save that listing." });
    }
  };
}

// Every uploaded image - the listing photo and each one in the strip - is
// resized to a ~960px WebP before anything records its name. Serving a raw
// phone screenshot is what made hosting media expensive in the first place;
// resized, an image costs about two orders of magnitude less per view than the
// clips that drove video off this server.
//
// This runs before the body is parsed, because resizing renames the file and
// the media list stores that name. When R2 is configured the resized file is
// then copied there and removed from this host, so the listing stores a public
// media URL instead of /uploads/.
async function processListingImages(req, res) {
  const files = [listingFile(req, "image"), ...(req.files?.mediaImage || [])].filter(Boolean);
  for (const file of files) {
    try {
      const filename = await resizeListingImage(file.path);
      file.filename = filename;
      file.path = path.join(paths.uploadDir, filename);
    } catch (error) {
      console.error("Image resize failed:", error.message);
      discardUploads(req);
      res.status(400).json({ error: "That image could not be read. Use a PNG, JPG, WEBP, or GIF." });
      return false;
    }
    if (!r2Enabled()) continue;
    try {
      const publicUrl = await putR2Object(file.filename, await readLocalFile(file.path));
      if (!publicUrl) throw new Error("R2 put returned nothing");
      file.publicUrl = publicUrl;
      fs.rmSync(file.path, { force: true });
    } catch (error) {
      // Swallowing this is what made a misconfigured bucket look like a
      // browser problem: every upload failed and nothing reached the logs.
      console.error("Listing image could not be stored on R2:", error);
      discardUploads(req);
      res.status(503).json({ error: "Could not store that image. Try again in a moment." });
      return false;
    }
  }
  return true;
}

async function processEmojiImage(req, res) {
  const file = listingFile(req, "image");
  if (!file) return true;
  try {
    const filename = await resizeEmojiImage(file.path);
    file.filename = filename;
    file.path = path.join(paths.uploadDir, filename);
  } catch (error) {
    console.error("Emoji resize failed:", error.message);
    discardUploads(req);
    res.status(400).json({ error: "That image could not be read. Use a PNG, JPG, WEBP, or GIF." });
    return false;
  }
  if (!r2Enabled()) return true;
  try {
    const publicUrl = await putR2Object(file.filename, await readLocalFile(file.path));
    if (!publicUrl) throw new Error("R2 put returned nothing");
    file.publicUrl = publicUrl;
    fs.rmSync(file.path, { force: true });
  } catch (error) {
    console.error("Emoji image could not be stored on R2:", error);
    discardUploads(req);
    res.status(503).json({ error: "Could not store that image. Try again in a moment." });
    return false;
  }
  return true;
}

function assertListingFiles(req, res) {
  const files = [listingFile(req, "image"), ...(req.files?.mediaImage || [])].filter(Boolean);
  if (files.some((file) => file.size > IMAGE_MAX)) {
    discardUploads(req);
    res.status(400).json({ error: "Each image must be 2 MB or smaller." });
    return false;
  }
  return true;
}

// The composer sends the strip as one ordered JSON array. An uploaded image
// arrives as { kind: "image", upload: <n> }, naming its slot in the
// `mediaImage` file list, so the order a leader arranged survives the round
// trip through multipart - which has no ordering of its own.
function parseListingMedia(body, req) {
  let rows = [];
  try {
    const parsed = typeof body.media === "string" ? JSON.parse(body.media) : body.media;
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    return { error: "Could not read the media list." };
  }

  const files = req.files?.mediaImage || [];
  const used = new Set();
  const resolved = [];
  for (const row of rows) {
    if (row?.kind === "image" && Number.isInteger(row.upload)) {
      const file = files[row.upload];
      if (!file) return { error: "An uploaded image went missing. Try adding it again." };
      used.add(row.upload);
      resolved.push({ kind: "image", url: savedUpload(file) });
      continue;
    }
    resolved.push(row);
  }
  // A file with no row pointing at it is a leftover from a row the leader
  // removed before submitting; drop it rather than leaving it in storage.
  files.forEach((file, index) => {
    if (!used.has(index)) {
      removeStoredFile(savedUpload(file));
      fs.rmSync(file.path, { force: true });
    }
  });

  const media = normalizeMedia(resolved);
  if (rows.length && !media.length) {
    return { error: "None of that media could be used. Paste a YouTube link, or upload an image." };
  }
  return { media };
}

// The composer sends the links as one JSON array so an empty row disappears
// rather than arriving as a blank pair. Everything after this point can trust
// that each entry is a known kind and an http/https URL.
function parseListingLinks(value) {
  let rows = [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    return { error: "Could not read the links list." };
  }
  const supplied = rows.filter((row) => String(row?.url || "").trim());
  const links = normalizeLinks(supplied, isSafeHref);
  if (supplied.length && !links.length) {
    return { error: "Links must start with http:// or https://." };
  }
  if (supplied.length > LINK_MAX) {
    return { error: `You can add up to ${LINK_MAX} links.` };
  }
  return { links };
}

// The offer / requirements / how-to-join boxes are all optional rich text now:
// an empty one is a section the listing does not show. Length is the only thing
// that can fail, and it says which box was too long.
const SECTION_LABELS = {
  offering: "What you offer",
  requirements: "Requirements",
  howToJoin: "How to join",
};

function parseListingSections(body) {
  const out = {};
  for (const [name, label] of Object.entries(SECTION_LABELS)) {
    const html = normalizeSection(body[name]);
    const tooLong = sectionTooLong(html, `"${label}"`);
    if (tooLong) return { error: tooLong };
    out[name] = html;
  }
  return { sections: out };
}

// The composer sends the roles as one JSON array. Nothing here can fail the
// save - a role with no name is not a role and simply drops out - so this
// returns the list rather than an error.
function parseListingRoles(body) {
  let rows = [];
  try {
    const parsed = typeof body.roles === "string" ? JSON.parse(body.roles) : body.roles;
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    return { error: "Could not read the roles list." };
  }
  const roles = normalizeRoles(rows);
  const tooLong = roleTextError(roles);
  if (tooLong) return { error: tooLong };
  return { roles };
}

// Every listing has to leave a recruit somewhere to go. Discord used to be the
// only route and so was mandatory; now that it is optional, this is what stops
// a post going live with no way to reach anyone at all.
function contactRouteError({ contact, discord, links }, user) {
  if (wantsDiscord({ contact }) && discord) return null;
  if (wantsWhisper({ contact }) && user?.forumName) return null;
  if ((links || []).length) return null;
  return "Give recruits at least one way to reach you: a Discord invite, a verified forum name, or a link.";
}

function parseClanBody(body, user, req) {
  const playstyles = normalizePlaystyles(asArray(body.playstyles));
  const members = Number(body.members);
  const mrRequired = Number(body.mrRequired || 0);
  const inactiveDaysRaw = Number(body.inactiveDays);
  const inactiveDays = Number.isFinite(inactiveDaysRaw)
    ? Math.max(0, Math.min(365, Math.round(inactiveDaysRaw)))
    : 0;
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
  // The invite is optional now, so an empty box is fine - but anything typed
  // into it still has to be a real invite rather than a clan's homepage.
  const discord = wantsDiscord({ contact }) ? String(body.discord || "").trim() : "";
  if (discord && !validateDiscord(discord)) {
    return { error: "Use a discord.gg or discord.com/invite link." };
  }
  const parsedLinks = parseListingLinks(body.links);
  if (parsedLinks.error) return { error: parsedLinks.error };
  const routeError = contactRouteError({ contact, discord, links: parsedLinks.links }, user);
  if (routeError) return { error: routeError };
  if (!TIER_CAPS[tier]) {
    return { error: "Choose a valid clan tier." };
  }
  if (!Number.isFinite(members) || members < 1 || members > TIER_CAPS[tier]) {
    return { error: `${tier} clans cap at ${TIER_CAPS[tier]} members.` };
  }
  const parsedMedia = parseListingMedia(body, req);
  if (parsedMedia.error) return { error: parsedMedia.error };
  const media = parsedMedia.media;
  const parsedSections = parseListingSections(body);
  if (parsedSections.error) return { error: parsedSections.error };
  const sections = parsedSections.sections;
  const parsedRoles = parseListingRoles(body);
  if (parsedRoles.error) return { error: parsedRoles.error };

  return {
    fields: {
      name: String(body.name).slice(0, 48),
      tag: String(body.tag).toUpperCase().slice(0, TAG_MAX),
      platform: String(body.platform || "PC"),
      tier,
      members,
      mrRequired: Math.max(0, Math.min(36, mrRequired)),
      // 0 means the clan does not kick, which is a real answer rather than a
      // missing one - every long-lived clan has a position on this.
      inactiveDays: inactiveDays,
      playstyles,
      region: String(body.region || "Global"),
      language: String(body.language || "English"),
      status: String(body.status || "Open"),
      leader: String(body.leader || user.forumName || user.username).slice(0, 32),
      // What the post calls whoever holds the account, which is not always the
      // leader: a recruiter can set a listing up for their clan. Free text
      // because a clan's hierarchy is its own - see normalizeContactLabel.
      ownerLabel: normalizeContactLabel(body.ownerLabel, "Leader"),
      contact,
      discord,
      links: parsedLinks.links,
      paused: String(body.paused || "") === "1" || body.paused === true || body.paused === "true",
      founded: String(body.founded || new Date().getFullYear()),
      allianceId,
      media,
      // Derived, not authoritative: an older cached bundle mid-deploy still
      // reads these, and so does anything that has not learned about `media`.
      videos: videoIdsOf(media),
      video: videoIdsOf(media)[0] || null,
      headline: String(body.headline).slice(0, HEADLINE_MAX),
      summary: String(body.summary).slice(0, SUMMARY_MAX),
      about,
      offering: sections.offering,
      requirements: sections.requirements,
      howToJoin: sections.howToJoin,
      roles: parsedRoles.roles,
    },
  };
}

function parseAllianceBody(body, user, req) {
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
  const discord = String(body.discord || "").trim();
  if (discord && !validateDiscord(discord)) {
    return { error: "Use a discord.gg or discord.com/invite link." };
  }
  const parsedLinks = parseListingLinks(body.links);
  if (parsedLinks.error) return { error: parsedLinks.error };
  // An alliance page has no whisper box, so its only routes are the invite and
  // the links row.
  const routeError = contactRouteError({ contact: "discord", discord, links: parsedLinks.links }, user);
  if (routeError) return { error: routeError };
  if (!Number.isFinite(clanCount) || clanCount < 1) {
    return { error: "Enter how many clans are in the alliance." };
  }
  const parsedMedia = parseListingMedia(body, req);
  if (parsedMedia.error) return { error: parsedMedia.error };
  const media = parsedMedia.media;
  const parsedSections = parseListingSections(body);
  if (parsedSections.error) return { error: parsedSections.error };
  const sections = parsedSections.sections;
  const parsedRoles = parseListingRoles(body);
  if (parsedRoles.error) return { error: parsedRoles.error };

  return {
    fields: {
      name: String(body.name).slice(0, 48),
      tag: String(body.tag).toUpperCase().slice(0, TAG_MAX),
      platforms,
      region: String(body.region || "Global"),
      language: String(body.language || "English"),
      status: String(body.status || "Open"),
      clanCount,
      members: Number.isFinite(members) ? members : 0,
      discord,
      links: parsedLinks.links,
      paused: String(body.paused || "") === "1" || body.paused === true || body.paused === "true",
      rosterIds: asArray(body.rosterIds),
      media,
      // Derived, not authoritative: an older cached bundle mid-deploy still
      // reads these, and so does anything that has not learned about `media`.
      videos: videoIdsOf(media),
      video: videoIdsOf(media)[0] || null,
      headline: String(body.headline).slice(0, HEADLINE_MAX),
      summary: String(body.summary).slice(0, SUMMARY_MAX),
      about,
      offering: sections.offering,
      requirements: sections.requirements,
      howToJoin: sections.howToJoin,
      roles: parsedRoles.roles,
    },
  };
}

// A player advertises themselves. Structurally this is a listing - the same
// media strip, the same links row, the same rich-text body - so it reuses every
// parser above rather than growing a second set. What it does not have is a
// tag, a tier, a roster or an alliance: those are facts about an organisation,
// and a person is not one.
function playerRouteError({ contact, discordName, links }, user) {
  if (wantsDiscord({ contact }) && discordName) return null;
  if (wantsWhisper({ contact }) && user?.forumName) return null;
  if ((links || []).length) return null;
  return "Give clans at least one way to reach you: a Discord username, a verified forum name, or a link.";
}

function parsePlayerBody(body, user, req) {
  const playstyles = normalizePlaystyles(asArray(body.playstyles));
  const mr = Number(body.mr || 0);

  if (!body.name || !body.headline || !body.summary) {
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
  if (!Number.isFinite(mr) || mr < 0 || mr > 36) {
    return { error: "Enter a mastery rank between 0 and 36." };
  }
  const contact = normalizeContact(body.contact);
  // A clan publishes an invite to its server. A player has no server - what a
  // recruiter needs is the username to type into Add Friend - so this side of
  // the board stores `discordName` and never touches the invite checker.
  const discordName = wantsDiscord({ contact }) ? normalizeDiscordName(body.discordName) : "";
  if (discordName && !isDiscordName(discordName)) {
    return { error: "That is not a Discord username. Use the name you would type into Add Friend." };
  }
  // The one place a player profile is stricter than it looks: publishing an
  // in-game name is a claim about who you are in the game, so it still needs a
  // verified forum profile behind it. A Discord-only profile does not.
  if (wantsWhisper({ contact }) && !user?.forumVerified) {
    return {
      error: "Verify your Warframe Forum account before you publish an in-game name.",
    };
  }
  const parsedLinks = parseListingLinks(body.links);
  if (parsedLinks.error) return { error: parsedLinks.error };
  const routeError = playerRouteError({ contact, discordName, links: parsedLinks.links }, user);
  if (routeError) return { error: routeError };
  const hours = HOURS.includes(String(body.hours || "")) ? String(body.hours) : HOURS[0];
  const status = PLAYER_STATUSES.includes(String(body.status || "")) ? String(body.status) : PLAYER_STATUSES[0];
  // An empty pick means "any clan will do", which is a real answer and the one
  // most players give.
  const wantsTiers = asArray(body.wantsTiers).filter((tier) => Boolean(TIER_CAPS[tier]));
  const parsedMedia = parseListingMedia(body, req);
  if (parsedMedia.error) return { error: parsedMedia.error };
  const parsedSections = parseListingSections(body);
  if (parsedSections.error) return { error: parsedSections.error };
  const sections = parsedSections.sections;

  return {
    fields: {
      name: String(body.name).slice(0, PLAYER_NAME_MAX),
      platform: String(body.platform || "PC"),
      mr: Math.round(mr),
      hours,
      wantsTiers,
      playstyles,
      region: String(body.region || "Global"),
      language: String(body.language || "English"),
      status,
      contact,
      discordName,
      links: parsedLinks.links,
      paused: String(body.paused || "") === "1" || body.paused === true || body.paused === "true",
      media: parsedMedia.media,
      videos: videoIdsOf(parsedMedia.media),
      video: videoIdsOf(parsedMedia.media)[0] || null,
      headline: String(body.headline).slice(0, HEADLINE_MAX),
      summary: String(body.summary).slice(0, SUMMARY_MAX),
      about,
      offering: sections.offering,
      requirements: sections.requirements,
      howToJoin: sections.howToJoin,
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
  // `transfer` names a user id and is nobody's business but the owner's; it
  // reaches the composer through the roster route, which is already owner-only.
  const { recruiters, stats, hiddenBy, hiddenAt, transfer, ...publicClan } = clan;
  return withBumpState({
    ...publicClan,
    // Renamed tags land here rather than in every reader. The stored value is
    // left alone until the listing is next saved.
    playstyles: normalizePlaystyles(clan.playstyles),
    allianceName: alliance?.name || null,
    allianceTag: alliance?.tag || null,
    whisperName: whisperName(clan, db.users),
    ownerVerified: ownerVerified(clan, db.users),
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
      role: entry.role,
      label: entry.label,
    };
  });
}

// What the composer shows an owner about a pending offer: the name they typed,
// not the user id they never saw.
function transferView(clan, db) {
  const pending = normalizeTransfer(clan);
  if (!pending) return null;
  const user = (db.users || []).find((item) => item.id === pending.toUserId);
  return {
    userId: pending.toUserId,
    name: user?.forumName || user?.username || "(deleted account)",
    invitedAt: pending.invitedAt,
  };
}

function decorateAlliance(alliance, db, user = null) {
  const { hiddenBy, hiddenAt, ...publicAlliance } = alliance;
  return withBumpState({
    ...publicAlliance,
    ownerVerified: ownerVerified(alliance, db.users),
    ...listingPresence(alliance, db.users),
    memberClans: (db.clans || [])
      .filter((clan) => clan.allianceId === alliance.id && canSeeListing(user, clan))
      .map((clan) => decorateClan(clan, db)),
  });
}

// A player profile has exactly one contact - the person it describes - so it
// does not carry a roster, and its presence dot is simply theirs. `stats` is
// stripped for the same reason a clan's is: the view count is the owner's
// business.
function decoratePlayer(player, db) {
  const { stats, hiddenBy, hiddenAt, ...publicPlayer } = player;
  const owner = (db.users || []).find((item) => item.id === player.ownerId);
  return withBumpState({
    ...publicPlayer,
    playstyles: normalizePlaystyles(player.playstyles),
    // A profile picture is not something a player should have to upload twice.
    // It is read off their Discord account every time the profile is rendered,
    // so changing it on Discord changes it here with nothing to re-save. No
    // Discord picture means no image, and the card falls back to the mark.
    image: discordAvatarUrl(owner),
    whisperName: whisperName(player, db.users),
    ownerVerified: Boolean(owner?.forumVerified),
    ...listingPresence(player, db.users),
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "WF Clan Recruit",
    storage: postgresEnabled() ? "postgres" : "file",
    messaging: messagingUp,
    media: r2Enabled() ? "r2" : "local",
  });
});

app.get("/api/auth/me", (req, res) => {
  const user = currentUser(req);
  const account = publicAccount(user, { isProd });
  res.json({
    user: account
      ? {
          ...account,
          presence: { ...presenceOf(user), keepMinutes: keepMinutesOf(user) },
          keepMinutes: KEEP_MINUTES,
          invites: pendingInvitesFor(readDb(), user.id),
          transferInvites: transfersFor(readDb(), user.id),
          recruitingOn: recruitingOn(readDb(), user.id),
        }
      : null,
    auth: {
      discord: discordConfigured(),
      minAgeDays: DISCORD_MIN_AGE_DAYS,
      passwordRegister: !isProd,
      r2PublicUrl: r2PublicUrl() || "",
      messaging: messagingUp,
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
  res.json({
    presence: { ...presenceOf(req.user), keepMinutes: keepMinutesOf(req.user) },
    heartbeatMs: HEARTBEAT_MS,
  });
});

// A status change is a fact about someone that other people's inboxes are
// already showing. Push it down the stream that is open anyway rather than
// making every inbox poll for it: the alternative is an ONLINE label that only
// becomes true when the page is reloaded.
//
// Deliberately not awaited and deliberately silent. Presence is decoration -
// failing to deliver it must never fail the write that changed it, and
// messaging being down is a reason to skip this, not to error.
function announcePresence(userId, status) {
  if (!messagingUp) return;
  store
    .partnersOf(userId)
    .then((ids) => {
      for (const id of ids) {
        publish(id, "presence", { userId, status, online: status !== "invisible" });
      }
    })
    .catch((error) => {
      console.error("Could not announce a presence change:", error.message);
    });
}

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
      user.presenceKeep = until ? minutes : 0;
    }
    return db;
  });
  // Going invisible should drop the dot immediately rather than linger for a
  // heartbeat window.
  if (status === "invisible") forgetPresence(req.user.id);
  else touchPresence(req.user.id);
  announcePresence(req.user.id, status);
  res.json({ presence: { status, online: status !== "invisible", until, keepMinutes: minutes } });
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
      user.discordAvatar = discordUser.avatar || null;
      user.discordEmail = discordUser.email || null;
      applyPendingAdmin(db, user);
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
    transferInvites: transfersFor(db, user.id),
    clans: (db.clans || []).filter((item) => item.ownerId === user.id),
    alliances: (db.alliances || []).filter((item) => item.ownerId === user.id),
    players: (db.players || []).filter((item) => item.ownerId === user.id),
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
    for (const listing of [...(db.clans || []), ...(db.alliances || []), ...(db.players || [])].filter(
      (item) => item.ownerId === userId
    )) {
      removeStoredFile(listing.image);
      dropUnusedMedia(listing);
    }
    db.players = (db.players || []).filter((item) => item.ownerId !== userId);
    db.clans = (db.clans || [])
      .filter((item) => item.ownerId !== userId)
      .map((clan) => (droppedAlliances.has(clan.allianceId) ? { ...clan, allianceId: null } : clan))
      // Deleting an account also withdraws it from every listing it recruited
      // for, otherwise a dead user id sits on someone else's public roster.
      .map((clan) =>
        recruiterEntry(clan, userId)
          ? { ...clan, recruiters: normalizeRecruiters(clan.recruiters).filter((item) => item.userId !== userId) }
          : clan
      )
      // Same for an ownership offer waiting on them: there is nobody left to
      // accept it, and an offer that can never be answered blocks the owner
      // from making another one.
      .map((clan) =>
        normalizeTransfer(clan)?.toUserId === userId ? { ...clan, transfer: null } : clan
      );
    db.alliances = (db.alliances || []).filter((item) => item.ownerId !== userId);
    db.reports = (db.reports || []).map((item) =>
      item.reporterId === userId ? { ...item, reporterId: null } : item
    );
    db.sessions = (db.sessions || []).filter((item) => item.userId !== userId);
    db.users = (db.users || []).filter((item) => item.id !== userId);
    // The second storage lane is not part of this transaction, so it is asked
    // separately. Failing here must not fail the deletion the person asked for:
    // the account is already gone, and an orphaned membership row is a smaller
    // problem than a half-deleted account.
    store.dropUser(userId).catch((error) => {
      console.error("Could not clear messages for the deleted account:", error.message);
    });
    res.clearCookie(COOKIE, cookieOptions());
    res.json({ ok: true });
    return db;
  });
});

// Browse and the home page render cards; they never show the post body. Shipping
// `about` for every listing meant every visitor downloaded every full post on
// every page load, so list responses carry only what a card and the filters
// read. The detail route still returns the whole record.
const HEAVY_FIELDS = ["about", "offering", "requirements", "howToJoin", "video", "videos", "media", "links"];

function trimListing(item) {
  const out = { ...item };
  for (const field of HEAVY_FIELDS) delete out[field];
  // The browse filter matches role names and the card counts them, so roles
  // stay - stripped to what those two need. The descriptions are post-length
  // prose and belong on the detail route with the rest of the body.
  if (Array.isArray(out.roles)) {
    out.roles = out.roles.map(({ name, status, count }) => ({ name, status, count }));
  }
  if (out.memberClans) out.memberClans = out.memberClans.map(trimListing);
  return out;
}

app.get("/api/clans", (req, res) => {
  const db = readDb();
  const user = currentUser(req);
  const clans = db.clans
    .filter((clan) => canSeeListing(user, clan))
    .map((clan) => withOwnerStats(decorateClan(clan, db), clan, user))
    .sort(sortListings)
    .map(trimListing);
  res.json({ clans });
});

app.get("/api/clans/:id", (req, res) => {
  const db = readDb();
  const clan = db.clans.find((item) => item.id === req.params.id);
  const user = currentUser(req);
  if (!clan || !canSeeListing(user, clan)) {
    res.status(404).json({ error: "Clan not found." });
    return;
  }
  // Only the detail route returns the post body, so this is a read of the post
  // rather than a card impression.
  if (!clan.hidden && !looksLikeBot(req.headers["user-agent"])) countView(clan.id);
  res.json({ clan: withOwnerStats(decorateClan(clan, db), clan, user) });
});

app.post("/api/clans/:id/whisper", statsLimiter, (req, res) => {
  if (!looksLikeBot(req.headers["user-agent"])) countWhisper(String(req.params.id));
  res.json({ ok: true });
});

app.post("/api/clans", requirePoster, listingLimiter, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  if (!(await processListingImages(req, res))) return;
  const parsed = parseClanBody(req.body, req.user, req);
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
      featured: false,
      ownerId: req.user.id,
      createdAt: now,
      bumpedAt: now,
    };
    db.clans.unshift(clan);
    res.status(201).json({ clan: decorateClan(clan, db) });
    return db;
  }).catch(listingWriteFailed(req, res));
});

app.put("/api/clans/:id", requirePoster, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  if (!(await processListingImages(req, res))) return;
  const parsed = parseClanBody(req.body, req.user, req);
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
    if (!canEditListing(req.user, clan)) {
      discardUploads(req);
      res.status(403).json({ error: "You do not have edit access to that post." });
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
    dropUnusedMedia(clan, invited.media);
    Object.assign(clan, invited, {
      image: nextImage(clan.image, listingFile(req, "image")),
      // The owner's label is theirs. An editor saving the post keeps whatever
      // is already there rather than resetting it to the default their own
      // form sent, since their form does not offer the field at all.
      ownerLabel: clan.ownerId === req.user.id ? invited.ownerLabel : clan.ownerLabel || null,
    });
    res.json({ clan: decorateClan(clan, db) });
    return db;
  }).catch(listingWriteFailed(req, res));
});

app.post("/api/clans/:id/bump", requirePoster, async (req, res) => {
  const current = readDb().clans.find((item) => item.id === req.params.id);
  if (!current) {
    res.status(404).json({ error: "Clan not found." });
    return;
  }
  if (!canEditListing(req.user, current)) {
    res.status(403).json({ error: "You do not have edit access to that post." });
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
  if (!canEditListing(req.user, clan)) {
    res.status(403).json({ error: "You do not have edit access to that post." });
    return;
  }
  res.json({
    roster: rosterFor(clan, db),
    max: RECRUITER_MAX,
    ownerLabel: clan.ownerLabel || null,
    transfer: canRemove(req.user, clan) ? transferView(clan, db) : null,
  });
});

// Suggestions for the invite box. Scoped to a listing the caller owns rather
// than open to anyone signed in: the names offered are verified Warframe names,
// and the fewer places they can be enumerated from the better.
app.get("/api/clans/:id/recruiters/search", requireUser, recruiterSearchLimiter, (req, res) => {
  const db = readDb();
  const clan = db.clans.find((item) => item.id === req.params.id);
  if (!clan) {
    res.status(404).json({ error: "Clan not found." });
    return;
  }
  if (!canRemove(req.user, clan)) {
    res.status(403).json({ error: "You can only add recruiters to your own posts." });
    return;
  }
  res.json({
    names: searchRecruiterCandidates(db.users, clan, req.query?.q, RECRUITER_SEARCH_MAX),
  });
});

app.post("/api/clans/:id/recruiters", requireUser, (req, res) => {
  const username = String(req.body?.username || "").trim();
  const role = normalizeRecruiterRole(req.body?.role);
  const label = normalizeContactLabel(req.body?.label, "Recruiter");
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
    const invitee = findInvitee(db.users, username);
    const blocked = inviteBlocker(clan, invitee, { id: clan.ownerId });
    if (blocked) {
      res.status(400).json({ error: blocked });
      return db;
    }
    clan.recruiters = [
      ...normalizeRecruiters(clan.recruiters),
      { userId: invitee.id, status: "pending", role, label, invitedAt: new Date().toISOString(), respondedAt: null },
    ];
    res.json({ clan: decorateClan(clan, db), roster: rosterFor(clan, db) });
    return db;
  });
});

// One route for both halves of a roster row, because they are edited together:
// `role` is what they can do, `label` is what the post calls them. Only the
// label may arrive on its own - changing a title is not changing access.
app.post("/api/clans/:id/recruiters/:userId/role", requireUser, (req, res) => {
  const roleGiven = RECRUITER_ROLES.includes(String(req.body?.role || ""));
  const labelGiven = req.body?.label !== undefined;
  if (!roleGiven && !labelGiven) {
    res.status(400).json({ error: "Unknown role." });
    return;
  }
  const role = normalizeRecruiterRole(req.body?.role);
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      res.status(403).json({ error: "Only the owner can change what a recruiter can do." });
      return db;
    }
    const entries = normalizeRecruiters(clan.recruiters);
    const entry = entries.find((item) => item.userId === req.params.userId);
    if (!entry) {
      res.status(404).json({ error: "They are not on this listing." });
      return db;
    }
    if (roleGiven) entry.role = role;
    if (labelGiven) entry.label = normalizeContactLabel(req.body.label, "Recruiter");
    clan.recruiters = entries;
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

// Ownership moves, because the person who wrote the post is not always the
// person it belongs to - a recruiter sets one up, a leader steps down, someone
// builds the account on their leader's behalf. It moves the same way a
// recruiter invite does: an offer, pending until the other side accepts, since
// ownership carries delete rights and nobody should wake up holding those.
app.post("/api/clans/:id/transfer", requireUser, (req, res) => {
  const username = String(req.body?.username || "").trim();
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      res.status(403).json({ error: "Only the owner can hand this listing over." });
      return db;
    }
    const invitee = findInvitee(db.users, username);
    const blocked = transferBlocker(clan, invitee);
    if (blocked) {
      res.status(400).json({ error: blocked });
      return db;
    }
    offerTransfer(clan, invitee.id);
    res.json({ transfer: transferView(clan, db) });
    return db;
  });
});

app.delete("/api/clans/:id/transfer", requireUser, (req, res) => {
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      res.status(403).json({ error: "Only the owner can cancel this offer." });
      return db;
    }
    clearTransfer(clan);
    res.json({ transfer: null });
    return db;
  });
});

app.post("/api/clans/:id/transfer/respond", requireUser, (req, res) => {
  const accept = req.body?.accept === true || req.body?.accept === "true";
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (normalizeTransfer(clan)?.toUserId !== req.user.id) {
      res.status(404).json({ error: "No pending offer for you on that listing." });
      return db;
    }
    if (accept) applyTransfer(clan, req.user.id);
    else clearTransfer(clan);
    res.json({ ok: true, accepted: accept });
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
    if (!canEditListing(req.user, clan)) {
      res.status(403).json({ error: "You do not have edit access to that post." });
      return db;
    }
    clan.paused = Boolean(req.body.paused);
    res.json({ clan: decorateClan(clan, db) });
    return db;
  });
});

app.post("/api/clans/:id/hide", requireAdmin, (req, res) => {
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    const hidden = Boolean(req.body.hidden);
    clan.hidden = hidden;
    clan.hiddenAt = hidden ? new Date().toISOString() : null;
    clan.hiddenBy = hidden ? req.user.id : null;
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
    const list = kind === "clan" ? db.clans : kind === "player" ? db.players || [] : db.alliances;
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
    dropUnusedMedia(clan);
    const now = new Date().toISOString();
    db.reports = (db.reports || []).map((item) =>
      item.listingId === clan.id && item.status === "open"
        ? { ...item, status: "resolved", resolvedAt: now }
        : item
    );
    db.clans = db.clans.filter((item) => item.id !== clan.id);
    dropThreadsFor(clan.id);
    res.json({ ok: true });
    return db;
  });
});

// One profile per account. Two posts describing the same person is either a
// mistake or an attempt to take two slots on the board, and neither is worth
// supporting - so this is an upsert everywhere it is exposed, and a unique index
// on players.owner_id backs it up in Postgres.
function playerOf(db, userId) {
  return (db.players || []).find((item) => item.ownerId === userId) || null;
}

app.get("/api/players", (req, res) => {
  const db = readDb();
  const user = currentUser(req);
  const players = (db.players || [])
    .filter((player) => canSeeListing(user, player))
    .map((player) => withOwnerStats(decoratePlayer(player, db), player, user))
    .sort(sortListings)
    .map(trimListing);
  res.json({ players });
});

app.get("/api/players/:id", (req, res) => {
  const db = readDb();
  const player = (db.players || []).find((item) => item.id === req.params.id);
  const user = currentUser(req);
  if (!player || !canSeeListing(user, player)) {
    res.status(404).json({ error: "Player not found." });
    return;
  }
  if (!player.hidden && !looksLikeBot(req.headers["user-agent"])) countView(player.id);
  res.json({ player: withOwnerStats(decoratePlayer(player, db), player, user) });
});

app.post("/api/players/:id/whisper", statsLimiter, (req, res) => {
  if (!looksLikeBot(req.headers["user-agent"])) countWhisper(String(req.params.id));
  res.json({ ok: true });
});

// Signing in is the whole gate here, deliberately. `requirePoster` demands a
// verified forum profile, which is the right bar for advertising an
// organisation other people are asked to join. Asking to be recruited is the
// low-stakes direction, and gating it would empty the board before it filled.
// The one claim that still needs proof - an in-game name - is checked inside
// parsePlayerBody instead.
app.post("/api/players", requireUser, listingLimiter, playerUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  if (!(await processListingImages(req, res))) return;
  const parsed = parsePlayerBody(req.body, req.user, req);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }

  writeDb((db) => {
    if (playerOf(db, req.user.id)) {
      discardUploads(req);
      res.status(409).json({ error: "You already have a player profile. Edit that one instead." });
      return db;
    }
    const now = new Date().toISOString();
    const player = {
      id: slugify(parsed.fields.name),
      ...parsed.fields,
      ownerId: req.user.id,
      createdAt: now,
      bumpedAt: now,
    };
    db.players = db.players || [];
    db.players.unshift(player);
    res.status(201).json({ player: decoratePlayer(player, db) });
    return db;
  }).catch(listingWriteFailed(req, res));
});

app.put("/api/players/:id", requireUser, playerUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  if (!(await processListingImages(req, res))) return;
  const parsed = parsePlayerBody(req.body, req.user, req);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }

  writeDb((db) => {
    const player = (db.players || []).find((item) => item.id === req.params.id);
    if (!player) {
      discardUploads(req);
      res.status(404).json({ error: "Player not found." });
      return db;
    }
    // A player profile has no recruiters, so there is no editor to delegate to:
    // it is the owner or an admin, and nobody else.
    if (!canRemove(req.user, player)) {
      discardUploads(req);
      res.status(403).json({ error: "You can only edit your own profile." });
      return db;
    }
    dropUnusedMedia(player, parsed.fields.media);
    Object.assign(player, parsed.fields);
    res.json({ player: decoratePlayer(player, db) });
    return db;
  }).catch(listingWriteFailed(req, res));
});

app.post("/api/players/:id/bump", requireUser, async (req, res) => {
  const current = (readDb().players || []).find((item) => item.id === req.params.id);
  if (!current) {
    res.status(404).json({ error: "Player not found." });
    return;
  }
  if (!canRemove(req.user, current)) {
    res.status(403).json({ error: "You can only bump your own profile." });
    return;
  }
  const wait = bumpWaitMessage(current);
  if (wait) {
    res.status(429).json({ error: wait });
    return;
  }
  // Nothing external to re-check: a username is not a link that can rot, which
  // is most of why this side of the board publishes one.
  writeDb((db) => {
    const player = (db.players || []).find((item) => item.id === req.params.id);
    if (!player) {
      res.status(404).json({ error: "Player not found." });
      return db;
    }
    player.bumpedAt = new Date().toISOString();
    res.json({ player: decoratePlayer(player, db) });
    return db;
  });
});

app.post("/api/players/:id/pause", requireUser, (req, res) => {
  writeDb((db) => {
    const player = (db.players || []).find((item) => item.id === req.params.id);
    if (!player) {
      res.status(404).json({ error: "Player not found." });
      return db;
    }
    if (!canRemove(req.user, player)) {
      res.status(403).json({ error: "You can only pause your own profile." });
      return db;
    }
    player.paused = Boolean(req.body.paused);
    res.json({ player: decoratePlayer(player, db) });
    return db;
  });
});

app.post("/api/players/:id/hide", requireAdmin, (req, res) => {
  writeDb((db) => {
    const player = (db.players || []).find((item) => item.id === req.params.id);
    if (!player) {
      res.status(404).json({ error: "Player not found." });
      return db;
    }
    const hidden = Boolean(req.body.hidden);
    player.hidden = hidden;
    player.hiddenAt = hidden ? new Date().toISOString() : null;
    player.hiddenBy = hidden ? req.user.id : null;
    res.json({ player: decoratePlayer(player, db) });
    return db;
  });
});

app.post("/api/players/:id/report", reportLimiter, (req, res) => writeReport(req, res, "player"));

app.delete("/api/players/:id", requireUser, (req, res) => {
  writeDb((db) => {
    const player = (db.players || []).find((item) => item.id === req.params.id);
    if (!player) {
      res.status(404).json({ error: "Player not found." });
      return db;
    }
    if (!canRemove(req.user, player)) {
      res.status(403).json({ error: "You can only remove your own profile." });
      return db;
    }
    dropUnusedMedia(player);
    const now = new Date().toISOString();
    db.reports = (db.reports || []).map((item) =>
      item.listingId === player.id && item.status === "open"
        ? { ...item, status: "resolved", resolvedAt: now }
        : item
    );
    db.players = (db.players || []).filter((item) => item.id !== player.id);
    dropThreadsFor(player.id);
    res.json({ ok: true });
    return db;
  });
});

app.get("/api/alliances", (req, res) => {
  const db = readDb();
  const user = currentUser(req);
  const alliances = db.alliances
    .filter((item) => canSeeListing(user, item))
    .map((alliance) => decorateAlliance(alliance, db, user))
    .sort(sortListings)
    .map(trimListing);
  res.json({ alliances });
});

app.get("/api/alliances/:id", (req, res) => {
  const db = readDb();
  const user = currentUser(req);
  const alliance = db.alliances.find((item) => item.id === req.params.id);
  if (!alliance || !canSeeListing(user, alliance)) {
    res.status(404).json({ error: "Alliance not found." });
    return;
  }
  res.json({
    alliance: decorateAlliance(alliance, db, user),
  });
});

app.post("/api/alliances", requirePoster, listingLimiter, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  if (!(await processListingImages(req, res))) return;
  const parsed = parseAllianceBody(req.body, req.user, req);
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
      featured: false,
      ownerId: req.user.id,
      createdAt: now,
      bumpedAt: now,
    };
    db.alliances.unshift(alliance);
    applyAllianceRoster(db, alliance.id, req.user.id, rosterIds);
    res.status(201).json({ alliance: decorateAlliance(alliance, db) });
    return db;
  }).catch(listingWriteFailed(req, res));
});

app.put("/api/alliances/:id", requirePoster, listingUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  if (!(await processListingImages(req, res))) return;
  const parsed = parseAllianceBody(req.body, req.user, req);
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
    dropUnusedMedia(alliance, invited.media);
    Object.assign(alliance, invited, {
      image: nextImage(alliance.image, listingFile(req, "image")),
    });
    applyAllianceRoster(db, alliance.id, alliance.ownerId, rosterIds);
    res.json({ alliance: decorateAlliance(alliance, db) });
    return db;
  }).catch(listingWriteFailed(req, res));
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

app.post("/api/alliances/:id/hide", requireAdmin, (req, res) => {
  writeDb((db) => {
    const alliance = db.alliances.find((item) => item.id === req.params.id);
    if (!alliance) {
      res.status(404).json({ error: "Alliance not found." });
      return db;
    }
    const hidden = Boolean(req.body.hidden);
    alliance.hidden = hidden;
    alliance.hiddenAt = hidden ? new Date().toISOString() : null;
    alliance.hiddenBy = hidden ? req.user.id : null;
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

app.get("/api/admin/staff", requireAdmin, (req, res) => {
  res.json(staffList(readDb(), req.user.id));
});

app.get("/api/admin/staff/search", requireAdmin, staffSearchLimiter, (req, res) => {
  res.json({
    people: searchStaffCandidates(readDb().users, req.query?.q, req.user.id),
  });
});

app.post("/api/admin/staff", requireAdmin, staffLimiter, (req, res) => {
  writeDb((db) => {
    const userId = String(req.body?.userId || "").trim();
    const result = userId
      ? grantByUserId(db, userId, req.user)
      : grantStaff(db, req.body?.query || req.body?.discordId, req.user);
    if (result.error) {
      res.status(400).json({ error: result.error });
      return db;
    }
    res.json({ ok: true, pending: Boolean(result.pending), ...staffList(db, req.user.id) });
    return db;
  });
});

app.delete("/api/admin/staff/:id", requireAdmin, staffLimiter, (req, res) => {
  writeDb((db) => {
    const raw = String(req.params.id || "");
    const result = /^\d{17,20}$/.test(raw)
      ? revokeAdmin(db, { discordId: raw }, req.user)
      : revokeAdmin(db, { userId: raw }, req.user);
    if (result.error) {
      res.status(400).json({ error: result.error });
      return db;
    }
    res.json({ ok: true, ...staffList(db, req.user.id) });
    return db;
  });
});

app.get("/api/emojis", requireUser, (_req, res) => {
  res.json({ emojis: (readDb().emojis || []).map(publicEmoji) });
});

app.post("/api/admin/emojis", requireAdmin, staffLimiter, emojiUpload, async (req, res) => {
  if (!assertListingFiles(req, res)) return;
  if (!(await processEmojiImage(req, res))) return;
  const file = listingFile(req, "image");
  if (!file) {
    res.status(400).json({ error: "Choose a PNG, JPG, WEBP, or GIF." });
    return;
  }
  const name = normalizeEmojiName(req.body?.name);
  writeDb((db) => {
    if (!Array.isArray(db.emojis)) db.emojis = [];
    const problem = addEmojiError(db.emojis, name);
    if (problem) {
      removeStoredFile(savedUpload(file));
      res.status(400).json({ error: problem });
      return db;
    }
    db.emojis.push({
      id: store.newId("emoji"),
      name,
      url: savedUpload(file),
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
    });
    res.json({ emojis: db.emojis.map(publicEmoji) });
    return db;
  });
});

app.delete("/api/admin/emojis/:id", requireAdmin, staffLimiter, (req, res) => {
  writeDb((db) => {
    if (!Array.isArray(db.emojis)) db.emojis = [];
    const found = db.emojis.find((item) => item.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: "That emoji was not found." });
      return db;
    }
    removeStoredFile(found.url);
    db.emojis = db.emojis.filter((item) => item.id !== req.params.id);
    res.json({ emojis: db.emojis.map(publicEmoji) });
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
    dropUnusedMedia(alliance);
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
    dropThreadsFor(alliance.id);
    res.json({ ok: true });
    return db;
  });
});

// --- Messaging -------------------------------------------------------------
//
// Every route here reads through store.js rather than readDb: messages are the
// one thing on this site that grows without bound, and keeping them out of the
// in-memory database is the whole reason that lane exists.

const LISTING_COLLECTIONS = { clan: "clans", alliance: "alliances", player: "players" };

// Removing a post takes its conversations with it. Best effort for the same
// reason the account cascade is: the listing is already gone, and a stranded
// thread must not turn a successful delete into a 500.
function dropThreadsFor(listingId) {
  store.dropListing(listingId).catch((error) => {
    console.error("Could not clear conversations for the removed listing:", error.message);
  });
}

function listingFor(db, kind, id) {
  const collection = LISTING_COLLECTIONS[kind];
  if (!collection) return null;
  return (db[collection] || []).find((item) => item.id === id) || null;
}

function listingPath(kind, id) {
  return `/${LISTING_COLLECTIONS[kind] || "clans"}/${encodeURIComponent(id)}`;
}

// Who someone is inside a conversation. Never the account username - the board
// knows people by their verified in-game name or their Discord handle, and the
// inbox should call them the same thing the listing did.
// The forum name is only theirs to be called while the verification behind it
// stands. Changing a profile URL clears `forumVerified` and leaves `forumName`
// where it was (see the forum check route), so reading the name without the
// flag would keep introducing someone by a claim they no longer hold. This
// matches displayName() on the client.
function messengerOf(db, userId) {
  if (!userId) return { id: null, name: "(deleted account)", gone: true, verified: false };
  const user = (db.users || []).find((item) => item.id === userId);
  if (!user) return { id: userId, name: "(deleted account)", gone: true, verified: false };
  return {
    id: user.id,
    name: (user.forumVerified && user.forumName) || user.discordUsername || user.username,
    // The tick. Optional: nothing about messaging depends on it, and an
    // unverified account writes and is written to exactly the same.
    verified: Boolean(user.forumVerified),
    // Named for what userAvatar() and publicAccount() already call it. It was
    // `avatarUrl` here, which nothing on the client reads, so every inbox row
    // silently fell through to the clan mark and looked like a stale icon.
    discordAvatarUrl: discordAvatarUrl(user),
    gone: false,
  };
}

// The same self-declared status a listing card shows, on the person at the
// other end of a conversation. Shaped as `online` + `presenceStatus` because
// that is the pair presenceDot() on the client already reads, so the inbox row
// and the listing card draw the identical dot from the identical fields.
function withPresence(db, messenger) {
  if (!messenger?.id || messenger.gone) {
    return { ...messenger, online: false, presenceStatus: "offline" };
  }
  const user = (db.users || []).find((item) => item.id === messenger.id);
  const { status, online } = presenceOf(user);
  return { ...messenger, online, presenceStatus: online ? status : "offline" };
}

// `blocks` is the caller's own block list, read once per request and passed in:
// a block is what decides whether the conversation renders a composer at all,
// and asking the store for it once per thread would turn an inbox of thirty
// into thirty queries.
async function decorateThread(db, thread, userId, blocks = []) {
  const members = await store.membersOf(thread.id);
  const otherId = members.map((item) => item.userId).find((id) => id !== userId) || null;
  return {
    ...thread,
    with: withPresence(db, messengerOf(db, otherId)),
    href: listingPath(thread.kind, thread.listingId),
    preview: thread.last ? previewOf(thread.last.body) : "",
    // Without this the client had no way of knowing, so a block held until the
    // page was reloaded and then quietly appeared to have come undone.
    blocked: Boolean(otherId) && blockedBetween(blocks, userId, otherId),
  };
}

// Where this person's view of a conversation starts. Null unless they have
// deleted it, in which case everything up to that moment is not theirs to read.
function clearedAtFor(members, userId) {
  return members.find((item) => item.userId === userId)?.clearedAt || null;
}

// Membership is the authorisation. There is no "view any thread" path, for
// admins either: a private conversation is not moderation material until
// somebody reports it.
async function requireMember(req, res) {
  const thread = await store.getThread(req.params.id);
  if (!thread) {
    res.status(404).json({ error: "Conversation not found." });
    return null;
  }
  const members = await store.membersOf(thread.id);
  if (!members.some((item) => item.userId === req.user.id)) {
    res.status(403).json({ error: "That is not your conversation." });
    return null;
  }
  return { thread, members };
}

app.get("/api/messages", requireUser, requireStore, async (req, res) => {
  const db = readDb();
  const threads = await store.inboxFor(req.user.id);
  const blocks = await store.blocksFor(req.user.id);
  const decorated = [];
  for (const thread of threads) decorated.push(await decorateThread(db, thread, req.user.id, blocks));
  res.json({ threads: decorated });
});

// The live tap. Everything it carries is already stored, so a client that never
// connects loses nothing but immediacy.
//
// This must stay above "/api/messages/:id": Express matches in declaration
// order, and a path parameter will happily swallow the literal "stream".
app.get("/api/messages/stream", requireUser, requireStore, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx and friends buffer a streaming response by default, which holds
    // every event until the connection closes. This is the opt-out.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send("ready", { at: new Date().toISOString() });

  const unsubscribe = subscribe(req.user.id, send);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* the close handler cleans up */
    }
  }, PING_MS);

  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
    res.end();
  });
});

app.get("/api/messages/unread", requireUser, requireStore, async (req, res) => {
  res.json({ unread: await store.unreadTotal(req.user.id) });
});

// Blocking cuts both directions at once - see blockedBetween in messages.js.
app.post("/api/messages/block", requireUser, requireStore, async (req, res) => {
  const blockedId = String(req.body.userId || "");
  if (!blockedId || blockedId === req.user.id) {
    res.status(400).json({ error: "Pick someone to block." });
    return;
  }
  const on = req.body.blocked !== false;
  await store.setBlock(req.user.id, blockedId, on);
  res.json({ blocked: on });
});

// The people you have chosen not to hear from, as a list you can undo from.
// Until now a block could only be lifted from inside the conversation it was
// made in, which is exactly the conversation you stopped looking at.
//
// `blocksFor` returns rows in both directions, because deciding whether two
// people may talk does not care who pressed the button. This page does: it is
// your list of your own decisions, so only rows you own belong on it. Someone
// who ignored you is not shown - telling you would hand out a fact they did
// not choose to publish.
//
// Must stay above "/api/messages/:id" - Express matches in declaration order,
// and the parameter would happily swallow the literal "blocked". Same trap the
// stream route carries a note about.
app.get("/api/messages/blocked", requireUser, requireStore, async (req, res) => {
  const db = readDb();
  const rows = await store.blocksFor(req.user.id);
  const blocked = rows
    .filter((row) => row.userId === req.user.id)
    .map((row) => ({ ...messengerOf(db, row.blockedId), since: row.createdAt }))
    .sort((a, b) => new Date(b.since) - new Date(a.since));
  res.json({ blocked });
});

// Everything that decides whether these two may talk about this listing, in one
// place. The open route and the first send both run it, because the thread is
// no longer written until someone actually says something - so the send is
// where a brand new conversation gets checked.
async function conversationCheck(user, kind, listingId, otherId = null) {
  const db = readDb();
  const listing = listingFor(db, kind, listingId);
  const problem = openError({
    senderId: user.id,
    ownerId: listing?.ownerId,
    listingId: listing?.id,
  });
  if (problem) return { status: 400, error: problem };
  // Only ever the listing's owner. An id naming anyone else is not a
  // conversation this board offers, however well-formed it looks.
  if (otherId && otherId !== listing.ownerId) {
    return { status: 403, error: "That is not your conversation." };
  }
  const blocks = await store.blocksFor(user.id);
  if (blockedBetween(blocks, user.id, listing.ownerId)) {
    return { status: 403, error: "You cannot message that person." };
  }
  return { db, listing, blocks };
}

// Opening a conversation is separate from sending one, so the compose box can
// show the history with someone you have already written to rather than
// silently starting a second thread about the same listing.
//
// It deliberately writes nothing. Pressing Message and thinking better of it
// used to put an empty conversation in a stranger's inbox, which is a knock on
// the door from someone who never said anything. The thread starts at the first
// message; until then this hands back a draft, which is a real id and no row.
app.post("/api/messages/open", requireUser, requireStore, threadOpenLimiter, async (req, res) => {
  const kind = String(req.body.kind || "");
  const listingId = String(req.body.listingId || "");
  const checked = await conversationCheck(req.user, kind, listingId);
  if (checked.error) {
    res.status(checked.status).json({ error: checked.error });
    return;
  }
  const { db, listing, blocks } = checked;
  const id = threadIdFor(kind, listing.id, req.user.id, listing.ownerId);
  const existing = await store.getThread(id);
  if (!existing) {
    res.json({
      thread: {
        id,
        kind,
        listingId: listing.id,
        listingName: listing.name,
        draft: true,
        with: withPresence(db, messengerOf(db, listing.ownerId)),
        href: listingPath(kind, listing.id),
        preview: "",
        unread: 0,
        blocked: false,
      },
      messages: [],
    });
    return;
  }
  const members = await store.membersOf(id);
  const messages = await store.messagesIn(id, { since: clearedAtFor(members, req.user.id) });
  await store.markRead(id, req.user.id);
  res.json({
    thread: await decorateThread(
      db,
      { ...existing, last: messages[messages.length - 1] || null },
      req.user.id,
      blocks
    ),
    messages: messages.map((item) => ({ ...item, from: messengerOf(db, item.senderId) })),
  });
});

app.get("/api/messages/:id", requireUser, requireStore, async (req, res) => {
  const found = await requireMember(req, res);
  if (!found) return;
  const db = readDb();
  const messages = await store.messagesIn(found.thread.id, {
    since: clearedAtFor(found.members, req.user.id),
  });
  await store.markRead(found.thread.id, req.user.id);
  res.json({
    thread: await decorateThread(
      db,
      { ...found.thread, last: messages[messages.length - 1] || null },
      req.user.id,
      await store.blocksFor(req.user.id)
    ),
    messages: messages.map((item) => ({ ...item, from: messengerOf(db, item.senderId) })),
  });
});

// Deleting a conversation is one-sided: it leaves your inbox, the other person
// keeps theirs. A thread nobody can delete out from under the other side is
// also a thread that can still be reported after the fact.
app.delete("/api/messages/:id", requireUser, requireStore, async (req, res) => {
  const found = await requireMember(req, res);
  if (!found) return;
  await store.clearThread(found.thread.id, req.user.id);
  res.json({ ok: true, unread: await store.unreadTotal(req.user.id) });
});

// The first message is what creates the thread, so this is the one route that
// tolerates an id with no row behind it. The id is only a description of what
// to look up - kind, listing, and the two people - and every part of it is
// checked against the listing again before anything is written, which is the
// same check /open ran. An id naming a stranger, a gone listing, or a pair the
// caller is not half of buys nothing.
async function threadForSend(req, res) {
  const existing = await requireMemberQuietly(req);
  if (existing) return existing;
  const parsed = parseThreadId(req.params.id);
  if (!parsed || !parsed.userIds.includes(req.user.id)) {
    res.status(404).json({ error: "Conversation not found." });
    return null;
  }
  const otherId = parsed.userIds.find((id) => id !== req.user.id);
  const checked = await conversationCheck(req.user, parsed.kind, parsed.listingId, otherId);
  if (checked.error) {
    res.status(checked.status).json({ error: checked.error });
    return null;
  }
  const thread = await store.openThread({
    id: req.params.id,
    kind: parsed.kind,
    listingId: checked.listing.id,
    listingName: checked.listing.name,
    userIds: parsed.userIds,
  });
  return { thread, members: await store.membersOf(thread.id) };
}

// requireMember without the response: a missing thread is not yet an error on
// the send path, it is a conversation about to start.
async function requireMemberQuietly(req) {
  const thread = await store.getThread(req.params.id);
  if (!thread) return null;
  const members = await store.membersOf(thread.id);
  if (!members.some((item) => item.userId === req.user.id)) return null;
  return { thread, members };
}

app.post("/api/messages/:id", requireUser, requireStore, messageLimiter, async (req, res) => {
  const problem = bodyError(req.body.body);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const found = await threadForSend(req, res);
  if (!found) return;
  const otherId = found.members.map((item) => item.userId).find((id) => id !== req.user.id) || null;
  const blocks = await store.blocksFor(req.user.id);
  if (otherId && blockedBetween(blocks, req.user.id, otherId)) {
    res.status(403).json({ error: "You cannot message that person." });
    return;
  }
  const message = await store.addMessage({
    threadId: found.thread.id,
    senderId: req.user.id,
    body: normalizeBody(req.body.body),
  });
  const db = readDb();
  const from = messengerOf(db, req.user.id);
  // Best effort: the message is already durable, so a closed stream is not an
  // error, it just means they will see it on their next load.
  if (otherId) {
    publish(otherId, "message", {
      ...message,
      from,
      threadName: found.thread.listingName,
      href: listingPath(found.thread.kind, found.thread.listingId),
    });
  }
  res.status(201).json({ message: { ...message, from } });
});

app.post("/api/messages/:id/read", requireUser, requireStore, async (req, res) => {
  const found = await requireMember(req, res);
  if (!found) return;
  const readAt = await store.markRead(found.thread.id, req.user.id);
  res.json({ readAt, unread: await store.unreadTotal(req.user.id) });
});

app.post("/api/messages/:id/report", requireUser, requireStore, reportLimiter, async (req, res) => {
  const found = await requireMember(req, res);
  if (!found) return;
  const reason = String(req.body.reason || "");
  if (!REPORT_REASONS.includes(reason)) {
    res.status(400).json({ error: "Pick a report reason." });
    return;
  }
  writeDb((db) => {
    db.reports = db.reports || [];
    db.reports.unshift({
      id: `report-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      kind: "message",
      listingId: found.thread.listingId,
      listingName: found.thread.listingName,
      reason,
      details: String(req.body.details || "").slice(0, 400),
      reporterId: req.user.id,
      createdAt: new Date().toISOString(),
      status: "open",
    });
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
    sitemapXml(publicOrigin(req), {
      clans: db.clans || [],
      alliances: db.alliances || [],
      players: db.players || [],
    })
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
  const collections = { clan: db.clans, alliance: db.alliances, player: db.players };
  const listing = (collections[match.kind] || []).find((item) => item.id === match.id);
  const source = isProd ? path.join(distDir, "index.html") : indexPath;
  let html = fs.readFileSync(source, "utf8");
  html = applySocialMeta(
    html,
    listing && !listing.hidden ? listingSocial(origin, listing, match.kind) : defaultSocial(origin)
  );
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

// Listings written before the YouTube switch still point at an uploaded MP4
// that nothing can play. Clear those fields once and reclaim the volume.
async function clearUploadedVideos() {
  let files = [];
  await writeDb((db) => {
    files = dropLegacyVideos([...(db.clans || []), ...(db.alliances || [])]);
    return db;
  });
  for (const file of files) removeStoredFile(file);
  for (const name of fs.existsSync(paths.uploadDir) ? fs.readdirSync(paths.uploadDir) : []) {
    if (/\.(mp4|webm|m4v|mov)$/i.test(name)) {
      fs.rmSync(path.join(paths.uploadDir, name), { force: true });
    }
  }
  if (files.length) console.log(`Cleared ${files.length} uploaded video(s) from listings.`);
}

async function start() {
  setUploadPublicBase(r2PublicUrl());
  await initStorage();
  // The second storage lane comes up after the first, because on Postgres it
  // needs the pool that initStorage opened.
  //
  // Deliberately not fatal. The board - listings, accounts, the whole reason
  // the site exists - does not depend on this lane, and a messaging problem
  // taking down recruitment would be a far worse outage than messaging being
  // unavailable for an hour. So it is logged loudly, the feature switches off,
  // and everything else serves as normal.
  try {
    await store.initStore(paths.dataDir);
    messagingUp = true;
  } catch (error) {
    messagingUp = false;
    console.error("Messaging is unavailable: the message store failed to start.", error);
  }
  await clearUploadedVideos();
  const frontend = await attachFrontend();
  server = app.listen(PORT, "0.0.0.0");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  console.log(`WF Clan Recruit on http://localhost:${PORT}`);
  console.log(`Storage: ${storageLabel()}`);
  if (r2Enabled()) {
    console.log(`Media: Cloudflare R2 (${r2PublicUrl()})`);
  } else {
    console.log("Media: local /uploads");
    const missing = r2PartialEnv();
    if (missing.length) {
      console.warn(`R2 env is incomplete; missing ${missing.join(", ")}. Listing images stay on this server.`);
    }
  }
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
