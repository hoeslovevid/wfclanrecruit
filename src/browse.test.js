import test from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_SIZE,
  applyAllianceFilters,
  applyClanFilters,
  applyPlayerFilters,
  defaultFilters,
  filtersFromSearch,
  filtersToSearch,
  paginate,
  parsePlaystyles,
} from "./browse.js";

const open = {
  id: "steel",
  name: "Steel Meridian",
  tag: "SM",
  headline: "Endgame",
  summary: "Steel Path nights",
  playstyles: ["Steel Path", "Endgame", "New Player Friendly"],
  platform: "PC",
  tier: "Moon",
  region: "North America",
  language: "English",
  status: "Open",
  recruiting: true,
  members: 40,
  mrRequired: 10,
  bumpedAt: "2026-09-04T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const paused = {
  ...open,
  id: "paused",
  name: "Quiet Hours",
  tag: "QH",
  recruiting: false,
  paused: true,
  status: "Selective",
  playstyles: ["Casual", "Social"],
  mrRequired: 0,
};

const hidden = { ...open, id: "ghost", name: "Hidden Clan", tag: "HDN", hidden: true };

test("parsePlaystyles keeps known unique names", () => {
  assert.deepEqual(parsePlaystyles(["Steel Path", "Casual", "Steel Path", "nope"]), ["Steel Path", "Casual"]);
});

test("recruiting-only is the default and hidden listings never appear", () => {
  const filters = defaultFilters();
  const list = applyClanFilters([open, paused, hidden], filters);
  assert.deepEqual(
    list.map((item) => item.id),
    ["steel"]
  );
});

test("recruiting=0 still excludes hidden listings", () => {
  const list = applyClanFilters([open, paused, hidden], { ...defaultFilters(), recruiting: false });
  assert.deepEqual(
    list.map((item) => item.id),
    ["steel", "paused"]
  );
});

test("several playstyles require every selected chip", () => {
  const both = applyClanFilters([open, paused], {
    ...defaultFilters(),
    playstyles: ["Steel Path", "New Player Friendly"],
  });
  assert.deepEqual(
    both.map((item) => item.id),
    ["steel"]
  );
  const miss = applyClanFilters([open], {
    ...defaultFilters(),
    playstyles: ["Steel Path", "Conclave"],
  });
  assert.equal(miss.length, 0);
});

test("online-first sort puts an online clan above a newer offline one", () => {
  const fresh = { ...open, id: "fresh", online: false, bumpedAt: "2026-09-08T00:00:00.000Z" };
  const live = { ...open, id: "live", online: true, bumpedAt: "2026-09-01T00:00:00.000Z" };
  const list = applyClanFilters([fresh, live], { ...defaultFilters(), sort: "online" });
  assert.deepEqual(
    list.map((item) => item.id),
    ["live", "fresh"]
  );
});

test("filtersFromSearch treats a missing recruiting param as on", () => {
  assert.equal(filtersFromSearch("q=steel").filters.recruiting, true);
  assert.equal(filtersFromSearch("recruiting=0").filters.recruiting, false);
  assert.deepEqual(filtersFromSearch("playstyle=Steel%20Path&playstyle=Casual").filters.playstyles, [
    "Steel Path",
    "Casual",
  ]);
});

test("filtersToSearch omits the recruiting flag while it is the default", () => {
  assert.equal(filtersToSearch(defaultFilters(), 1), "");
  assert.equal(filtersToSearch({ ...defaultFilters(), recruiting: false }, 2), "?recruiting=0&page=2");
});

test("paginate windows a list and clamps the page", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: i }));
  const first = paginate(items, 1);
  assert.equal(first.items.length, PAGE_SIZE);
  assert.equal(first.pages, 3);
  assert.equal(first.total, 25);
  assert.equal(paginate(items, 99).page, 3);
  assert.equal(paginate([], 4).page, 1);
});

test("alliance browse also defaults to recruiting and drops hidden rows", () => {
  const live = { id: "a1", name: "Live", tag: "LV", headline: "", summary: "", platforms: ["PC"], recruiting: true };
  const quiet = { ...live, id: "a2", name: "Quiet", recruiting: false };
  const gone = { ...live, id: "a3", name: "Gone", hidden: true };
  assert.deepEqual(
    applyAllianceFilters([live, quiet, gone], defaultFilters()).map((item) => item.id),
    ["a1"]
  );
});

