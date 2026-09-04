import test from "node:test";
import assert from "node:assert/strict";
import { dropLegacyVideos, parseYouTubeId, youTubeEmbedUrl } from "../src/video.js";

const ID = "dQw4w9WgXcQ";

test("parseYouTubeId reads a standard watch link", () => {
  assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`), ID);
});

test("parseYouTubeId reads a short youtu.be link", () => {
  assert.equal(parseYouTubeId(`https://youtu.be/${ID}`), ID);
});

test("parseYouTubeId reads a shorts link", () => {
  assert.equal(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`), ID);
});

test("parseYouTubeId reads an embed link", () => {
  assert.equal(parseYouTubeId(`https://www.youtube.com/embed/${ID}`), ID);
});

test("parseYouTubeId reads a nocookie embed link", () => {
  assert.equal(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
});

test("parseYouTubeId ignores trailing query noise", () => {
  assert.equal(parseYouTubeId(`https://youtu.be/${ID}?si=AbCdEf&t=42`), ID);
  assert.equal(parseYouTubeId(`https://www.youtube.com/watch?list=PL1&v=${ID}&index=3`), ID);
  assert.equal(parseYouTubeId(`https://www.youtube.com/shorts/${ID}?feature=share`), ID);
});

test("parseYouTubeId accepts a link with no scheme", () => {
  assert.equal(parseYouTubeId(`youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseYouTubeId(`youtu.be/${ID}`), ID);
});

test("parseYouTubeId accepts the mobile host", () => {
  assert.equal(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`), ID);
});

test("parseYouTubeId trims surrounding whitespace", () => {
  assert.equal(parseYouTubeId(`  https://youtu.be/${ID}  `), ID);
});

test("parseYouTubeId refuses another video host", () => {
  assert.equal(parseYouTubeId(`https://vimeo.com/${ID}`), null);
  assert.equal(parseYouTubeId(`https://www.twitch.tv/videos/12345`), null);
});

test("parseYouTubeId refuses a lookalike host", () => {
  assert.equal(parseYouTubeId(`https://youtube.com.evil.test/watch?v=${ID}`), null);
  assert.equal(parseYouTubeId(`https://evil.test/youtube.com/watch?v=${ID}`), null);
  assert.equal(parseYouTubeId(`https://notyoutube.com/watch?v=${ID}`), null);
});

test("parseYouTubeId refuses a dangerous scheme", () => {
  assert.equal(parseYouTubeId("javascript:alert(1)"), null);
  assert.equal(parseYouTubeId(`javascript:void("youtube.com/watch?v=${ID}")`), null);
  assert.equal(parseYouTubeId(`data:text/html,youtu.be/${ID}`), null);
});

test("parseYouTubeId refuses a malformed id", () => {
  assert.equal(parseYouTubeId("https://youtu.be/short"), null);
  assert.equal(parseYouTubeId("https://youtu.be/waaaaaaaaaaytoolong"), null);
  assert.equal(parseYouTubeId("https://www.youtube.com/watch?v=bad!chars$"), null);
});

test("parseYouTubeId refuses a youtube link carrying no video", () => {
  assert.equal(parseYouTubeId("https://www.youtube.com/"), null);
  assert.equal(parseYouTubeId("https://www.youtube.com/watch"), null);
  assert.equal(parseYouTubeId("https://www.youtube.com/@somechannel"), null);
});

test("parseYouTubeId refuses empty and non-string input", () => {
  assert.equal(parseYouTubeId(""), null);
  assert.equal(parseYouTubeId("   "), null);
  assert.equal(parseYouTubeId(null), null);
  assert.equal(parseYouTubeId(undefined), null);
  assert.equal(parseYouTubeId({ v: ID }), null);
});

test("parseYouTubeId returns the stored id unchanged", () => {
  assert.equal(parseYouTubeId(ID), ID);
});

test("youTubeEmbedUrl builds a privacy-mode embed", () => {
  assert.equal(youTubeEmbedUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}`);
});

test("youTubeEmbedUrl refuses anything that is not an id", () => {
  assert.equal(youTubeEmbedUrl("bad!chars$x"), null);
  assert.equal(youTubeEmbedUrl(""), null);
  assert.equal(youTubeEmbedUrl(null), null);
});

test("dropLegacyVideos clears uploaded clips and reports their files", () => {
  const listings = [
    { id: "a", video: "/uploads/1712-abc.mp4" },
    { id: "b", video: ID },
    { id: "c", video: null },
    { id: "d" },
  ];
  assert.deepEqual(dropLegacyVideos(listings), ["/uploads/1712-abc.mp4"]);
  assert.equal(listings[0].video, null);
  assert.equal(listings[1].video, ID, "a YouTube id must survive the sweep");
  assert.equal(listings[2].video, null);
  assert.equal(listings[3].video, undefined);
});

test("dropLegacyVideos is a no-op the second time", () => {
  const listings = [{ id: "a", video: "/uploads/1712-abc.mp4" }];
  dropLegacyVideos(listings);
  assert.deepEqual(dropLegacyVideos(listings), []);
});

test("dropLegacyVideos survives missing input", () => {
  assert.deepEqual(dropLegacyVideos(), []);
  assert.deepEqual(dropLegacyVideos([null, undefined]), []);
});
