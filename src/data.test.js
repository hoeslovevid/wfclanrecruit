import test from "node:test";
import assert from "node:assert/strict";
import { cardPlaystyles, playstylesByGroup } from "./data.js";

test("a clan with fewer tags than the row holds shows them all", () => {
  const { shown, rest } = cardPlaystyles(["Casual", "Social"]);
  assert.deepEqual(shown, ["Casual", "Social"]);
  assert.equal(rest, 0);
});

test("an untagged clan reserves an empty row", () => {
  assert.deepEqual(cardPlaystyles([]), { shown: [], rest: 0 });
  assert.deepEqual(cardPlaystyles(undefined), { shown: [], rest: 0 });
});

test("the row takes one tag per group before a second from any group", () => {
  const { shown, rest } = cardPlaystyles([
    "Casual",
    "Early Star Chart",
    "Late Star Chart",
    "Social",
    "Trading",
  ]);
  assert.deepEqual(shown, ["Casual", "Social", "Trading"]);
  assert.equal(rest, 2);
});

test("a clan tagged inside one group still fills its row", () => {
  const { shown, rest } = cardPlaystyles(["Trading", "Duviri", "Sorties", "Conclave"]);
  assert.equal(shown.length, 3);
  assert.equal(rest, 1);
});

test("the shown tags come back in group order, not sweep order", () => {
  const { shown } = cardPlaystyles(["Trading", "Voice Optional", "Casual"]);
  assert.deepEqual(shown, ["Casual", "Voice Optional", "Trading"]);
});

test("retired tags fall away before the row is counted", () => {
  const { shown, rest } = cardPlaystyles(["Nightwave", "Railjack", "Casual"]);
  assert.deepEqual(shown, ["Casual"]);
  assert.equal(rest, 0);
});

test("a renamed tag counts as the tag it became", () => {
  const { shown } = cardPlaystyles(["Eidolon"]);
  assert.deepEqual(shown, ["Eidolon Hunts"]);
});

test("the row can be widened past three", () => {
  const { shown, rest } = cardPlaystyles(["Casual", "Social", "Trading", "Duviri"], 4);
  assert.equal(shown.length, 4);
  assert.equal(rest, 0);
});

test("the post page groups tags and drops the groups nobody picked", () => {
  const groups = playstylesByGroup(["Trading", "Casual", "Duviri", "Late Star Chart"]);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["progression", "activities"]
  );
  assert.deepEqual(groups[0].tags, ["Casual", "Late Star Chart"]);
  assert.deepEqual(groups[1].tags, ["Duviri", "Trading"]);
});

test("an untagged clan gets no tag rows at all", () => {
  assert.deepEqual(playstylesByGroup([]), []);
});
