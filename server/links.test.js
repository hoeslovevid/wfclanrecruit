// The links row is the fallback contact route now that the Discord invite is
// optional, so what survives normalizeLinks decides whether a listing can be
// published at all. It lives in src/data.js beside the contact rules, but is
// tested here with the rest of the server suite.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LINK_MAX,
  PLAYSTYLES,
  PLAYSTYLE_GROUPS,
  groupOf,
  normalizeLinkKind,
  normalizeLinks,
  normalizePlaystyles,
} from "../src/data.js";
import { isSafeHref } from "../src/richtext.js";

const links = (rows) => normalizeLinks(rows, isSafeHref);

test("an unknown or missing kind falls back to Other", () => {
  assert.equal(normalizeLinkKind("YouTube"), "YouTube");
  assert.equal(normalizeLinkKind("youtube"), "YouTube", "the select value is matched case-insensitively");
  assert.equal(normalizeLinkKind("Myspace"), "Other");
  assert.equal(normalizeLinkKind(""), "Other");
  assert.equal(normalizeLinkKind(undefined), "Other");
});

test("only http and https URLs survive", () => {
  assert.deepEqual(links([{ kind: "Website", url: "https://example.com/clan" }]), [
    { kind: "Website", url: "https://example.com/clan" },
  ]);
  assert.deepEqual(links([{ kind: "Website", url: "javascript:alert(1)" }]), []);
  assert.deepEqual(links([{ kind: "Website", url: "data:text/html,<script>" }]), []);
  assert.deepEqual(links([{ kind: "Website", url: "ftp://example.com" }]), []);
  assert.deepEqual(links([{ kind: "Website", url: "" }]), []);
});

test("the same URL cannot be listed twice", () => {
  const rows = links([
    { kind: "Website", url: "https://example.com/" },
    { kind: "Other", url: "https://example.com/" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "Website", "the first row wins");
});

test("the list is capped", () => {
  const rows = links(
    Array.from({ length: LINK_MAX + 3 }, (_, index) => ({ kind: "Other", url: `https://example.com/${index}` }))
  );
  assert.equal(rows.length, LINK_MAX);
});

test("a missing or malformed list is an empty list, not a throw", () => {
  assert.deepEqual(links(undefined), []);
  assert.deepEqual(links("nope"), []);
  assert.deepEqual(links([null, undefined, {}]), []);
});

test("every playstyle belongs to exactly one group", () => {
  const seen = new Set();
  for (const group of PLAYSTYLE_GROUPS) {
    for (const tag of group.tags) {
      assert.equal(seen.has(tag), false, `${tag} is listed in more than one group`);
      seen.add(tag);
      assert.equal(groupOf(tag), group.id);
    }
  }
  assert.deepEqual([...seen].sort(), [...PLAYSTYLES].sort(), "PLAYSTYLES must be the union of the groups");
});

test("a tag from an older listing still renders", () => {
  assert.equal(groupOf("Some Retired Tag"), "activities");
  assert.equal(groupOf(undefined), "activities");
});

// The vocabulary was rewritten; a listing tagged against the old one keeps its
// meaning rather than quietly losing it.
test("renamed tags survive, retired ones do not", () => {
  assert.equal(groupOf("Archon"), "activities", "old names still group correctly");
  assert.deepEqual(normalizePlaystyles(["Archon", "Cross-save", "EDA"]), [
    "Cross-Save",
    "Archon Hunts",
    "Elite Deep Archimedea (EDA)",
  ]);
  assert.deepEqual(normalizePlaystyles(["Nightwave", "Railjack", "Hardcore", "Hunting"]), []);
});

test("normalizePlaystyles dedupes, drops unknowns, and orders by group", () => {
  const out = normalizePlaystyles(["Trading", "Casual", "Trading", "Not A Tag", "Social"]);
  assert.deepEqual(out, ["Casual", "Social", "Trading"], "group order, not input order");
  assert.deepEqual(normalizePlaystyles(undefined), []);
});
