import { activityAt, isStale, STALE_AFTER_MS } from "../server/listing.js";
import { openRoles } from "./roles.js";

export const STALE_WARN_MS = 3 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const BUMP_PING_KEY = "wfr-bump-pinged";

export function msUntilStale(item, now = Date.now()) {
  const at = new Date(activityAt(item)).getTime();
  if (!Number.isFinite(at)) return Infinity;
  return STALE_AFTER_MS - (now - at);
}

export function needsBumpSoon(item, now = Date.now()) {
  if (!item || item.paused || item.hidden || isStale(item, now)) return false;
  return msUntilStale(item, now) <= STALE_WARN_MS;
}

export function needsBumpHighlight(item, now = Date.now()) {
  return Boolean(item?.stale) || isStale(item, now) || needsBumpSoon(item, now);
}

export function listingIssues(item, kind = "clan", now = Date.now()) {
  const issues = [];
  if (!item) return issues;
  if (kind !== "player" && item.inviteOk === false) {
    issues.push("The Discord invite failed a check.");
  }
  if (kind !== "player" && !item.image) issues.push("No listing image.");
  if (kind === "clan" && item.recruiting && !openRoles(item).length) {
    issues.push("No open roles listed.");
  }
  if (isStale(item, now) || item.stale) {
    issues.push("Stale. Discord is hidden until you bump.");
  } else if (needsBumpSoon(item, now)) {
    const days = Math.max(1, Math.ceil(msUntilStale(item, now) / DAY_MS));
    issues.push(`Goes stale in ${days} day${days === 1 ? "" : "s"}. Bump it to stay on the board.`);
  }
  return issues;
}

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

export function loadBumpPings(storage) {
  try {
    const raw = storageOf(storage)?.getItem?.(BUMP_PING_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function listingsDueForBumpPing(listings, { today = new Date().toISOString().slice(0, 10), storage } = {}) {
  const pinged = loadBumpPings(storage);
  const due = [];
  const next = { ...pinged };
  for (const item of listings || []) {
    if (!needsBumpSoon(item) && !item?.stale && !isStale(item)) continue;
    if (pinged[item.id] === today) continue;
    due.push(item);
    next[item.id] = today;
  }
  return { due, next };
}

export function saveBumpPings(next, storage) {
  try {
    storageOf(storage)?.setItem?.(BUMP_PING_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}
