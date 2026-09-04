import test from "node:test";
import assert from "node:assert/strict";
import { profileHasToken, verifiableRegion } from "./verify.js";

// Shape of the reader's markdown for a real profile: the sidebar (Recent
// Profile Visitors, with other members' display names) linearizes ABOVE the
// About Me tab panel, so a region that stops at the visitors block never
// reaches the token. Verified against forums.warframe.com profiles.
const PAGE = `# Tiltskillet

*   #### Posts

 1,234
*   #### Joined

March 3, 2014

## Reputation

5,678

## Recent Profile Visitors

 9,001 profile views
*   [![Image 5: WFR-deadbeef99](https://media.invisioncic.com/glyph.png)](https://forums.warframe.com/profile/4211287-illusionboi/ "Go to IllusionBoi's profile") ### [IllusionBoi](https://forums.warframe.com/profile/4211287-illusionboi/ "Go to IllusionBoi's profile")

July 6

## About Me

**Into the garbage chute, flyboy!** WFR-1a2b3c4d5e

*   [All Activity](https://forums.warframe.com/discover/)
*   [Home](https://forums.warframe.com/ "Home")
`;

test("token pasted in About Me is found", () => {
  assert.equal(profileHasToken(PAGE, "WFR-1a2b3c4d5e"), true);
});

test("token is matched case-insensitively", () => {
  assert.equal(profileHasToken(PAGE, "wfr-1A2B3C4D5E"), true);
});

test("a visitor's display name cannot supply the token", () => {
  assert.equal(profileHasToken(PAGE, "WFR-deadbeef99"), false);
});

test("region stops at the next section after About Me", () => {
  const region = verifiableRegion(PAGE);
  assert.match(region, /garbage chute/);
  assert.doesNotMatch(region, /profile views/);
});

test("a profile with no About Me section verifies nothing", () => {
  const bare = PAGE.slice(0, PAGE.indexOf("## About Me"));
  assert.equal(profileHasToken(bare, "WFR-1a2b3c4d5e"), false);
  assert.equal(profileHasToken(bare, "WFR-deadbeef99"), false);
});

test("short or empty tokens never match", () => {
  assert.equal(profileHasToken(PAGE, ""), false);
  assert.equal(profileHasToken(PAGE, "WFR-1a2"), false);
});

test("owner falls back to the page title when the body has no heading", async () => {
  const { ownerFromTitle } = await import("./verify.js");
  assert.equal(ownerFromTitle("--Gunson-- - Warframe Forums"), "--Gunson--");
  assert.equal(ownerFromTitle("localadmin - Warframe Forums"), "localadmin");
  assert.equal(ownerFromTitle(""), "");
});

test("the in-game name keeps the forum spelling verbatim", async () => {
  const { ingameName } = await import("./verify.js");
  assert.equal(ingameName("--Gunson--"), "--Gunson--");
  assert.equal(ingameName("[DE]Danielle"), "[DE]Danielle");
  assert.equal(ingameName("  TOJI_1  "), "TOJI_1");
});

test("two players may share an in-game name", async () => {
  const { ingameName } = await import("./verify.js");
  // No db, no uniqueness check: identity is discordId, not this string.
  assert.equal(ingameName("--Gunson--"), ingameName("--Gunson--"));
});

test("a blank owner yields no in-game name", async () => {
  const { ingameName } = await import("./verify.js");
  assert.equal(ingameName(""), null);
  assert.equal(ingameName("   "), null);
});

test("an overlong in-game name is capped", async () => {
  const { ingameName, INGAME_NAME_MAX } = await import("./verify.js");
  assert.equal(ingameName("x".repeat(80)).length, INGAME_NAME_MAX);
});
