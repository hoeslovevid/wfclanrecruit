import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword, newToken, publicUser, verifyPassword } from "./auth.js";
import { ensureStorage, paths, readDb, writeDb } from "./db.js";
import { aboutTooLong, normalizeAbout, plainTextFromHtml } from "../src/richtext.js";

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

ensureStorage();

const IMAGE_MAX = 2 * 1024 * 1024;
const VIDEO_MAX = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".m4v"]);
const EXT_BY_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, paths.uploadDir),
    filename: (_req, file, cb) => {
      const fromName = path.extname(file.originalname || "").toLowerCase();
      const ext = fromName || EXT_BY_TYPE[file.mimetype] || ".bin";
      cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: VIDEO_MAX, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (file.fieldname === "image") {
      const ok = IMAGE_TYPES.has(file.mimetype) || IMAGE_EXTS.has(ext);
      cb(ok ? null : new Error("Image must be PNG, JPG, WEBP, GIF, or SVG."), ok);
      return;
    }
    if (file.fieldname === "video") {
      const ok = VIDEO_TYPES.has(file.mimetype) || VIDEO_EXTS.has(ext);
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
app.use("/uploads", express.static(paths.uploadDir));
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

function canRemove(user, listing) {
  return Boolean(user.admin) || listing.ownerId === user.id;
}

const BUMP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function activityAt(item) {
  return item.bumpedAt || item.createdAt;
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
  return {
    ...item,
    canBump: Date.now() >= new Date(readyAt).getTime(),
    bumpReadyAt: readyAt,
  };
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
  if (!validateDiscord(body.discord)) {
    return { error: "Use a discord.gg or discord.com/invite link." };
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
      leader: String(body.leader || user.username).slice(0, 32),
      discord: String(body.discord),
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
      headline: String(body.headline).slice(0, 90),
      summary: String(body.summary).slice(0, 220),
      about,
      offering: lines(body.offering),
      requirements: lines(body.requirements),
    },
  };
}

function allowedOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }
  const allowed = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    process.env.FRONTEND_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
  ].filter(Boolean));
  const railwayHost = origin.endsWith(".up.railway.app") || origin.endsWith(".railway.app");
  callback(null, allowed.has(origin) || railwayHost);
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
  return /^https?:\/\/(discord\.gg|discord\.com\/invite)\//i.test(String(url || ""));
}

function decorateClan(clan, db) {
  const alliance = db.alliances.find((item) => item.id === clan.allianceId);
  return withBumpState({
    ...clan,
    allianceName: alliance?.name || null,
    allianceTag: alliance?.tag || null,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "WF Clan Recruit" });
});

app.get("/api/auth/me", (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.post("/api/auth/register", (req, res) => {
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

  writeDb((db) => {
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      res.status(409).json({ error: "That username is taken." });
      return db;
    }
    const user = {
      id: slugify(username),
      username,
      password: hashPassword(password),
      admin: false,
      createdAt: new Date().toISOString(),
    };
    const token = newToken();
    db.users.push(user);
    db.sessions.push({ token, userId: user.id, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    setSession(res, token);
    res.status(201).json({ user: publicUser(user) });
    return db;
  }).catch((error) => {
    if (!res.headersSent) res.status(500).json({ error: error.message });
  });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.password)) {
    res.status(401).json({ error: "Wrong username or password." });
    return;
  }
  const token = newToken();
  writeDb((next) => {
    next.sessions.push({ token, userId: user.id, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    return next;
  }).then(() => {
    setSession(res, token);
    res.json({ user: publicUser(user) });
  });
});

app.post("/api/auth/logout", (req, res) => {
  const token = req.cookies[COOKIE];
  writeDb((db) => {
    db.sessions = db.sessions.filter((item) => item.token !== token);
    return db;
  }).then(() => {
    res.clearCookie(COOKIE, cookieOptions());
    res.json({ ok: true });
  });
});

app.get("/api/clans", (_req, res) => {
  const db = readDb();
  const clans = db.clans
    .map((clan) => decorateClan(clan, db))
    .sort((a, b) => new Date(activityAt(b)) - new Date(activityAt(a)));
  res.json({ clans });
});

app.get("/api/clans/:id", (req, res) => {
  const db = readDb();
  const clan = db.clans.find((item) => item.id === req.params.id);
  if (!clan) {
    res.status(404).json({ error: "Clan not found." });
    return;
  }
  res.json({ clan: decorateClan(clan, db) });
});

app.post("/api/clans", requireUser, listingUpload, (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseClanBody(req.body, req.user);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }

  writeDb((db) => {
    if (parsed.fields.allianceId && !db.alliances.some((item) => item.id === parsed.fields.allianceId)) {
      discardUploads(req);
      res.status(400).json({ error: "That alliance does not exist." });
      return db;
    }
    const now = new Date().toISOString();
    const clan = {
      id: slugify(parsed.fields.name),
      ...parsed.fields,
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

app.put("/api/clans/:id", requireUser, listingUpload, (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseClanBody(req.body, req.user);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
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
    if (parsed.fields.allianceId && !db.alliances.some((item) => item.id === parsed.fields.allianceId)) {
      discardUploads(req);
      res.status(400).json({ error: "That alliance does not exist." });
      return db;
    }
    Object.assign(clan, parsed.fields, {
      image: nextImage(clan.image, listingFile(req, "image")),
      video: nextVideo(clan.video, listingFile(req, "video"), req.body.removeVideo),
    });
    res.json({ clan: decorateClan(clan, db) });
    return db;
  });
});

app.post("/api/clans/:id/bump", requireUser, (req, res) => {
  writeDb((db) => {
    const clan = db.clans.find((item) => item.id === req.params.id);
    if (!clan) {
      res.status(404).json({ error: "Clan not found." });
      return db;
    }
    if (!canRemove(req.user, clan)) {
      res.status(403).json({ error: "You can only bump your own posts." });
      return db;
    }
    const wait = bumpWaitMessage(clan);
    if (wait) {
      res.status(429).json({ error: wait });
      return db;
    }
    clan.bumpedAt = new Date().toISOString();
    res.json({ clan: decorateClan(clan, db) });
    return db;
  });
});

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
    db.clans = db.clans.filter((item) => item.id !== clan.id);
    res.json({ ok: true });
    return db;
  });
});

app.get("/api/alliances", (_req, res) => {
  const db = readDb();
  const alliances = db.alliances
    .map((alliance) =>
      withBumpState({
        ...alliance,
        memberClans: db.clans.filter((clan) => clan.allianceId === alliance.id).map((clan) => ({
          id: clan.id,
          name: clan.name,
          tag: clan.tag,
          image: clan.image,
        })),
      })
    )
    .sort((a, b) => new Date(activityAt(b)) - new Date(activityAt(a)));
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
    alliance: withBumpState({
      ...alliance,
      memberClans: db.clans.filter((clan) => clan.allianceId === alliance.id),
    }),
  });
});

