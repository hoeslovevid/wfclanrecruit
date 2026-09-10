import test from "node:test";
import assert from "node:assert/strict";
import { plainTextFromHtml, sanitizePostHtml } from "./richtext.js";

test("listing HTML keeps formatting and drops scripts", () => {
  const out = sanitizePostHtml(`<strong>hello</strong><script>alert(1)</script>`);
  assert.match(out, /<strong>hello<\/strong>/);
  assert.doesNotMatch(out, /<script/);
});

test("images are not kept in listing HTML", () => {
  assert.doesNotMatch(
    sanitizePostHtml(`<img src="https://evil.example/x.png" data-emoji="emoji-1">`),
    /<img/
  );
});

test("unicode emoji count toward the readable cap as themselves", () => {
  assert.equal(plainTextFromHtml("hello 😀"), "hello 😀");
});
