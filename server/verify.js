import { randomBytes } from "node:crypto";

export const DISCORD_MIN_AGE_DAYS = Math.max(1, Number(process.env.DISCORD_MIN_AGE_DAYS || 7));
export const FORUM_CHECK_COOLDOWN_MS = 30 * 1000;
export const LISTING_CREATE_COOLDOWN_MS = 15 * 60 * 1000;

const FORUM_PROFILE =
  /^https:\/\/forums\.warframe\.com\/profile\/[a-z0-9][a-z0-9\-_.]*\/?$/i;
const FORUM_ABOUT_TAB = "field_core_pfield_1";
const FORUM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const FORUM_READER = "https://r.jina.ai/";

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

export function aboutMeUrl(profileUrl) {
  const url = normalizeForumUrl(profileUrl);
  return url ? `${url}?tab=${FORUM_ABOUT_TAB}` : null;
}

export function publishGate(user, { isProd }) {
  if (!user) {
    return { ok: false, reason: "auth", message: "Create an account with Discord to publish." };
  }
  if (user.admin) return { ok: true, reason: null, message: null };

  const skipExternal = !isProd && !discordConfigured();
  if (skipExternal) return { ok: true, reason: null, message: null };

  if (!user.discordId) {
    return { ok: false, reason: "discord", message: "Create an account with Discord before you publish." };
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
    forumAboutMeUrl: aboutMeUrl(user.forumProfileUrl),
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

function isBlockedPage(status, body) {
  if (status === 403 || status === 503) return true;
  const text = String(body || "").toLowerCase();
  return (
    text.includes("just a moment") ||
    text.includes("performing security verification") ||
    text.includes("cf-browser-verification") ||
    text.includes("enable javascript and cookies to continue")
  );
}

function assertSameProfile(requested, found) {
  const expected = normalizeForumUrl(requested);
  const actual = normalizeForumUrl(found);
  if (!expected || !actual || expected !== actual) {
    throw new Error("That link did not stay on a Warframe Forum profile.");
  }
  return expected;
}

async function fetchDirectProfile(url) {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": FORUM_UA,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    const html = await res.text();
    if (!res.ok || isBlockedPage(res.status, html)) return null;
    return { html, source: res.url || url };
  } catch {
    return null;
  }
}

async function fetchProfileViaReader(url) {
  const headers = {
    Accept: "application/json",
    "X-No-Cache": "true",
  };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }
  const res = await fetch(`${FORUM_READER}${url}`, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error("Could not load that forum profile right now. Wait a few seconds and try again.");
  }
  let text = raw;
  let source = url;
  try {
    const payload = JSON.parse(raw);
    const data = payload.data || payload;
    text = data.text || data.content || data.html || "";
    source = data.url || source;
  } catch {
    const match = raw.match(/^URL Source:\s*(\S+)/m);
    if (match) source = match[1];
    const idx = raw.indexOf("Markdown Content:");
    text = idx >= 0 ? raw.slice(idx) : raw;
  }
  if (!text || isBlockedPage(200, text)) {
    throw new Error("Warframe Forums blocked the profile check. Try again in a moment.");
  }
  return { html: text, source };
}

export async function readForumProfile(profileUrl) {
  const url = normalizeForumUrl(profileUrl);
  if (!url) {
    throw new Error("Use a forums.warframe.com/profile/... link.");
  }
  const target = aboutMeUrl(url);
  let page = await fetchDirectProfile(target);
  if (!page) {
    // Forums sit behind Cloudflare; anonymous server fetches get 403.
    // A logged-in forum bot on Railway hits the same wall. Read About Me
    // through a browser-based reader instead of storing forum cookies.
    page = await fetchProfileViaReader(target);
  }
  const canonical = assertSameProfile(url, page.source);
  return { html: page.html, url: canonical };
}

export function profileHasToken(html, token) {
  if (!token || token.length < 8) return false;
  return String(html || "").toLowerCase().includes(String(token).toLowerCase());
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
