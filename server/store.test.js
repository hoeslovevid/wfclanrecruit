// The file backend is what runs without a database, so it is what these cover.
// The Postgres lane runs the same call sequence against the same API; what is
// worth pinning here is the behaviour both must agree on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./store.js";
import { threadId } from "./messages.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfr-store-"));
await store.initStore(dir);

const ID = threadId("clan", "steel", "user-a", "user-b");

async function open() {
  return store.openThread({
    id: ID,
    kind: "clan",
    listingId: "steel",
    listingName: "Steel Meridian",
    userIds: ["user-a", "user-b"],
  });
}

test("the store writes its own file and never touches db.json", () => {
  assert.ok(fs.existsSync(path.join(dir, "messages.json")));
  assert.ok(!fs.existsSync(path.join(dir, "db.json")), "listings are a separate lane");
});

test("opening the same conversation twice returns the one thread", async () => {
  const first = await open();
  const second = await open();
  assert.equal(first.id, second.id);
  const members = await store.membersOf(ID);
  assert.equal(members.length, 2, "and does not duplicate the membership rows");
});

test("a sent message lands in the thread and moves it to the top", async () => {
  await open();
  const message = await store.addMessage({ threadId: ID, senderId: "user-a", body: "Hello" });
  const messages = await store.messagesIn(ID);
  assert.equal(messages.at(-1).body, "Hello");
  const thread = await store.getThread(ID);
  assert.equal(thread.lastMessageAt, message.createdAt);
});

test("sending counts as reading, so your own message is never unread to you", async () => {
  assert.equal(await store.unreadTotal("user-a"), 0);
  assert.equal(await store.unreadTotal("user-b"), 1, "but it is unread to the other side");
});

test("the inbox carries the last message and the reader's own unread count", async () => {
  const forB = await store.inboxFor("user-b");
  assert.equal(forB.length, 1);
  assert.equal(forB[0].last.body, "Hello");
  assert.equal(forB[0].unread, 1);
  const forA = await store.inboxFor("user-a");
  assert.equal(forA[0].unread, 0, "the same thread, the other reader, a different count");
});

test("marking read clears the count and does not clear it for the other side", async () => {
  await store.addMessage({ threadId: ID, senderId: "user-a", body: "Still here?" });
  assert.equal(await store.unreadTotal("user-b"), 2);
  await store.markRead(ID, "user-b");
  assert.equal(await store.unreadTotal("user-b"), 0);
  await store.addMessage({ threadId: ID, senderId: "user-b", body: "Yes" });
  assert.equal(await store.unreadTotal("user-a"), 1);
});

test("someone with no conversations has an empty inbox, not an error", async () => {
  assert.deepEqual(await store.inboxFor("user-nobody"), []);
  assert.equal(await store.unreadTotal("user-nobody"), 0);
});

test("a block is recorded and readable from either side", async () => {
  await store.setBlock("user-a", "user-b", true);
  const forA = await store.blocksFor("user-a");
  const forB = await store.blocksFor("user-b");
  assert.equal(forA.length, 1);
  assert.equal(forB.length, 1, "the blocked person's own lookup sees it too");
  await store.setBlock("user-a", "user-b", false);
  assert.deepEqual(await store.blocksFor("user-a"), []);
});

test("deleting an account keeps the conversation and drops the authorship", async () => {
  await store.dropUser("user-a");
  const messages = await store.messagesIn(ID);
  assert.ok(messages.length >= 3, "the other side's history is intact");
  assert.ok(
    messages.some((item) => item.senderId === null),
    "the deleted sender is a tombstone, not a hole"
  );
  assert.deepEqual(await store.inboxFor("user-a"), [], "a deleted account has no inbox");
  assert.equal((await store.membersOf(ID)).length, 1);
});

test("removing the listing removes the conversations about it", async () => {
  await store.dropListing("steel");
  assert.equal(await store.getThread(ID), null);
  assert.deepEqual(await store.messagesIn(ID), []);
  assert.deepEqual(await store.inboxFor("user-b"), []);
});

test("the store survives a restart", async () => {
  await store.openThread({
    id: "keep",
    kind: "player",
    listingId: "gunson",
    listingName: "Gunson",
    userIds: ["user-c", "user-d"],
  });
  await store.addMessage({ threadId: "keep", senderId: "user-c", body: "Interested?" });
  await store.initStore(dir);
  const inbox = await store.inboxFor("user-d");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].last.body, "Interested?");
  assert.equal(inbox[0].unread, 1);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// The bug this pins: unread is a timestamp comparison, and Node's clock only
// resolves to the millisecond. Two messages sent inside the same tick used to
// tie, which made the second one invisible to the person it was for.
test("two messages in the same millisecond are still both unread", async () => {
  await store.openThread({
    id: "fast",
    kind: "clan",
    listingId: "fast-clan",
    listingName: "Fast",
    userIds: ["user-x", "user-y"],
  });
  await store.addMessage({ threadId: "fast", senderId: "user-x", body: "one" });
  await store.addMessage({ threadId: "fast", senderId: "user-x", body: "two" });
  const inbox = await store.inboxFor("user-y");
  const thread = inbox.find((item) => item.id === "fast");
  assert.equal(thread.unread, 2);
  assert.equal(thread.last.body, "two", "and the newer one is still the newer one");
});

test("stamps never go backwards, however fast they are asked for", () => {
  const stamps = Array.from({ length: 50 }, () => store.nextStamp());
  const sorted = [...stamps].sort();
  assert.deepEqual(stamps, sorted);
  assert.equal(new Set(stamps).size, stamps.length, "and never repeat");
});
