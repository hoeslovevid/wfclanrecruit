// Read-only partner feed. The site's own `/api/clans` (and friends) are what
// the web app loads: they dump the board, count views, and can grow extra
// fields whenever the UI needs them. This module is the opposite contract —
// a small, named set of fields, paginated, that third-party apps can pin to
// without inheriting the next composer change.
//
// Hidden listings never appear here, even for a signed-in admin. Owner ids,
// pending invites, transfer offers, and view counts stay off it. A request
// through these routes is not a visit.

import { applyAllianceFilters, applyClanFilters, applyPlayerFilters, filtersFromSearch, paginate } from "../src/browse.js";
import { mediaList } from "../src/media.js";
import { isHidden } from "./listing.js";

export const PUBLIC_API_VERSION = 1;
export const PUBLIC_PAGE_SIZE = 25;
export const PUBLIC_PAGE_MAX = 50;
export const PUBLIC_RATE_LIMIT = 120;
export const PUBLIC_RATE_WINDOW_MS = 10 * 60 * 1000;

const AGENT_MIN = 3;

export function publicAgentError(userAgent) {
  const name = String(userAgent || "").trim();
  if (name.length < AGENT_MIN) {
    return "Name your client in the User-Agent header, for example MyWarframeBot/1.0.";
  }
  return null;
}

export function requirePublicAgent(req, res, next) {
  const error = publicAgentError(req.headers["user-agent"]);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  next();
}

export function pageSizeOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return PUBLIC_PAGE_SIZE;
  return Math.min(PUBLIC_PAGE_MAX, Math.floor(n));
}

export function queryFrom(req) {
  const url = String(req?.originalUrl || req?.url || "");
  const at = url.indexOf("?");
  return at >= 0 ? url.slice(at) : "";
}

export function publicFilters(req) {
  const { filters, page } = filtersFromSearch(queryFrom(req));
  return { filters, page, limit: pageSizeOf(req?.query?.limit) };
}