app.post("/api/alliances", requireUser, listingUpload, (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseAllianceBody(req.body);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
    return;
  }

  writeDb((db) => {
    const now = new Date().toISOString();
    const alliance = {
      id: slugify(parsed.fields.name),
      ...parsed.fields,
      image: savedUpload(listingFile(req, "image")),
      video: savedUpload(listingFile(req, "video")),
      featured: false,
      ownerId: req.user.id,
      createdAt: now,
      bumpedAt: now,
    };
    db.alliances.unshift(alliance);
    res.status(201).json({ alliance: withBumpState(alliance) });
    return db;
  });
});

app.put("/api/alliances/:id", requireUser, listingUpload, (req, res) => {
  if (!assertListingFiles(req, res)) return;
  const parsed = parseAllianceBody(req.body);
  if (parsed.error) {
    discardUploads(req);
    res.status(400).json({ error: parsed.error });
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
    Object.assign(alliance, parsed.fields, {
      image: nextImage(alliance.image, listingFile(req, "image")),
      video: nextVideo(alliance.video, listingFile(req, "video"), req.body.removeVideo),
    });
    res.json({ alliance: withBumpState(alliance) });
    return db;
  });
});

app.post("/api/alliances/:id/bump", requireUser, (req, res) => {
  writeDb((db) => {
    const alliance = db.alliances.find((item) => item.id === req.params.id);
    if (!alliance) {
      res.status(404).json({ error: "Alliance not found." });
      return db;
    }
    if (!canRemove(req.user, alliance)) {
      res.status(403).json({ error: "You can only bump your own posts." });
      return db;
    }
    const wait = bumpWaitMessage(alliance);
    if (wait) {
      res.status(429).json({ error: wait });
      return db;
    }
    alliance.bumpedAt = new Date().toISOString();
    res.json({ alliance: withBumpState(alliance) });
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
    db.clans = db.clans.map((clan) =>
      clan.allianceId === alliance.id ? { ...clan, allianceId: null } : clan
    );
    db.alliances = db.alliances.filter((item) => item.id !== alliance.id);
    res.json({ ok: true });
    return db;
  });
});

app.use((error, _req, res, _next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Video must be 25 MB or smaller. Images must be 2 MB." });
    return;
  }
  res.status(400).json({ error: error.message || "Request failed." });
});

const distDir = path.join(root, "..", "dist");

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
    res.sendFile(path.join(distDir, "index.html"));
  });
  return "build";
}

let server;

async function start() {
  const frontend = await attachFrontend();
  server = app.listen(PORT, "0.0.0.0");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  console.log(`WF Clan Recruit on http://localhost:${PORT}`);
  console.log(`Storage: ${paths.dbPath}`);
  console.log(`Frontend: ${frontend === "live" ? "live source (same app as production)" : "production dist build"}`);
}

start().catch((error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process, then run npm run dev again.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
