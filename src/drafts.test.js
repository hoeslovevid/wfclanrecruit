import test from "node:test";
import assert from "node:assert/strict";
import { clearDraft, draftIsBlank, draftKey, loadDraft, mergeDrafts, saveDraft } from "./drafts.js";

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("a new clan draft keys separately from an edit", () => {
  assert.equal(draftKey("clan"), "clan:new");
  assert.equal(draftKey("clan", "steel"), "clan:steel");
});

test("blank drafts are not stored", () => {
  const storage = memory();
  assert.equal(draftIsBlank({ name: "   ", about: "<p></p>" }), true);
  saveDraft("clan:new", { name: "  " }, storage);
  assert.equal(loadDraft("clan:new", storage), null);
});

test("a named draft round-trips and can be cleared", () => {
  const storage = memory();
  saveDraft("clan:new", { name: "Steel Meridian", about: "Nights" }, storage);
  assert.equal(loadDraft("clan:new", storage).name, "Steel Meridian");
  clearDraft("clan:new", storage);
  assert.equal(loadDraft("clan:new", storage), null);
});

test("roles count as draft content", () => {
  assert.equal(draftIsBlank({ roles: JSON.stringify([{ name: "Architect" }]) }), false);
});

test("mergeDrafts keeps the newer savedAt", () => {
  const storage = memory();
  saveDraft("clan:new", { name: "Local" }, storage);
  mergeDrafts(
    { "clan:new": { fields: { name: "Remote" }, savedAt: "2099-01-01T00:00:00.000Z" } },
    storage
  );
  assert.equal(loadDraft("clan:new", storage).name, "Remote");
});
