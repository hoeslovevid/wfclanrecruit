// The messaging surface renders from plain data, so it can be checked without
// a browser. What is worth pinning here is the part that is easy to get subtly
// wrong: the tick means "verified" and nothing else, and it must never turn
// into a gate.
import test from "node:test";
import assert from "node:assert/strict";
import {
  conversationHtml,
  ignoreListHtml,
  ignoreRow,
  messageBubble,
  messagePresence,
  messagesView,
  relativeTime,
  threadRow,
  verifiedTick,
} from "./views.js";

const verified = { id: "u1", name: "Gunson", verified: true, online: false };
const plain = { id: "u2", name: "NasNotDaily", verified: false, online: false };

const thread = {
  id: "clan:steel:u1:u2",
  kind: "clan",
  listingId: "steel",
  listingName: "Steel Meridian",
  href: "/clans/steel",
  preview: "Hi ill buy zylok",
  unread: 0,
  blocked: false,
  lastMessageAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  with: plain,
};

test("verifiedTick renders only for a verified account", () => {
  assert.match(verifiedTick(true), /verified-tick/);
  assert.equal(verifiedTick(false), "");
  assert.equal(verifiedTick(undefined), "");
});

test("verifiedTick is labelled for a screen reader", () => {
  assert.match(verifiedTick(true), /aria-label="Verified"/);
});

test("a thread row carries the tick when the other person is verified", () => {
  assert.match(threadRow({ ...thread, with: verified }), /verified-tick/);
});

// The point of the whole change: an unverified account is a full participant.
// The row must still render their name, their preview and a way in.
test("a thread row with an unverified person renders without a tick and is not gated", () => {
  const html = threadRow(thread);
  assert.doesNotMatch(html, /verified-tick/);
  assert.match(html, /NasNotDaily/);
  assert.match(html, /Hi ill buy zylok/);
  assert.match(html, /data-thread="clan:steel:u1:u2"/);
});

test("a thread row says how stale the conversation is", () => {
  assert.match(threadRow(thread), /Last update 3 days ago/);
});

test("a thread row with nothing said yet says so rather than printing a date", () => {
  const html = threadRow({ ...thread, lastMessageAt: null, last: null });
  assert.match(html, /No messages yet/);
});

test("presence in the inbox names offline out loud", () => {
  assert.match(messagePresence(plain), /Offline/);
  assert.match(messagePresence({ ...plain, online: true, presenceStatus: "ingame" }), /Online in game/);
  // A missing person is offline, not a crash.
  assert.match(messagePresence(undefined), /Offline/);
});

test("relativeTime counts up through the units and hands back past a year", () => {
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  assert.equal(relativeTime(ago(5 * 1000)), "just now");
  assert.equal(relativeTime(ago(3 * 60 * 1000)), "3 minutes ago");
  assert.equal(relativeTime(ago(60 * 60 * 1000)), "1 hour ago");
  assert.equal(relativeTime(ago(2 * 24 * 60 * 60 * 1000)), "2 days ago");
  assert.doesNotMatch(relativeTime(ago(500 * 24 * 60 * 60 * 1000)), /ago/);
  assert.equal(relativeTime("not a date"), "");
});

test("a message bubble ticks its author", () => {
  const message = { senderId: "u1", body: "hello", createdAt: new Date().toISOString(), from: verified };
  assert.match(messageBubble(message, "u2"), /verified-tick/);
  assert.doesNotMatch(messageBubble({ ...message, from: plain }, "u2"), /verified-tick/);
});

test("the conversation menu offers ignore and leave, in wfmarket's words", () => {
  const html = conversationHtml(thread, [], "u1");
  assert.match(html, /thread-menu/);
  assert.match(html, /Ignore user/);
  assert.match(html, /Leave chat/);
});

// A draft has no stored thread to leave, so offering it would be a lie - but
// there is still someone to ignore, so the menu must not vanish with it.
test("a draft conversation offers ignore but not leave", () => {
  const html = conversationHtml({ ...thread, draft: true }, [], "u1");
  assert.match(html, /Ignore user/);
  assert.doesNotMatch(html, /Leave chat/);
});

test("an ignored conversation offers the way back and no composer", () => {
  const html = conversationHtml({ ...thread, blocked: true }, [], "u1");
  assert.match(html, /Stop ignoring/);
  assert.doesNotMatch(html, /data-send-form/);
});

test("the composer counts characters against the limit it enforces", () => {
  const html = conversationHtml(thread, [], "u1");
  assert.match(html, /0\/2000 chars\./);
  assert.match(html, /maxlength="2000"/);
});

test("the ignore list undoes a block through the same hook the menu uses", () => {
  const html = ignoreRow({ ...plain, since: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  assert.match(html, /data-block-user="u2"/);
  assert.match(html, /data-blocked="1"/);
  assert.match(html, /Un-ignore/);
  assert.match(html, /Ignored 1 hour ago/);
});

test("an empty ignore list explains itself instead of rendering nothing", () => {
  assert.match(ignoreListHtml([]), /not ignored anyone/);
});

test("the messages page marks whichever tab is showing", () => {
  const chats = messagesView({ user: { id: "u1" }, threads: [thread] });
  assert.match(chats, /class="tab is-active" href="\/messages"/);
  const ignoring = messagesView({ user: { id: "u1" }, threads: [], tab: "ignore" });
  assert.match(ignoring, /data-ignore-list/);
  assert.match(ignoring, /class="tab is-active" href="\/messages\?tab=ignore"/);
});

// An empty inbox used to return before the tabs existed. Someone with nobody to
// talk to may still have people to un-ignore, and needs the tab to reach them.
test("an empty inbox still shows the ignore tab", () => {
  const html = messagesView({ user: { id: "u1" }, threads: [] });
  assert.match(html, /No conversations yet/);
  assert.match(html, /href="\/messages\?tab=ignore"/);
});
