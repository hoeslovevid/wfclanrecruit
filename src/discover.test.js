import test from "node:test";
import assert from "node:assert/strict";
import { FILTER_PRESETS, introNote, matchReasons, presetHref, presetIsActive, similarAlliances, similarClans, similarPlayers } from "./discover.js";

test("a preset writes the existing query params", () => {
  const pc = FILTER_PRESETS.find((item) => item.id === "pc-na");
  assert.match(presetHref(pc), /platform=PC/);
  assert.match(presetHref(pc), /region=North\+America/);
  assert.equal(presetIsActive(pc, { platform: "PC", region: "North America", playstyles: [] }), true);
  assert.equal(presetIsActive(pc, { platform: "PC", region: "Europe", playstyles: [] }), false);
});

test("an EU preset exists for the clan directory", () => {
  assert.ok(FILTER_PRESETS.some((item) => item.id === "pc-eu"));
});

test("matchReasons names the filters that actually hit", () => {
  const clan = {
    platform: "PC",
    region: "Europe",
    playstyles: ["Late Steel Path"],
    mrRequired: 10,
    online: true,
  };
  assert.deepEqual(
    matchReasons(clan, { platform: "PC", region: "Europe", playstyles: ["Late Steel Path"], online: true, mr: "16" }, "clan"),
    ["PC", "Europe", "Online now", "MR 10", "Late Steel Path"]
  );
});

test("similar alliances prefer overlapping platforms", () => {
  const seed = { id: "a", platforms: ["PC"], region: "Europe", recruiting: true };
  const match = { id: "b", platforms: ["PC", "PlayStation"], region: "Europe", recruiting: true, bumpedAt: "2026-09-08T00:00:00.000Z" };
  const miss = { id: "c", platforms: ["Xbox"], region: "Europe", recruiting: true, bumpedAt: "2026-09-08T00:00:00.000Z" };
  assert.deepEqual(
    similarAlliances(seed, [seed, match, miss]).map((item) => item.id),
    ["b"]
  );
});

test("similar players stay on the same platform", () => {
  const seed = { id: "p1", platform: "PC", playstyles: ["Social"], mr: 16, recruiting: true };
  const match = { id: "p2", platform: "PC", playstyles: ["Social"], mr: 18, recruiting: true, bumpedAt: "2026-09-08T00:00:00.000Z" };
  const xbox = { ...match, id: "p3", platform: "Xbox" };
  assert.deepEqual(
    similarPlayers(seed, [seed, match, xbox]).map((item) => item.id),
    ["p2"]
  );
});

test("introNote names the listing", () => {
  assert.match(introNote({ name: "Steel Meridian" }), /Steel Meridian/);
});

test("similar clans prefer the same platform, overlapping playstyles, and close MR", () => {
  const clan = {
    id: "steel",
    platform: "PC",
    playstyles: ["Late Steel Path", "Endgame"],
    mrRequired: 16,
    recruiting: true,
  };
  const match = {
    id: "match",
    platform: "PC",
    playstyles: ["Late Steel Path", "Social"],
    mrRequired: 18,
    recruiting: true,
    bumpedAt: "2026-09-08T00:00:00.000Z",
  };
  const xbox = { ...match, id: "xbox", platform: "Xbox" };
  const far = { ...match, id: "far", playstyles: ["Casual"], mrRequired: 0 };
  const found = similarClans(clan, [clan, match, xbox, far]);
  assert.deepEqual(
    found.map((item) => item.id),
    ["match"]
  );
});
