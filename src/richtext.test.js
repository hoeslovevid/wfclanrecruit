import test from "node:test";
import assert from "node:assert/strict";
import { plainTextFromHtml, sanitizePostHtml } from "./richtext.js";

test("custom emoji imgs keep data-emoji and drop src", () => {
  const out = sanitizePostHtml(
    `<img src="https://evil.example/x.png" data-emoji="emoji-1" onerror="alert(1)">`
  );
  assert.match(out, /data-emoji="emoji-1"/);
  assert.doesNotMatch(out, /src=/);
  assert.doesNotMatch(out, /onerror/);
  assert.doesNotMatch(out, /evil\.example/);
});

test("plain text counts a custom emoji as two characters", () => {
  assert.equal(plainTextFromHtml(`hi <img data-emoji="emoji-1">`), "hi xx");
});

test("unicode emoji count toward the readable cap as themselves", () => {
  assert.equal(plainTextFromHtml("hello 😀"), "hello 😀");
});
