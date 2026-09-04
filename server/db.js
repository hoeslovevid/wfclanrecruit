import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "./auth.js";
import { closePg, connectPg, loadState, postgresEnabled, saveState } from "./pg.js";

const SEED_LISTING_IDS = new Set([
  "steel-meridian-vanguard",
  "lotus-garden",
  "void-walkers",
  "cetus-collective",
  "orokin-restoration",
  "dry-dock-irregulars",
  "nightwave-scribes",
  "sanguine-court",
  "solar-rail",
  "quiet-hours",
  "northern-command",
]);

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, "..");
const volume = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "";
const dataDir = volume || path.join(projectRoot, "data");
const uploadDir = volume ? path.join(volume, "uploads") : path.join(projectRoot, "uploads");
const dbPath = path.join(dataDir, "db.json");

let storageReady = false;
let cache = null;
let usingPostgres = false;

export const paths = { dataDir, uploadDir, dbPath };

const isProd = process.env.NODE_ENV === "production";
const DEMO_USER_ID = "user-leader";

function emptyDb() {
  return {
    users: [],
    sessions: [],
    clans: [],
    alliances: [],
    reports: [],
  };
}

function stripSeedListings(db) {
  const clans = (db.clans || []).filter((item) => !SEED_LISTING_IDS.has(item.id));
  const alliances = (db.alliances || []).filter((item) => !SEED_LISTING_IDS.has(item.id));
  if (clans.length === (db.clans || []).length && alliances.length === (db.alliances || []).length) {
    return db;
  }
  return { ...db, clans, alliances };
}

function stripDemoUser(db) {
  if (!isProd) return db;
  const users = (db.users || []).filter((user) => user.id !== DEMO_USER_ID);
  const sessions = (db.sessions || []).filter((session) => session.userId !== DEMO_USER_ID);
  if (users.length === (db.users || []).length && sessions.length === (db.sessions || []).length) {
    return db;
  }
  return { ...db, users, sessions };
}

function sanitizeDb(db) {
  return stripDemoUser(stripSeedListings(db));
}

function adminCredentials() {
  const username = String(process.env.ADMIN_USERNAME || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");
  return { username, password };
}

async function bootstrapAdmin(db) {
  const { username, password } = adminCredentials();
  if (!username && !password) return { db, changed: false };
  if (!username || !password) {
    console.warn("Set both ADMIN_USERNAME and ADMIN_PASSWORD to create the admin account.");
    return { db, changed: false };
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    console.warn("ADMIN_USERNAME must be 3–20 letters, numbers, or underscores.");
    return { db, changed: false };
  }
  if (password.length < 6) {
    console.warn("ADMIN_PASSWORD must be at least 6 characters.");
    return { db, changed: false };
  }

  let changed = false;
  const users = db.users || [];
  let admin = users.find((user) => user.username.toLowerCase() === username.toLowerCase());

  if (!admin) {
    const takenId = users.some((user) => user.id === "user-admin");
    admin = {
      id: takenId ? `user-admin-${Date.now().toString(36)}` : "user-admin",
      username,
      password: await hashPassword(password),
      admin: true,
      createdAt: new Date().toISOString(),
    };
    users.push(admin);
    changed = true;
    console.log(`Admin account created: ${username}`);
  } else {
    if (!admin.admin) {
      admin.admin = true;
      changed = true;
    }
    if (admin.username !== username) {
      admin.username = username;
      changed = true;
    }
    if (!(await verifyPassword(password, admin.password))) {
      admin.password = await hashPassword(password);
      changed = true;
      console.log(`Admin password updated for ${username}`);
    }
  }

  for (const user of users) {
    if (user.id !== admin.id && user.admin) {
      user.admin = false;
      changed = true;
    }
  }

  db.users = users;
  return { db, changed };
}

// #4: a torn write on restart used to leave db.json unparseable and lose
// everything. Write to a temp file and rename, which is atomic on POSIX.
function writeDbFile(db) {
  const next = { reports: [], ...db };
  if (!usingPostgres) {
    const tmp = `${dbPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, dbPath);
  }
  cache = next;
}

async function persist(db) {
  if (usingPostgres) await saveState(db);
}

// #8/#12: expired sessions used to accumulate forever, contradicting the
// 30-day retention the privacy policy states.
function pruneSessions(db) {
  const now = Date.now();
  const sessions = (db.sessions || []).filter((session) => session.expires > now);
  if (sessions.length === (db.sessions || []).length) return db;
  return { ...db, sessions };
}

export function ensureStorage() {
  if (storageReady) return;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  if (!usingPostgres && !fs.existsSync(dbPath)) writeDbFile(emptyDb());
  storageReady = true;
}

export async function initStorage() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  usingPostgres = postgresEnabled();
  if (usingPostgres) {
    await connectPg();
    const existing = await loadState();
    if (existing && ((existing.users || []).length || (existing.clans || []).length || (existing.alliances || []).length || (existing.reports || []).length)) {
      cache = { ...emptyDb(), ...existing };
    } else if (fs.existsSync(dbPath)) {
      cache = { ...emptyDb(), ...JSON.parse(fs.readFileSync(dbPath, "utf8")) };
      await saveState(cache);
      console.log("Imported db.json into Postgres.");
    } else {
      cache = emptyDb();
      await saveState(cache);
    }
    storageReady = true;
  } else {
    if (!fs.existsSync(dbPath)) writeDbFile(emptyDb());
    cache = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    if (!Array.isArray(cache.reports)) cache.reports = [];
    storageReady = true;
  }

  const current = cache;
  const sanitized = pruneSessions(sanitizeDb(current));
  if (!isProd && !sanitized.users.some((user) => user.id === DEMO_USER_ID)) {
    sanitized.users.push({
      id: DEMO_USER_ID,
      username: "leader",
      password: await hashPassword("recruit1"),
      admin: false,
      createdAt: new Date().toISOString(),
    });
  }
  const { db: next } = await bootstrapAdmin(sanitized);
  writeDbFile(next);
  await persist(next);
}

export function readDb() {
  ensureStorage();
  if (!cache) {
    if (usingPostgres) throw new Error("Database is not ready.");
    cache = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  }
  if (!Array.isArray(cache.reports)) cache.reports = [];
  return cache;
}

let queue = Promise.resolve();

export function writeDb(mutator) {
  const run = async () => {
    const db = readDb();
    try {
      const next = mutator(db) ?? db;
      if (!Array.isArray(next.reports)) next.reports = [];
      writeDbFile(next);
      await persist(next);
      return next;
    } catch (error) {
      cache = null;
      throw error;
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

export function storageLabel() {
  return usingPostgres ? "Postgres" : paths.dbPath;
}

export { closePg, postgresEnabled };
