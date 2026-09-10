import test from "node:test";
import assert from "node:assert/strict";
import { loadViewed, recordView, VIEWED_MAX } from "./history.js";

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("recordView keeps the newest ten and skips preview", () => {
  const storage = memory();
  recordView("clan", "preview", storage);
  assert.deepEqual(loadViewed(storage), []);
  for (let i = 0; i < 12; i += 1) recordView("clan", `c${i}`, storage);
  const viewed = loadViewed(storage);
  assert.equal(viewed.length, VIEWED_MAX);
  assert.equal(viewed[0].id, "c11");
  assert.equal(viewed.at(-1).id, "c2");
});
