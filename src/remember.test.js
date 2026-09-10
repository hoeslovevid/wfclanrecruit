import test from "node:test";
import assert from "node:assert/strict";
import {
  clearRememberedSearch,
  loadRememberedSearch,
  rememberedIsDefault,
  saveRememberedSearch,
} from "./remember.js";

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("remembered filters round-trip per directory and reset clears one path", () => {
  const storage = memory();
  saveRememberedSearch("/browse", "platform=PC", storage);
  saveRememberedSearch("/players", "?mr=16", storage);
  assert.equal(loadRememberedSearch("/browse", storage), "?platform=PC");
  assert.equal(loadRememberedSearch("/players", storage), "?mr=16");
  clearRememberedSearch("/browse", storage);
  assert.equal(loadRememberedSearch("/browse", storage), "");
  assert.equal(loadRememberedSearch("/players", storage), "?mr=16");
  assert.equal(rememberedIsDefault(""), true);
  assert.equal(rememberedIsDefault("?platform=PC"), false);
});