// --- Player filters --------------------------------------------------------

const veteran = {
  id: "vet",
  name: "Gunson",
  headline: "MR30 looking for Steel Path nights",
  summary: "Been playing since 2015",
  playstyles: ["Late Steel Path", "Endgame", "Voice Optional"],
  platform: "PC",
  region: "Europe",
  language: "English",
  status: "Looking now",
  hours: "20+ hrs/week",
  mr: 30,
  recruiting: true,
  bumpedAt: "2026-09-04T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const newbie = {
  ...veteran,
  id: "new",
  name: "Tenno1",
  headline: "Just started, want a friendly clan",
  summary: "New to the game",
  playstyles: ["Casual", "New Player Friendly"],
  platform: "PlayStation",
  region: "North America",
  status: "Casually looking",
  hours: "Under 5 hrs/week",
  mr: 4,
  bumpedAt: "2026-09-05T00:00:00.000Z",
};

const PLAYERS = [veteran, newbie];

// The whole reason this test exists: `mr` is a ceiling on the clan board and a
// floor on the player board, off the same query parameter. Getting this
// backwards would silently show recruiters exactly the players they ruled out.
test("the player MR filter is a floor, not a ceiling", () => {
  const filters = { ...defaultFilters(), mr: "10" };
  const ids = applyPlayerFilters(PLAYERS, filters).map((item) => item.id);
  assert.deepEqual(ids, ["vet"]);
});

test("the clan MR filter still excludes clans that ask for more than you have", () => {
  const cheap = { ...open, id: "cheap", mrRequired: 2 };
  const ids = applyClanFilters([open, cheap], { ...defaultFilters(), mr: "5" }).map((item) => item.id);
  assert.deepEqual(ids, ["cheap"]);
});

test("MR 0 is no floor at all", () => {
  assert.equal(applyPlayerFilters(PLAYERS, defaultFilters()).length, 2);
});

test("player filters narrow on platform, region, status and hours", () => {
  const only = (patch) => applyPlayerFilters(PLAYERS, { ...defaultFilters(), ...patch }).map((item) => item.id);
  assert.deepEqual(only({ platform: "PlayStation" }), ["new"]);
  assert.deepEqual(only({ region: "Europe" }), ["vet"]);
  assert.deepEqual(only({ status: "Looking now" }), ["vet"]);
  assert.deepEqual(only({ hours: "20+ hrs/week" }), ["vet"]);
});

test("every selected playstyle has to be present", () => {
  const both = { ...defaultFilters(), playstyles: ["Endgame", "Late Steel Path"] };
  assert.deepEqual(applyPlayerFilters(PLAYERS, both).map((item) => item.id), ["vet"]);
  const impossible = { ...defaultFilters(), playstyles: ["Endgame", "Casual"] };
  assert.deepEqual(applyPlayerFilters(PLAYERS, impossible), []);
});

test("keyword search reads the headline and summary", () => {
  assert.deepEqual(
    applyPlayerFilters(PLAYERS, { ...defaultFilters(), q: "steel path" }).map((item) => item.id),
    ["vet"]
  );
});

test("a hidden profile never appears, filters or not", () => {
  const hidden = [{ ...veteran, hidden: true }];
  assert.deepEqual(applyPlayerFilters(hidden, { ...defaultFilters(), recruiting: false }), []);
});

test("sorting by MR puts the most experienced player first", () => {
  const ids = applyPlayerFilters(PLAYERS, { ...defaultFilters(), sort: "mr" }).map((item) => item.id);
  assert.deepEqual(ids, ["vet", "new"]);
});

test("the default sort is newest, and players who stopped looking sink", () => {
  const stopped = { ...veteran, id: "stopped", recruiting: false };
  const ids = applyPlayerFilters([stopped, newbie], { ...defaultFilters(), recruiting: false }).map(
    (item) => item.id
  );
  assert.deepEqual(ids, ["new", "stopped"]);
});

test("the hours filter round-trips through the URL", () => {
  const filters = { ...defaultFilters(), hours: "10-20 hrs/week", mr: "12" };
  const { filters: back } = filtersFromSearch(filtersToSearch(filters));
  assert.equal(back.hours, "10-20 hrs/week");
  assert.equal(back.mr, "12");
});
