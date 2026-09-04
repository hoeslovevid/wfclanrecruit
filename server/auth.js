import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const next = await scryptAsync(password, salt, 64);
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    admin: Boolean(user.admin),
    createdAt: user.createdAt,
  };
}
