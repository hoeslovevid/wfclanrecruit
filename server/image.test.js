import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EMOJI_MAX_EDGE, IMAGE_MAX_EDGE, resizeEmojiImage, resizeListingImage } from "./image.js";

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

const skip = sharp ? false : "sharp could not load";

test("resizeListingImage shrinks a wide photo to webp", { skip }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wfr-img-"));
  const src = path.join(dir, "clan.png");
  await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 20, g: 24, b: 40 } },
  })
    .png()
    .toFile(src);

  const name = await resizeListingImage(src);
  assert.equal(name, "clan.webp");
  const dest = path.join(dir, name);
  const info = await sharp(dest).metadata();
  assert.equal(info.format, "webp");
  assert.ok(info.width <= IMAGE_MAX_EDGE);
  assert.ok(info.height <= IMAGE_MAX_EDGE);
  await fs.access(src).then(
    () => assert.fail("original png should be removed"),
    () => {}
  );
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

test("resizeListingImage refuses a truncated file", { skip }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wfr-img-"));
  const src = path.join(dir, "bad.png");
  await fs.writeFile(src, "not-an-image");
  await assert.rejects(() => resizeListingImage(src));
  await fs.rm(dir, { recursive: true, force: true });
});

test("resizeEmojiImage shrinks to a small webp square", { skip }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wfr-emoji-"));
  const src = path.join(dir, "lotus.png");
  await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 80, g: 40, b: 120 } },
  })
    .png()
    .toFile(src);

  const name = await resizeEmojiImage(src);
  assert.equal(name, "lotus.webp");
  const info = await sharp(path.join(dir, name)).metadata();
  assert.equal(info.format, "webp");
  assert.ok(info.width <= EMOJI_MAX_EDGE);
  assert.ok(info.height <= EMOJI_MAX_EDGE);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});
