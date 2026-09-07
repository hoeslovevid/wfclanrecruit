// The media strip carries images as well as videos. Pasted image links are
// somebody else's file on somebody else's host, so the allowlist here is what
// keeps a gallery from rotting or pointing somewhere it should not.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOW_PASTED_IMAGES,
  MEDIA_MAX,
  VIDEO_MAX,
  isUploadedImage,
  mediaList,
  normalizeMedia,
  parseImageUrl,
  setUploadPublicBase,
  uploadedUrls,
  videoIdsOf,
} from "../src/media.js";

const ID = "dQw4w9WgXcQ";
const ID2 = "abcdefghijk";
const IMG = "/uploads/1712-gallery.webp";

// Images are uploaded, not linked, so every image on the board is one we
// resized and can moderate. The allowlist is kept behind the flag for the day
// that changes.
test("pasting is off, so images only ever come from our own uploads", () => {
  assert.equal(ALLOW_PASTED_IMAGES, false, "flip this on deliberately, not by accident");
  assert.equal(parseImageUrl(IMG).url, IMG);
  assert.match(parseImageUrl("https://i.imgur.com/abc123.png").error, /Upload an image/);
  assert.match(parseImageUrl("i.redd.it/foo.jpg").error, /Upload an image/);
});

// A clan leader's first instinct is to paste a Discord link, and those expire.
// Worth its own message even with pasting off: it is the link a clan leader
// reaches for first, and knowing why saves a support round trip.
test("Discord links keep their own explanation", () => {
  const result = parseImageUrl("https://cdn.discordapp.com/attachments/1/2/clan.png?ex=abc");
  assert.match(result.error, /Discord/);
  assert.match(result.error, /expire/);
  assert.equal(result.url, undefined);
});

test("any pasted link is refused, and says to upload instead", () => {
  for (const url of ["https://example.com/clan.png", "https://i.imgur.com/gallery/abc", "not a url"]) {
    const result = parseImageUrl(url);
    assert.equal(result.url, undefined, url);
    assert.match(result.error, /Upload an image/, url);
  }
});

test("hostile schemes never survive", () => {
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "vbscript:msgbox"]) {
    assert.equal(parseImageUrl(bad).url, undefined, bad);
  }
});

test("our own uploads are trusted without the allowlist", () => {
  assert.equal(parseImageUrl("/uploads/1712-abc.webp").url, "/uploads/1712-abc.webp");
  assert.equal(isUploadedImage("/uploads/x.webp"), true);
  assert.equal(isUploadedImage("https://i.imgur.com/abc123.png"), false);
});

test("Cloudflare R2 public URLs count as our uploads once the origin is known", () => {
  try {
    setUploadPublicBase("https://media.example.com");
    const url = "https://media.example.com/listings/1736150400000-aabbccddeeff.webp";
    assert.equal(isUploadedImage(url), true);
    assert.equal(parseImageUrl(url).url, url);
    assert.equal(isUploadedImage("https://evil.test/listings/1736150400000-aabbccddeeff.webp"), false);
    assert.equal(isUploadedImage("https://media.example.com/secret.webp"), false);
    assert.deepEqual(uploadedUrls([{ kind: "image", url }, { kind: "image", url: "/uploads/a.webp" }]), [
      url,
      "/uploads/a.webp",
    ]);
    setUploadPublicBase("https://cdn.example.com/wf");
    assert.equal(isUploadedImage("https://cdn.example.com/wf/listings/1736150400000-aabbccddeeff.webp"), true);
    assert.equal(isUploadedImage("https://cdn.example.com/listings/1736150400000-aabbccddeeff.webp"), false);
  } finally {
    setUploadPublicBase("");
  }
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
    { kind: "audio", url: "/uploads/x.webp" },
    null,
  ]);
  assert.deepEqual(media, [{ kind: "video", id: ID }]);
});

test("the strip and the video count are both capped", () => {
  const many = Array.from({ length: MEDIA_MAX + 5 }, (_, i) => ({
    kind: "image",
    url: `/uploads/img${i}.webp`,
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

test("uploadedUrls finds only our own files, for reclaiming storage", () => {
  const media = [
    { kind: "image", url: "/uploads/a.webp" },
    { kind: "video", id: ID },
  ];
  assert.deepEqual(uploadedUrls(media), ["/uploads/a.webp"]);
});
