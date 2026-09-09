// A player profile reuses the listing machinery wholesale, so what is worth
// testing is the handful of places it is *not* a clan: no tag, its own URL
// space, and its own social copy.
import test from "node:test";
import assert from "node:assert/strict";
import { isRecruiting, whisperName, withListingState } from "./listing.js";
import { listingFromPath, listingSocial, robotsTxt, sitemapXml } from "./meta.js";
import {
  DISCORD_NAME_MAX,
  HOURS,
  PLAYER_STATUSES,
  discordAddFriendHint,
  isDiscordName,
  normalizeContact,
  normalizeDiscordName,
  wantsWhisper,
} from "../src/data.js";
import { discordAvatarUrl } from "./verify.js";

const PLAYER = {
  id: "gunson-abc",
  ownerId: "user-1",
  name: "Gunson",
  headline: "MR30 looking for Steel Path nights",
  summary: "Been playing since 2015",
  mr: 30,
  hours: HOURS[3],
  status: PLAYER_STATUSES[0],
  paused: false,
  inviteOk: true,
  createdAt: new Date().toISOString(),
};

test("the player vocabulary is a closed list", () => {
  assert.equal(HOURS.length, 4);
  assert.ok(PLAYER_STATUSES.includes("Looking now"));
});

test("a live profile is recruiting, and pausing it stops that", () => {
  assert.equal(isRecruiting(PLAYER), true);
  assert.equal(isRecruiting({ ...PLAYER, paused: true }), false);
  assert.equal(isRecruiting({ ...PLAYER, hidden: true }), false);
});

test("a profile goes stale on the same clock a listing does", () => {
  const old = { ...PLAYER, createdAt: "2020-01-01T00:00:00.000Z" };
  assert.equal(withListingState(old).stale, true);
  assert.equal(withListingState(PLAYER).stale, false);
});

test("the whisper name comes off the verified owner, never the profile", () => {
  const users = [{ id: "user-1", forumVerified: true, forumName: "--Gunson--" }];
  assert.equal(whisperName(PLAYER, users), "--Gunson--");
  assert.equal(whisperName(PLAYER, [{ id: "user-1", forumVerified: false, forumName: "Fake" }]), null);
});

test("a whisper-only profile is the case that needs a verified name", () => {
  assert.equal(wantsWhisper({ contact: normalizeContact("whisper") }), true);
  assert.equal(wantsWhisper({ contact: normalizeContact("discord") }), false);
});

test("/players/:id routes to a player, not a clan", () => {
  assert.deepEqual(listingFromPath("/players/gunson-abc"), { kind: "player", id: "gunson-abc" });
  assert.deepEqual(listingFromPath("/clans/steel"), { kind: "clan", id: "steel" });
  assert.equal(listingFromPath("/players"), null);
});

test("social meta drops the bracketed tag a player does not have", () => {
  const tags = listingSocial("https://example.com", PLAYER, "player");
  assert.ok(tags.includes("<title>Gunson — WF Clan Recruit</title>"), tags);
  assert.ok(!tags.includes("[]"), "an empty tag must not render as empty brackets");
  assert.ok(tags.includes("https://example.com/players/gunson-abc"));
});

test("a profile with no headline falls back to player wording", () => {
  const tags = listingSocial("https://example.com", { id: "x", name: "Gunson" }, "player");
  assert.ok(tags.includes("looking for a clan"), tags);
});

test("the sitemap carries the player directory and its profiles", () => {
  const xml = sitemapXml("https://example.com", {
    players: [PLAYER, { id: "hidden-one", hidden: true }],
  });
  assert.ok(xml.includes("https://example.com/players</loc>"));
  assert.ok(xml.includes("https://example.com/players/gunson-abc"));
  assert.ok(!xml.includes("hidden-one"), "a hidden profile stays out of the sitemap");
});

test("robots keeps the profile composer out of the index", () => {
  assert.ok(robotsTxt("https://example.com").includes("Disallow: /lfc"));
});

test("robots keeps the staff page out of the index", () => {
  assert.ok(robotsTxt("https://example.com").includes("Disallow: /admin"));
});

// --- Discord username, not an invite ---------------------------------------

test("a Discord username is accepted in both the new and legacy shapes", () => {
  assert.equal(isDiscordName("gunson"), true);
  assert.equal(isDiscordName("gun.son_1"), true, "dots and underscores are legal");
  assert.equal(isDiscordName("gunson#1234"), true, "legacy discriminators still exist");
  assert.equal(isDiscordName("A".repeat(32)), true);
});

test("anything that is not a username is refused", () => {
  assert.equal(isDiscordName(""), false);
  assert.equal(isDiscordName("g"), false, "one character is below Discord's minimum");
  assert.equal(isDiscordName("A".repeat(33)), false);
  assert.equal(isDiscordName("has space"), false);
  assert.equal(isDiscordName("gun$on"), false);
  // The old field took one of these. The new one must not.
  assert.equal(isDiscordName("https://discord.gg/yourserver"), false);
});

test("a copied mention loses its @ rather than being rejected", () => {
  assert.equal(normalizeDiscordName("@gunson"), "gunson");
  assert.equal(normalizeDiscordName("  gunson  "), "gunson");
  assert.equal(isDiscordName("@gunson"), true);
});

test("the field is long enough for a legacy name and no longer", () => {
  assert.equal(DISCORD_NAME_MAX, 37);
  assert.equal("A".repeat(32).length + "#0000".length, DISCORD_NAME_MAX);
});

test("the hint tells a recruiter what to do with the name", () => {
  assert.equal(discordAddFriendHint("@gunson"), "Add gunson on Discord");
});

// --- Avatar from Discord ---------------------------------------------------

test("the avatar URL is built from the Discord id and hash", () => {
  const url = discordAvatarUrl({ discordId: "123", discordAvatar: "abc" });
  assert.equal(url, "https://cdn.discordapp.com/avatars/123/abc.png?size=128");
  assert.ok(discordAvatarUrl({ discordId: "123", discordAvatar: "abc" }, 64).endsWith("size=64"));
});

test("an account with no picture, or no Discord at all, has no avatar URL", () => {
  assert.equal(discordAvatarUrl({ discordId: "123", discordAvatar: null }), null);
  assert.equal(discordAvatarUrl({ discordId: null, discordAvatar: "abc" }), null);
  assert.equal(discordAvatarUrl(null), null);
});

test("an animated avatar is requested as a still frame", () => {
  const url = discordAvatarUrl({ discordId: "123", discordAvatar: "a_animated" });
  assert.ok(url.endsWith(".png?size=128"), url);
});
