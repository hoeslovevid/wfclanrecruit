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

const root = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = "wfr_session";
const PORT = Number(process.env.PORT || 3001);
const isProd = process.env.NODE_ENV === "production";
const TIER_CAPS = {
  Ghost: 10,
  Shadow: 30,
  Storm: 100,
  Mountain: 300,
  Moon: 1000,
};

ensureStorage();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, paths.uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(
      file.mimetype
    );
    cb(ok ? null : new Error("Image must be PNG, JPG, WEBP, GIF, or SVG."), ok);
  },
});

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

function allowedOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }
  const allowed = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
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
    .map((item) => item.trim())
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
  return {
    ...clan,
    allianceName: alliance?.name || null,
    allianceTag: alliance?.tag || null,
  };
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
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

app.post("/api/clans", requireUser, upload.single("image"), (req, res) => {
  const body = req.body;
  const playstyles = asArray(body.playstyles);
  const members = Number(body.members);
  const mrRequired = Number(body.mrRequired || 0);
  const tier = String(body.tier || "");
  const allianceId = String(body.allianceId || "") || null;

  if (!body.name || !body.tag || !body.headline || !body.summary || !body.about) {
    res.status(400).json({ error: "Fill every required field." });
    return;
  }
  if (playstyles.length === 0) {
    res.status(400).json({ error: "Pick at least one playstyle." });
    return;
  }
  if (!validateDiscord(body.discord)) {
    res.status(400).json({ error: "Use a discord.gg or discord.com/invite link." });
    return;
  }
  if (!TIER_CAPS[tier]) {
    res.status(400).json({ error: "Choose a valid clan tier." });
    return;
  }
  if (!Number.isFinite(members) || members < 1 || members > TIER_CAPS[tier]) {
    res.status(400).json({ error: `${tier} clans cap at ${TIER_CAPS[tier]} members.` });
    return;
  }

  writeDb((db) => {
    if (allianceId && !db.alliances.some((item) => item.id === allianceId)) {
      res.status(400).json({ error: "That alliance does not exist." });
      return db;
    }
    const clan = {
      id: slugify(body.name),
      name: String(body.name).slice(0, 48),
      tag: String(body.tag).toUpperCase().slice(0, 5),
      image: req.file ? `/uploads/${req.file.filename}` : null,
      platform: String(body.platform || "PC"),
      tier,
      members,
      mrRequired: Math.max(0, Math.min(36, mrRequired)),
      playstyles,
      region: String(body.region || "Global"),
      language: String(body.language || "English"),
      status: String(body.status || "Open"),
      leader: String(body.leader || req.user.username).slice(0, 32),
      discord: String(body.discord),
      founded: String(body.founded || new Date().getFullYear()),
      allianceId,
      headline: String(body.headline).slice(0, 90),
      summary: String(body.summary).slice(0, 220),
      about: String(body.about).slice(0, 1200),
      offering: lines(body.offering),
      requirements: lines(body.requirements),
      featured: false,
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
    };
    db.clans.unshift(clan);
    res.status(201).json({ clan: decorateClan(clan, db) });
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
    if (clan.ownerId !== req.user.id) {
      res.status(403).json({ error: "You can only remove your own posts." });
      return db;
    }
    if (clan.image?.startsWith("/uploads/")) {
      const file = path.join(paths.uploadDir, path.basename(clan.image));
      fs.rmSync(file, { force: true });
    }
    db.clans = db.clans.filter((item) => item.id !== clan.id);
    res.json({ ok: true });
    return db;
  });
});

app.get("/api/alliances", (_req, res) => {
  const db = readDb();
  const alliances = db.alliances
    .map((alliance) => ({
      ...alliance,
      memberClans: db.clans.filter((clan) => clan.allianceId === alliance.id).map((clan) => ({
        id: clan.id,
        name: clan.name,
        tag: clan.tag,
        image: clan.image,
      })),
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
    alliance: {
      ...alliance,
      memberClans: db.clans.filter((clan) => clan.allianceId === alliance.id),
    },
  });
});

app.post("/api/alliances", requireUser, upload.single("image"), (req, res) => {
  const body = req.body;
  const platforms = asArray(body.platforms);
  const clanCount = Number(body.clanCount);
  const members = Number(body.members);

  if (!body.name || !body.tag || !body.headline || !body.summary || !body.about) {
    res.status(400).json({ error: "Fill every required field." });
    return;
  }
  if (platforms.length === 0) {
    res.status(400).json({ error: "Pick at least one platform." });
    return;
  }
  if (!validateDiscord(body.discord)) {
    res.status(400).json({ error: "Use a discord.gg or discord.com/invite link." });
    return;
  }
  if (!Number.isFinite(clanCount) || clanCount < 1) {
    res.status(400).json({ error: "Enter how many clans are in the alliance." });
    return;
  }

  writeDb((db) => {
    const alliance = {
      id: slugify(body.name),
      name: String(body.name).slice(0, 48),
      tag: String(body.tag).toUpperCase().slice(0, 5),
      image: req.file ? `/uploads/${req.file.filename}` : null,
      platforms,
      region: String(body.region || "Global"),
      language: String(body.language || "English"),
      status: String(body.status || "Open"),
      clanCount,
      members: Number.isFinite(members) ? members : 0,
      discord: String(body.discord),
      headline: String(body.headline).slice(0, 90),
      summary: String(body.summary).slice(0, 220),
      about: String(body.about).slice(0, 1200),
      offering: lines(body.offering),
      requirements: lines(body.requirements),
      featured: false,
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
    };
    db.alliances.unshift(alliance);
    res.status(201).json({ alliance });
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
    if (alliance.ownerId !== req.user.id) {
      res.status(403).json({ error: "You can only remove your own posts." });
      return db;
    }
    if (alliance.image?.startsWith("/uploads/")) {
      const file = path.join(paths.uploadDir, path.basename(alliance.image));
      fs.rmSync(file, { force: true });
    }
    db.clans = db.clans.map((clan) =>
      clan.allianceId === alliance.id ? { ...clan, allianceId: null } : clan
    );
    db.alliances = db.alliances.filter((item) => item.id !== alliance.id);
    res.json({ ok: true });
    return db;
  });
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || "Request failed." });
});

const distDir = path.join(root, "..", "dist");
if (fs.existsSync(distDir)) {
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
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WF Clan Recruit on http://0.0.0.0:${PORT}`);
  console.log(`Storage: ${paths.dbPath}`);
});
