import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_PAGE_MAX,
  PUBLIC_PAGE_SIZE,
  catalog,
  pageSizeOf,
  publicAgentError,
  publicAlliance,
  publicClan,
  publicPage,
  publicPlayer,
} from "./public-api.js";

const ORIGIN = "https://wfclanrecruit.example";

const clan = {
  id: "steel",
  name: "Steel Meridian",
  tag: "SM",
  headline: "Endgame",
  summary: "Steel Path nights",
  about: "<p>Dojo is open.</p>",
  offering: "<p>Forma</p>",
  requirements: "<p>MR 10</p>",
  howToJoin: "<p>Join Discord</p>",
  image: "/uploads/steel.webp",
  platform: "PC",
  tier: "Moon",
  members: 40,
  mrRequired: 10,
  inactiveDays: 14,
  playstyles: ["Steel Path"],
  region: "North America",
  language: "English",
  status: "Open",
  recruiting: true,
  paused: false,
  stale: false,
  featured: false,
  founded: "2018",
  discord: "https://discord.gg/steel",
  contact: "both",
  leader: "Cressa",
  whisperName: "--Cressa--",
  ownerVerified: true,
  online: true,
  presenceStatus: "ingame",
  allianceId: "steel-all",
  allianceName: "Steel",
  allianceTag: "STL",
  createdAt: "2026-08-01T00:00:00.000Z",
  bumpedAt: "2026-09-04T00:00:00.000Z",
  roles: [{ name: "Architect", status: "Open", count: 1, description: "<p>secret</p>" }],
  contacts: [{ name: "--Cressa--", owner: true, label: "Warlord", online: true, presenceStatus: "ingame", userId: "leak" }],
  links: [{ kind: "wiki", url: "https://wiki.example/steel" }],
  media: [{ kind: "video", id: "dQw4w9wgGcQ" }, { kind: "image", url: "/uploads/dojo.webp" }],
  ownerId: "user-secret",
  recruiters: [{ userId: "user-2", status: "pending" }],
  transfer: { toUserId: "user-3" },
  stats: { views: 9000 },
  canBump: true,
  bumpReadyAt: "2026-09-05T00:00:00.000Z",
  hiddenBy: "admin",
};

test("a public clan card is the published post, not the account behind it", () => {
  const card = publicClan(clan, ORIGIN);
  assert.equal(card.kind, "clan");
  assert.equal(card.id, "steel");
  assert.equal(card.url, `${ORIGIN}/clans/steel`);
  assert.equal(card.image, `${ORIGIN}/uploads/steel.webp`);
  assert.equal(card.discord, "https://discord.gg/steel");
  assert.deepEqual(card.roles, [{ name: "Architect", status: "Open", count: 1 }]);
  assert.deepEqual(card.contacts, [
    { name: "--Cressa--", owner: true, label: "Warlord", online: true, presenceStatus: "ingame" },
  ]);
  assert.equal(card.about, undefined);
  assert.equal(card.ownerId, undefined);
  assert.equal(card.recruiters, undefined);
  assert.equal(card.transfer, undefined);
  assert.equal(card.stats, undefined);
  assert.equal(card.canBump, undefined);
  assert.equal(JSON.stringify(card).includes("user-secret"), false);
  assert.equal(JSON.stringify(card).includes("user-2"), false);
});

test("the detail adds the post body and media, still without owner ids", () => {
  const post = publicClan(clan, ORIGIN, { detail: true });
  assert.equal(post.about, "<p>Dojo is open.</p>");
  assert.deepEqual(post.links, [{ kind: "wiki", url: "https://wiki.example/steel" }]);
  assert.deepEqual(post.media, [
    { kind: "video", id: "dQw4w9wgGcQ" },
    { kind: "image", url: `${ORIGIN}/uploads/dojo.webp` },
  ]);
  assert.equal(post.ownerId, undefined);
});

test("a hidden listing is not in the public feed", () => {
  assert.equal(publicClan({ ...clan, hidden: true }, ORIGIN), null);
  assert.equal(publicAlliance({ id: "a", hidden: true }, ORIGIN), null);
  assert.equal(publicPlayer({ id: "p", hidden: true }, ORIGIN), null);
});

