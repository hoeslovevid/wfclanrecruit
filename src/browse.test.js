import test from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_SIZE,
  applyAllianceFilters,
  applyClanFilters,
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
    playstyles: ["Steel Path", "Hunting"],
  });
  assert.equal(miss.length, 0);
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
