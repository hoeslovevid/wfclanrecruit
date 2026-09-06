// The media strip carries images as well as videos. Pasted image links are
// somebody else's file on somebody else's host, so the allowlist here is what
// keeps a gallery from rotting or pointing somewhere it should not.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_MAX,
  VIDEO_MAX,
  isUploadedImage,
  mediaList,
  normalizeMedia,
  parseImageUrl,
  uploadedUrls,
  videoIdsOf,
} from "../src/media.js";

const ID = "dQw4w9WgXcQ";
const ID2 = "abcdefghijk";
const IMG = "https://i.imgur.com/abc123.png";

test("an allowlisted image link is kept", () => {
  assert.equal(parseImageUrl(IMG).url, IMG);
  assert.equal(parseImageUrl("i.redd.it/foo.jpg").url, "https://i.redd.it/foo.jpg");
});

// A clan leader's first instinct is to paste a Discord link, and those expire.
test("Discord links are refused by name, not silently dropped", () => {
  const result = parseImageUrl("https://cdn.discordapp.com/attachments/1/2/clan.png?ex=abc");
  assert.match(result.error, /Discord/);
  assert.match(result.error, /expire/);
  assert.equal(result.url, undefined);
});

test("an unlisted host is refused and named", () => {
  const result = parseImageUrl("https://example.com/clan.png");
  assert.match(result.error, /example\.com/);
});

test("a link that is not an image is refused", () => {
  assert.match(parseImageUrl("https://i.imgur.com/gallery/abc").error, /image file/);
});

test("hostile schemes never survive", () => {
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "vbscript:msgbox"]) {
    assert.equal(parseImageUrl(bad).url, undefined, bad);
  }
});

test("our own uploads are trusted without the allowlist", () => {
  assert.equal(parseImageUrl("/uploads/1712-abc.webp").url, "/uploads/1712-abc.webp");
  assert.equal(isUploadedImage("/uploads/x.webp"), true);
  assert.equal(isUploadedImage(IMG), false);
});

test("normalizeMedia keeps the leader's order and drops duplicates", () => {
  const media = normalizeMedia([
    { kind: "video", id: `https://youtu.be/${ID}` },
    { kind: "image", url: IMG },
    { kind: "video", id: ID },
    { kind: "image", url: IMG },
  ]);
  assert.deepEqual(media, [
    { kind: "video", id: ID },
    { kind: "image", url: IMG },
  ]);
});

test("bad entries fall out without taking the good ones with them", () => {
  const media = normalizeMedia([
    { kind: "image", url: "https://cdn.discordapp.com/a/b.png" },
    { kind: "video", id: ID },
    { kind: "audio", url: "https://i.imgur.com/x.png" },
    null,
  ]);
  assert.deepEqual(media, [{ kind: "video", id: ID }]);
});

test("the strip and the video count are both capped", () => {
  const many = Array.from({ length: MEDIA_MAX + 5 }, (_, i) => ({
    kind: "image",
    url: `https://i.imgur.com/img${i}.png`,
  }));
  assert.equal(normalizeMedia(many).length, MEDIA_MAX);

  const videos = Array.from({ length: VIDEO_MAX + 3 }, (_, i) => ({
    kind: "video",
    id: `vid00000${i}00`.slice(0, 11),
  }));
  assert.equal(videoIdsOf(normalizeMedia(videos)).length <= VIDEO_MAX, true);
});

test("a listing written before the strip took images still plays its videos", () => {
  assert.deepEqual(mediaList({ videos: [ID, ID2] }), [
    { kind: "video", id: ID },
    { kind: "video", id: ID2 },
  ]);
  assert.deepEqual(mediaList({ video: ID }), [{ kind: "video", id: ID }]);
  assert.deepEqual(mediaList({}), []);
  assert.deepEqual(mediaList(), []);
});

test("media wins over the legacy fields once it exists", () => {
  const item = { media: [{ kind: "image", url: IMG }], videos: [ID], video: ID };
  assert.deepEqual(mediaList(item), [{ kind: "image", url: IMG }]);
});

test("uploadedUrls finds only our own files, for reclaiming the volume", () => {
  const media = [
    { kind: "image", url: "/uploads/a.webp" },
    { kind: "image", url: IMG },
    { kind: "video", id: ID },
  ];
  assert.deepEqual(uploadedUrls(media), ["/uploads/a.webp"]);
});
