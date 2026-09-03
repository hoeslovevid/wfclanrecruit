import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./auth.js";
import { SEED_ALLIANCES, SEED_CLANS } from "./seed.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, "..");
const volume = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "";
const dataDir = volume || path.join(projectRoot, "data");
const uploadDir = volume ? path.join(volume, "uploads") : path.join(projectRoot, "uploads");
const dbPath = path.join(dataDir, "db.json");

export const paths = { dataDir, uploadDir, dbPath };

function emptyDb() {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: "user-leader",
        username: "leader",
        password: hashPassword("recruit1"),
        createdAt: now,
      },
    ],
    sessions: [],
    clans: SEED_CLANS.map((clan) => ({ ...clan, ownerId: "user-leader" })),
    alliances: SEED_ALLIANCES.map((alliance) => ({ ...alliance, ownerId: "user-leader" })),
  };
}

export function ensureStorage() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(emptyDb(), null, 2));
  }
}

export function readDb() {
  ensureStorage();
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

let queue = Promise.resolve();

export function writeDb(mutator) {
  queue = queue.then(() => {
    const db = readDb();
    const next = mutator(db) ?? db;
    fs.writeFileSync(dbPath, JSON.stringify(next, null, 2));
    return next;
  });
  return queue;
}
