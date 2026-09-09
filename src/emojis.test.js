import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_EMOJI_MAX,
  UNICODE_GROUPS,
  addEmojiError,
  normalizeEmojiName,
  publicEmoji,
} from "./emojis.js";

test("emoji names are lowercased and stripped to the shortcode alphabet", () => {
  assert.equal(normalizeEmojiName(" Lotus Prime "), "lotus_prime");
  assert.equal(normalizeEmojiName(":Void:"), "void");
  assert.equal(addEmojiError([], "x"), "Use 2–24 letters, numbers, or underscores. That becomes :name: in chat.");
  assert.equal(addEmojiError([], "lotus"), null);
});

test("a name cannot be reused, and the board has a cap", () => {
  const have = [{ id: "emoji-1", name: "lotus", url: "/uploads/a.webp" }];
  assert.match(addEmojiError(have, "lotus"), /already in use/);
  const full = Array.from({ length: CUSTOM_EMOJI_MAX }, (_, i) => ({
    id: `emoji-${i}`,
    name: `e_${i}`,
    url: "/uploads/a.webp",
  }));
  assert.match(addEmojiError(full, "fresh"), /40 custom emojis/);
});

test("the public object drops who uploaded it", () => {
  assert.deepEqual(
    publicEmoji({
      id: "emoji-1",
      name: "lotus",
      url: "/uploads/a.webp",
      createdBy: "user-admin",
      password: "no",
    }),
    { id: "emoji-1", name: "lotus", url: "/uploads/a.webp" }
  );
});

test("the picker carries more than one group of unicode faces", () => {
  assert.ok(UNICODE_GROUPS.length >= 3);
  assert.ok(UNICODE_GROUPS[0].chars.includes("😀"));
});