function absoluteUrl(origin, url) {
  const value = String(url || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${origin}${value}`;
  return value;
}

function publicRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return roles.map((role) => ({
    name: role?.name || "",
    status: role?.status || "Open",
    count: Number.isFinite(Number(role?.count)) ? Number(role.count) : 0,
  }));
}

function publicContacts(contacts) {
  if (!Array.isArray(contacts)) return [];
  return contacts.map((item) => ({
    name: item?.name || "",
    owner: Boolean(item?.owner),
    label: item?.label || "",
    online: Boolean(item?.online),
    presenceStatus: item?.presenceStatus || "offline",
  }));
}

function publicLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.map((item) => ({
    kind: item?.kind || "other",
    url: item?.url || "",
  }));
}

function publicMedia(listing, origin) {
  return mediaList(listing).map((item) => {
    if (item.kind === "video") return { kind: "video", id: item.id };
    return { kind: "image", url: absoluteUrl(origin, item.url) };
  });
}

function pageUrl(origin, kind, id) {
  const paths = { clan: "/clans", alliance: "/alliances", player: "/players" };
  return `${origin}${paths[kind]}/${encodeURIComponent(id)}`;
}

const CARD = {
  clan: [
    "id",
    "name",
    "tag",
    "headline",
    "summary",
    "platform",
    "tier",
    "members",
    "mrRequired",
    "inactiveDays",
    "playstyles",
    "region",
    "language",
    "status",
    "recruiting",
    "paused",
    "pauseReason",
    "stale",
    "featured",
    "founded",
    "discord",
    "contact",
    "leader",
    "whisperName",
    "ownerVerified",
    "online",
    "presenceStatus",
    "allianceId",
    "allianceName",
    "allianceTag",
    "createdAt",
    "bumpedAt",
  ],
  alliance: [
    "id",
    "name",
    "tag",
    "headline",
    "summary",
    "platforms",
    "region",
    "language",
    "status",
    "recruiting",
    "paused",
    "pauseReason",
    "stale",
    "featured",
    "clanCount",
    "members",
    "discord",
    "ownerVerified",
    "online",
    "presenceStatus",
    "createdAt",
    "bumpedAt",
  ],
  player: [
    "id",
    "name",
    "headline",
    "summary",
    "platform",
    "mr",
    "hours",
    "wantsTiers",
    "playstyles",
    "region",
    "language",
    "status",
    "recruiting",
    "paused",
    "pauseReason",
    "stale",
    "contact",
    "discordName",
    "whisperName",
    "ownerVerified",
    "online",
    "presenceStatus",
    "createdAt",
    "bumpedAt",
  ],
};

const LIST_KEYS = new Set(["playstyles", "platforms", "wantsTiers"]);

function copyCard(kind, listing, origin) {
  const out = { kind };
  for (const key of CARD[kind]) {
    const value = listing?.[key];
    if (LIST_KEYS.has(key)) {
      out[key] = Array.isArray(value) ? value : [];
      continue;
    }
    out[key] = value === undefined ? null : value;
  }
  out.image = absoluteUrl(origin, listing?.image);
  out.url = listing?.id ? pageUrl(origin, kind, listing.id) : null;
  out.recruiting = Boolean(listing?.recruiting);
  out.paused = Boolean(listing?.paused);
  out.stale = Boolean(listing?.stale);
  out.featured = Boolean(listing?.featured);
  out.ownerVerified = Boolean(listing?.ownerVerified);
  out.online = Boolean(listing?.online);
  out.presenceStatus = listing?.presenceStatus || "offline";
  out.pauseReason = listing?.paused ? String(listing.pauseReason || "") : "";
  if (kind === "clan" || kind === "alliance") out.roles = publicRoles(listing?.roles);
  if (kind === "clan") out.contacts = publicContacts(listing?.contacts);
  return out;
}

function withBody(listing, origin, card) {
  return {
    ...card,
    about: listing?.about || "",
    offering: listing?.offering || "",
    requirements: listing?.requirements || "",
    howToJoin: listing?.howToJoin || "",
    links: publicLinks(listing?.links),
    media: publicMedia(listing, origin),
  };
}

export function publicClan(listing, origin, { detail = false } = {}) {
  if (!listing || isHidden(listing)) return null;
  const card = copyCard("clan", listing, origin);
  return detail ? withBody(listing, origin, card) : card;
}

export function publicAlliance(listing, origin, { detail = false } = {}) {
  if (!listing || isHidden(listing)) return null;
  const card = copyCard("alliance", listing, origin);
  if (!detail) return card;
  return {
    ...withBody(listing, origin, card),
    memberClans: (listing?.memberClans || [])
      .map((clan) => publicClan(clan, origin, { detail: false }))
      .filter(Boolean),
  };
}

export function publicPlayer(listing, origin, { detail = false } = {}) {
  if (!listing || isHidden(listing)) return null;
  const card = copyCard("player", listing, origin);
  return detail ? withBody(listing, origin, card) : card;
}

const APPLY = {
  clan: applyClanFilters,
  alliance: applyAllianceFilters,
  player: applyPlayerFilters,
};

const TO_PUBLIC = {
  clan: publicClan,
  alliance: publicAlliance,
  player: publicPlayer,
};

export function publicPage(kind, listings, origin, { filters, page, limit }, { detail = false } = {}) {
  const visible = (listings || []).filter((item) => !isHidden(item));
  const filtered = APPLY[kind](visible, filters);
  const windowed = paginate(filtered, page, limit);
  const map = TO_PUBLIC[kind];
  return {
    items: windowed.items.map((item) => map(item, origin, { detail })).filter(Boolean),
    page: windowed.page,
    pages: windowed.pages,
    total: windowed.total,
    size: windowed.size,
  };
}

export function catalog(origin) {
  const base = `${origin}/api/v1`;
  return {
    ok: true,
    name: "WF Clan Recruit",
    version: PUBLIC_API_VERSION,
    readOnly: true,
    docs: `${base}`,
    userAgent: "Send a User-Agent that names your app, for example MyWarframeBot/1.0.",
    rateLimit: { limit: PUBLIC_RATE_LIMIT, windowSeconds: PUBLIC_RATE_WINDOW_MS / 1000 },
    page: { default: PUBLIC_PAGE_SIZE, max: PUBLIC_PAGE_MAX },
    filters: {
      q: "Search name, tag, headline, summary",
      platform: "PC, PlayStation, Xbox, Nintendo Switch, All Platforms",
      region: "Exact region label from the board",
      language: "Exact language label from the board",
      status: "Open, Selective, Trial Required (players use Looking, Casual, …)",
      recruiting: "1 is the default. Pass 0 to include paused and stale posts",
      online: "1 to keep only listings that are online right now",
      playstyle: "Repeat the parameter. Every value must be present",
      role: "Clans only: an open role name",
      tier: "Clans only",
      mr: "Clans: visitor MR ceiling. Players: minimum MR",
      hours: "Players only",
      sort: "newest (default). Clans also: open, space, mr, online. Players: mr",
      page: "1-based",
      limit: `Page size, ${PUBLIC_PAGE_SIZE} by default, ${PUBLIC_PAGE_MAX} at most`,
    },
    endpoints: [
      { method: "GET", path: `${base}/clans`, card: true },
      { method: "GET", path: `${base}/clans/:id`, detail: true },
      { method: "GET", path: `${base}/alliances`, card: true },
      { method: "GET", path: `${base}/alliances/:id`, detail: true },
      { method: "GET", path: `${base}/players`, card: true },
      { method: "GET", path: `${base}/players/:id`, detail: true },
    ],
  };
}
