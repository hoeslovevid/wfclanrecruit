import test from "node:test";
import assert from "node:assert/strict";
import {
  BODY_MAX,
  blockedBetween,
  bodyError,
  normalizeBody,
  openError,
  previewOf,
  threadId,
  unreadIn,
  parseThreadId,
} from "./messages.js";
import { listenerCount, publish, reset, subscribe, STREAMS_PER_USER } from "./live.js";

test("a body keeps the words and drops markup that is not allowed", () => {
  assert.equal(normalizeBody("  hi  "), "hi");
  assert.equal(normalizeBody("a\r\nb"), "a<br>b");
  assert.equal(normalizeBody("<strong>hello</strong>"), "<strong>hello</strong>");
  const mixed = normalizeBody("<strong>hello</strong><script>alert(1)</script>");
  assert.match(mixed, /<strong>hello<\/strong>/);
  assert.doesNotMatch(mixed, /<script/);
});

test("an empty message is refused, whitespace included", () => {
  assert.equal(bodyError(""), "Write a message first.");
  assert.equal(bodyError("   \n\n "), "Write a message first.");
  assert.equal(bodyError("hello"), null);
  assert.equal(bodyError("<p><br></p>"), "Write a message first.");
});

test("an over-long message is refused rather than silently cut", () => {
  assert.equal(bodyError("x".repeat(BODY_MAX)), null);
  assert.ok(bodyError("x".repeat(BODY_MAX + 1)));
});

// The derived id is what stops a second thread appearing every time someone
// clicks Message, so the order of the two ids must not matter.
test("the same two people about the same listing get the same thread", () => {
  assert.equal(threadId("clan", "steel", "a", "b"), threadId("clan", "steel", "b", "a"));
});

test("a different listing, kind or person is a different thread", () => {
  const base = threadId("clan", "steel", "a", "b");
  assert.notEqual(base, threadId("clan", "lotus", "a", "b"));
  assert.notEqual(base, threadId("player", "steel", "a", "b"));
  assert.notEqual(base, threadId("clan", "steel", "a", "c"));
});

test("you cannot open a thread with yourself, or about nothing", () => {
  assert.ok(openError({ senderId: "a", ownerId: "a", listingId: "steel" }));
  assert.ok(openError({ senderId: "a", ownerId: "b", listingId: "" }));
  assert.ok(openError({ senderId: "a", ownerId: null, listingId: "steel" }));
  assert.equal(openError({ senderId: "a", ownerId: "b", listingId: "steel" }), null);
});

const MESSAGES = [
  { senderId: "a", createdAt: "2026-09-01T00:00:00.000Z" },
  { senderId: "b", createdAt: "2026-09-02T00:00:00.000Z" },
  { senderId: "b", createdAt: "2026-09-03T00:00:00.000Z" },
];

test("unread counts the other side's messages since you last looked", () => {
  assert.equal(unreadIn(MESSAGES, { userId: "a", readAt: null }), 2);
  assert.equal(unreadIn(MESSAGES, { userId: "a", readAt: "2026-09-02T00:00:00.000Z" }), 1);
  assert.equal(unreadIn(MESSAGES, { userId: "a", readAt: "2026-09-03T00:00:00.000Z" }), 0);
});

test("your own messages are never unread to you", () => {
  assert.equal(unreadIn(MESSAGES, { userId: "b", readAt: null }), 1, "only a's message counts for b");
});

test("the inbox preview is one line of readable text, not markup", () => {
  assert.equal(previewOf("hello   there\nyou"), "hello there you");
  assert.equal(previewOf("<strong>hello</strong> there"), "hello there");
  assert.equal(previewOf(`hi <img data-emoji="emoji-1"> there`), "hi there");
  const long = previewOf("x".repeat(200), 10);
  assert.equal(long.length, 10);
  assert.ok(long.endsWith("…"));
});

test("a custom emoji is stored as data-emoji only", () => {
  const out = normalizeBody(`<img data-emoji="emoji-1" src="https://evil.example/x.png" onerror="alert(1)">`);
  assert.match(out, /data-emoji="emoji-1"/);
  assert.doesNotMatch(out, /src=/);
  assert.doesNotMatch(out, /onerror/);
  assert.doesNotMatch(out, /evil\.example/);
});

test("a block cuts both directions", () => {
  const blocks = [{ userId: "a", blockedId: "b" }];
  assert.equal(blockedBetween(blocks, "a", "b"), true);
  assert.equal(blockedBetween(blocks, "b", "a"), true, "the blocked person cannot write back either");
  assert.equal(blockedBetween(blocks, "a", "c"), false);
});

// --- Live delivery ---------------------------------------------------------

test("a published event reaches every stream that user has open", () => {
  reset();
  const seen = [];
  subscribe("user-1", (event, data) => seen.push([event, data.n]));
  subscribe("user-1", (event, data) => seen.push([event, data.n]));
  assert.equal(publish("user-1", "message", { n: 1 }), 2);
  assert.deepEqual(seen, [["message", 1], ["message", 1]]);
});

test("publishing to someone with nothing open is not an error", () => {
  reset();
  assert.equal(publish("nobody", "message", {}), 0);
});

test("a stream that throws is dropped rather than taking the send down", () => {
  reset();
  subscribe("user-1", () => {
    throw new Error("socket closed");
  });
  const seen = [];
  subscribe("user-1", (event) => seen.push(event));
  assert.doesNotThrow(() => publish("user-1", "message", {}));
  assert.equal(listenerCount("user-1"), 1, "the dead one is gone, the live one stays");
  assert.deepEqual(seen, ["message"]);
});

test("unsubscribing removes the stream", () => {
  reset();
  const off = subscribe("user-1", () => {});
  assert.equal(listenerCount("user-1"), 1);
  off();
  assert.equal(listenerCount("user-1"), 0);
});

test("too many tabs drops the oldest, never the newest", () => {
  reset();
  const seen = [];
  for (let i = 0; i < STREAMS_PER_USER + 1; i += 1) {
    subscribe("user-1", () => seen.push(i));
  }
  assert.equal(listenerCount("user-1"), STREAMS_PER_USER);
  publish("user-1", "message", {});
  assert.ok(!seen.includes(0), "the first tab is the one that was dropped");
});

// The thread is not written until the first message is sent, so that send
// arrives quoting an id for a row that does not exist. Reading it back is how
// the server knows what to check it against.
test("a thread id reads back as what it describes", () => {
  const id = threadId("clan", "clan-a", "u-b", "u-a");
  assert.deepEqual(parseThreadId(id), {
    kind: "clan",
    listingId: "clan-a",
    userIds: ["u-a", "u-b"],
  });
});

test("an id that is not one describes nothing", () => {
  assert.equal(parseThreadId(""), null);
  assert.equal(parseThreadId("clan:clan-a"), null);
  assert.equal(parseThreadId("clan:clan-a:u-a:u-b:extra"), null);
  assert.equal(parseThreadId("nonsense:clan-a:u-a:u-b"), null, "kind has to be one we serve");
  assert.equal(parseThreadId("clan::u-a:u-b"), null);
  assert.equal(parseThreadId("clan:clan-a:u-a:u-a"), null, "nobody messages themselves");
});
