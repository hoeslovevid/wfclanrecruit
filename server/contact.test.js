// The contact rules live in src/data.js so the server and the page cannot
// disagree, but they are enforced here (parseClanBody decides whether an
// invite is required), so the test runs with the rest of the server suite.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContact, wantsDiscord, wantsWhisper } from "../src/data.js";

test("contact defaults to both and refuses anything unknown", () => {
  assert.equal(normalizeContact(undefined), "both");
  assert.equal(normalizeContact(""), "both");
  assert.equal(normalizeContact("email"), "both");
  assert.equal(normalizeContact("whisper"), "whisper");
  assert.equal(normalizeContact("discord"), "discord");
});

test("each mode gates the right route", () => {
  assert.deepEqual([wantsDiscord({}), wantsWhisper({})], [true, true], "missing contact behaves like both");
  assert.deepEqual([wantsDiscord({ contact: "both" }), wantsWhisper({ contact: "both" })], [true, true]);
  assert.deepEqual([wantsDiscord({ contact: "discord" }), wantsWhisper({ contact: "discord" })], [true, false]);
  assert.deepEqual([wantsDiscord({ contact: "whisper" }), wantsWhisper({ contact: "whisper" })], [false, true]);
});