test("an alliance detail names its member clans as cards", () => {
  const alliance = {
    id: "steel-all",
    name: "Steel",
    tag: "STL",
    headline: "Together",
    summary: "An alliance",
    platforms: ["PC"],
    region: "Global",
    language: "English",
    status: "Open",
    recruiting: true,
    clanCount: 1,
    members: 40,
    discord: "https://discord.gg/steel",
    ownerVerified: true,
    online: false,
    presenceStatus: "offline",
    createdAt: clan.createdAt,
    bumpedAt: clan.bumpedAt,
    about: "<p>Allied.</p>",
    memberClans: [{ ...clan, ownerId: "user-secret" }],
    ownerId: "user-all",
  };
  const card = publicAlliance(alliance, ORIGIN);
  assert.equal(card.kind, "alliance");
  assert.equal(card.url, `${ORIGIN}/alliances/steel-all`);
  assert.equal(card.memberClans, undefined);
  const detail = publicAlliance(alliance, ORIGIN, { detail: true });
  assert.equal(detail.memberClans.length, 1);
  assert.equal(detail.memberClans[0].id, "steel");
  assert.equal(detail.memberClans[0].about, undefined);
  assert.equal(JSON.stringify(detail).includes("user-all"), false);
});

test("a player card uses their Discord picture as already resolved", () => {
  const player = {
    id: "gunson",
    name: "Gunson",
    headline: "LF clan",
    summary: "MR 20",
    image: "https://cdn.discordapp.com/avatars/1/a.png",
    platform: "PC",
    mr: 20,
    hours: "Evenings",
    wantsTiers: ["Moon"],
    playstyles: ["Steel Path"],
    region: "Europe",
    language: "English",
    status: "Looking",
    recruiting: true,
    contact: "discord",
    discordName: "gunson",
    whisperName: "--Gunson--",
    ownerVerified: true,
    online: false,
    presenceStatus: "offline",
    createdAt: clan.createdAt,
    bumpedAt: clan.bumpedAt,
    ownerId: "user-secret",
  };
  const card = publicPlayer(player, ORIGIN);
  assert.equal(card.kind, "player");
  assert.equal(card.image, "https://cdn.discordapp.com/avatars/1/a.png");
  assert.equal(card.discordName, "gunson");
  assert.equal(card.ownerId, undefined);
});

test("the feed pages, defaults to recruiting, and drops hidden rows", () => {
  const paused = { ...clan, id: "quiet", name: "Quiet", tag: "QT", recruiting: false };
  const hidden = { ...clan, id: "ghost", name: "Ghost", tag: "GH", hidden: true };
  const page = publicPage(
    "clan",
    [clan, paused, hidden],
    ORIGIN,
    { filters: { q: "", recruiting: true, playstyles: [], mr: "0" }, page: 1, limit: 1 }
  );
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, "steel");
  assert.equal(page.size, 1);
  const all = publicPage(
    "clan",
    [clan, paused, hidden],
    ORIGIN,
    { filters: { q: "", recruiting: false, playstyles: [], mr: "0" }, page: 1, limit: 25 }
  );
  assert.equal(all.total, 2);
});

test("a client has to name itself", () => {
  assert.match(publicAgentError(""), /User-Agent/);
  assert.match(publicAgentError("ab"), /User-Agent/);
  assert.equal(publicAgentError("MyWarframeBot/1.0"), null);
  assert.equal(publicAgentError("curl/8.4.0"), null);
});

test("page size is capped rather than dumping the board", () => {
  assert.equal(pageSizeOf(undefined), PUBLIC_PAGE_SIZE);
  assert.equal(pageSizeOf("0"), PUBLIC_PAGE_SIZE);
  assert.equal(pageSizeOf("3"), 3);
  assert.equal(pageSizeOf(String(PUBLIC_PAGE_MAX + 10)), PUBLIC_PAGE_MAX);
});

test("the catalog names the read-only contract", () => {
  const doc = catalog(ORIGIN);
  assert.equal(doc.version, 1);
  assert.equal(doc.readOnly, true);
  assert.ok(doc.endpoints.some((item) => item.path.endsWith("/clans")));
  assert.match(doc.userAgent, /User-Agent/);
});
