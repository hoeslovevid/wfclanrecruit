import test from "node:test";
import assert from "node:assert/strict";
import { isSaved, loadSaves, mergeSaves, resolveSaves, toggleSave } from "./saves.js";

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("toggleSave adds then removes a listing", () => {
  const storage = memory();
  assert.equal(isSaved("clan", "steel", storage), false);
  toggleSave("clan", "steel", storage);
  assert.equal(isSaved("clan", "steel", storage), true);
  assert.deepEqual(loadSaves(storage), [{ kind: "clan", id: "steel" }]);
  toggleSave("clan", "steel", storage);
  assert.equal(isSaved("clan", "steel", storage), false);
});

test("resolveSaves drops missing or hidden listings", () => {
  const saves = [
    { kind: "clan", id: "steel" },
    { kind: "player", id: "gone" },
    { kind: "alliance", id: "ghost" },
  ];
  const resolved = resolveSaves(saves, {
    clans: [{ id: "steel", name: "Steel", hidden: false }],
    alliances: [{ id: "ghost", name: "Ghost", hidden: true }],
    players: [],
  });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].href, "/clans/steel");
});

test("mergeSaves keeps local entries first", () => {
  const storage = memory();
  toggleSave("clan", "local", storage);
  const merged = mergeSaves([{ kind: "clan", id: "remote" }, { kind: "clan", id: "local" }], storage);
  assert.deepEqual(merged.map((item) => item.id), ["local", "remote"]);
});
