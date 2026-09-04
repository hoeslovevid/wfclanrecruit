// Presence is two separate facts with very different lifetimes.
//
// The *choice* - online / in game / invisible, and how long to hold it - is a
// user setting. It changes a few times a day, so it lives on the user record
// and rides the normal writeDb path.
//
// The *liveness* - "this person's tab pinged us 40 seconds ago" - changes every
// heartbeat. It must never touch writeDb: persistTables() rewrites every user,
// session, listing and report in one transaction, so a per-heartbeat write
// would rewrite the whole database every minute per signed-in user. Liveness
// therefore lives in memory only, like the rate limiter in ratelimit.js, with
// the same caveats: single instance, and it resets on restart. A restart just
// means everyone looks offline until their next heartbeat, at most HEARTBEAT_MS
// later, except for people holding a timed status - that survives because the
// deadline is on the persisted record.

export const STATUSES = ["online", "ingame", "invisible"];
export const DEFAULT_STATUS = "online";

export const HEARTBEAT_MS = 60 * 1000;
// Two and a half missed heartbeats. Long enough to ride out a slow request or a
// backgrounded tab, short enough that a closed laptop drops off promptly.
export const STALE_AFTER_MS = 150 * 1000;

// Mirrors warframe.market's picker: hold the status after the tab closes.
// 0 means "only while the tab is open".
export const KEEP_MINUTES = [0, 30, 60, 120, 240];

const live = new Map();

const sweep = setInterval(() => {
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const [userId, seen] of live) {
    if (seen < cutoff) live.delete(userId);
  }
}, STALE_AFTER_MS);
sweep.unref();

export function touch(userId, now = Date.now()) {
  if (userId) live.set(userId, now);
}

export function forget(userId) {
  live.delete(userId);
}

export function lastSeen(userId) {
  return live.get(userId) || 0;
}

export function normalizeStatus(value) {
  return STATUSES.includes(value) ? value : DEFAULT_STATUS;
}

// 0 / missing means the status lasts only as long as the tab is open.
export function keepUntil(minutes, now = Date.now()) {
  const value = Number(minutes);
  if (!KEEP_MINUTES.includes(value) || value === 0) return null;
  return new Date(now + value * 60 * 1000).toISOString();
}

// Someone counts as online while their tab is pinging, or until a timed status
// they set runs out - whichever lasts longer. Invisible always wins.
export function presenceOf(user, now = Date.now()) {
  if (!user) return { status: "invisible", online: false, until: null };
  const status = normalizeStatus(user.presenceStatus);
  const until = user.presenceUntil || null;
  if (status === "invisible") return { status, online: false, until };
  const deadline = until ? new Date(until).getTime() : 0;
  const held = Number.isFinite(deadline) && now < deadline;
  const beating = now - lastSeen(user.id) < STALE_AFTER_MS;
  return { status, online: held || beating, until };
}

// What a listing card needs: whether to draw the dot, and which kind.
// Deliberately NOT called `status`: listings already have one (Open, Selective,
// Trial Required) that the pill and the browse filter read, and spreading this
// over it silently relabelled every card.
export function listingPresence(listing, users, now = Date.now()) {
  const owner = (users || []).find((user) => user.id === listing.ownerId);
  const { status, online } = presenceOf(owner, now);
  return { online, presenceStatus: online ? status : "offline" };
}
