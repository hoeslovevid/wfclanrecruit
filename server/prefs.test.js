import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDrafts, sanitizeSaves, userPrefs } from "./prefs.js";

test("userPrefs caps saves and drops junk", () => {
  const saves = [
    { kind: "clan", id: "steel" },
    { kind: "nope", id: "x" },
    { kind: "clan", id: "steel" },
    { kind: "player", id: "gunson" },
  ];
  assert.deepEqual(sanitizeSaves(saves), [
    { kind: "clan", id: "steel" },
    { kind: "player", id: "gunson" },
  ]);
});

test("userPrefs keeps the newest drafts under the byte cap", () => {
  const drafts = sanitizeDrafts({
    "clan:new": { fields: { name: "A" }, savedAt: "2026-09-01T00:00:00.000Z" },
    "clan:old": { fields: { name: "B" }, savedAt: "2026-08-01T00:00:00.000Z" },
  });
  assert.equal(drafts["clan:new"].fields.name, "A");
  assert.deepEqual(userPrefs({ saves: [{ kind: "clan", id: "steel" }], drafts }).saves, [
    { kind: "clan", id: "steel" },
  ]);
});
