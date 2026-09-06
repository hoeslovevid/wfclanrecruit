// Offer / requirements / how-to-join took formatted text in place of a line
// list. Every listing written before that still holds a string array, so the
// conversion is what keeps those posts rendering; it lives in src/richtext.js
// but is tested here with the rest of the server suite.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_PLAIN_MAX,
  normalizeSection,
  plainTextFromHtml,
  sectionIsEmpty,
  sectionToHtml,
  sectionTooLong,
} from "../src/richtext.js";

test("a legacy string array becomes the bullet list it always rendered as", () => {
  assert.equal(
    sectionToHtml(["Fully researched Moon clan", "Nightly Eidolon squads"]),
    "<ul><li>Fully researched Moon clan</li><li>Nightly Eidolon squads</li></ul>"
  );
});

// The words survive as text - that is the point of escaping - so what matters
// is that no tag does. A legacy entry was plain text and must stay plain text.
test("a legacy array is escaped, not trusted", () => {
  const html = sectionToHtml(["<img src=x onerror=alert(1)>"]);
  assert.equal(
    html,
    "<ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>",
    "the entry renders as visible text, not as an element"
  );
  assert.equal(/<img/i.test(html), false, "no live tag may reach the page");
});

test("blank and empty legacy arrays produce no section", () => {
  assert.equal(sectionToHtml([]), "");
  assert.equal(sectionToHtml(["", "   "]), "");
  assert.equal(sectionToHtml(undefined), "");
  assert.equal(sectionToHtml(null), "");
});

test("formatting a leader writes is kept, and script is not", () => {
  const html = normalizeSection("<ul><li><strong>MR 16+</strong></li></ul><script>alert(1)</script>");
  assert.equal(html, "<ul><li><strong>MR 16+</strong></li></ul>");
});

test("plain text with newlines still becomes a section", () => {
  const html = normalizeSection("MR 16+\nVoice on for hunts");
  assert.equal(plainTextFromHtml(html), "MR 16+\nVoice on for hunts");
});

test("an empty box is a section the listing skips, never an error", () => {
  assert.equal(normalizeSection(""), "");
  assert.equal(normalizeSection(undefined), "");
  assert.equal(sectionIsEmpty(normalizeSection("")), true);
  assert.equal(sectionIsEmpty("<p></p><ul></ul>"), true, "empty markup is not content");
  assert.equal(sectionIsEmpty(normalizeSection(["MR 16+"])), false);
  assert.equal(sectionTooLong(normalizeSection("")), null);
});

test("an over-long section is refused by the box it came from", () => {
  const long = "x".repeat(SECTION_PLAIN_MAX + 50);
  const message = sectionTooLong(normalizeSection(long), '"Requirements"');
  assert.match(message, /^"Requirements" is too long\.$/);
});

test("a section round-trips without growing", () => {
  const once = normalizeSection(["MR 16+", "Voice on"]);
  assert.equal(normalizeSection(once), once, "re-saving an unchanged listing must not alter it");
});
