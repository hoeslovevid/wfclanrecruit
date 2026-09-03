import { randomBytes } from "node:crypto";

export const DISCORD_MIN_AGE_DAYS = Math.max(1, Number(process.env.DISCORD_MIN_AGE_DAYS || 7));
export const FORUM_CHECK_COOLDOWN_MS = 30 * 1000;
export const LISTING_CREATE_COOLDOWN_MS = 15 * 60 * 1000;

const FORUM_PROFILE =
  /^https:\/\/forums\.warframe\.com\/profile\/[a-z0-9][a-z0-9\-_.]*\/?$/i;

export function discordConfigured() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function discordCreatedAt(id) {
  try {
    return Number(BigInt(id) >> 22n) + 1420070400000;
  } catch {
    return 0;
  }
}

export function discordAgeDays(id) {
  const created = discordCreatedAt(id);
  if (!created) return 0;
  return Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
}

export function newForumToken() {
  return `WFR-${randomBytes(5).toString("hex")}`;
}

export function normalizeForumUrl(value) {
  const raw = String(value || "").trim().split(/[?#]/)[0];
  if (!FORUM_PROFILE.test(raw)) return null;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export function forumNameFromUrl(url) {
  const slug = String(url || "")
    .replace(/\/+$/, "")
    .split("/")
    .pop() || "";
  const name = slug.replace(/^\d+-/, "").replace(/-/g, " ").trim();
  return name.slice(0, 48) || slug.slice(0, 48);
}

export function publishGate(user, { isProd }) {
  if (!user) {
    return { ok: false, reason: "auth", message: "Sign in with Discord to publish." };
  }
  if (user.admin) return { ok: true, reason: null, message: null };

  const skipExternal = !isProd && !discordConfigured();
  if (skipExternal) return { ok: true, reason: null, message: null };

  if (!user.discordId) {
    return { ok: false, reason: "discord", message: "Sign in with Discord before you publish." };
  }
  const age = discordAgeDays(user.discordId);
  if (age < DISCORD_MIN_AGE_DAYS) {
    return {
      ok: false,
      reason: "age",
      message: `Discord accounts must be at least ${DISCORD_MIN_AGE_DAYS} days old to post.`,
    };
  }
  if (!user.forumVerified) {
    return {
      ok: false,
      reason: "forum",
      message: "Verify your Warframe Forum account before you publish.",
    };
  }
  return { ok: true, reason: null, message: null };
}

export function publicAccount(user, { isProd }) {
  if (!user) return null;
  const gate = publishGate(user, { isProd });
  return {
    id: user.id,
    username: user.username,
    admin: Boolean(user.admin),
    createdAt: user.createdAt,
    discordId: user.discordId || null,
    discordUsername: user.discordUsername || null,
    discordAgeDays: user.discordId ? discordAgeDays(user.discordId) : null,
    forumVerified: Boolean(user.forumVerified),
    forumName: user.forumName || null,
    forumToken: user.forumVerified ? null : user.forumToken || null,
    forumProfileUrl: user.forumProfileUrl || null,
    canPublish: gate.ok,
    publishBlock: gate.ok ? null : gate.reason,
    minAgeDays: DISCORD_MIN_AGE_DAYS,
  };
}

export function uniqueDiscordUsername(db, discordUser) {
  const base = String(discordUser.global_name || discordUser.username || "tenno")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 16) || "tenno";
  const taken = (name) =>
    db.users.some((user) => user.username.toLowerCase() === name.toLowerCase());
  if (!taken(base) && base.length >= 3) return base.slice(0, 20);
  for (let i = 0; i < 20; i += 1) {
    const next = `${base.slice(0, 14)}${randomBytes(2).toString("hex")}`.slice(0, 20);
    if (!taken(next)) return next;
  }
  return `tenno${Date.now().toString(36)}`.slice(0, 20);
}

export async function readForumProfile(profileUrl) {
  const url = normalizeForumUrl(profileUrl);
  if (!url) {
    throw new Error("Use a forums.warframe.com/profile/... link.");
  }
  const res = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "WFClanRecruit/1.0 (account verification)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error("Could not load that forum profile. Check the URL and try again.");
  }
  const finalUrl = String(res.url || url).split(/[?#]/)[0];
  if (!normalizeForumUrl(finalUrl)) {
    throw new Error("That link did not stay on a Warframe Forum profile.");
  }
  const html = await res.text();
  return { html, url: normalizeForumUrl(finalUrl) };
}

export function profileHasToken(html, token) {
  if (!token || token.length < 8) return false;
  return String(html || "").includes(token);
}

export function listingCreateWait(db, userId) {
  const newest = [...(db.clans || []), ...(db.alliances || [])]
    .filter((item) => item.ownerId === userId)
    .reduce((max, item) => Math.max(max, new Date(item.createdAt).getTime() || 0), 0);
  if (!newest) return null;
  const wait = LISTING_CREATE_COOLDOWN_MS - (Date.now() - newest);
  if (wait <= 0) return null;
  const minutes = Math.max(1, Math.ceil(wait / 60000));
  return `Wait ${minutes} minute${minutes === 1 ? "" : "s"} before posting another listing.`;
}
