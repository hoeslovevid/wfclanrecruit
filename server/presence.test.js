import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATUS,
  STALE_AFTER_MS,
  forget,
  keepMinutesOf,
  keepUntil,
  listingPresence,
  normalizeStatus,
  presenceOf,
  touch,
} from "./presence.js";

const NOW = Date.now();

test("a user with no stored choice stays offline even while their tab pings", () => {
  const user = { id: "fresh" };
  assert.equal(presenceOf(user, NOW).online, false);
  touch("fresh", NOW);
  assert.deepEqual(presenceOf(user, NOW), { status: "invisible", online: false, until: null });
});

test("a heartbeat goes stale", () => {
  const user = { id: "stale", presenceStatus: "online" };
  touch("stale", NOW);
  assert.equal(presenceOf(user, NOW + STALE_AFTER_MS - 1).online, true);
  assert.equal(presenceOf(user, NOW + STALE_AFTER_MS + 1).online, false);
});

test("invisible beats a live heartbeat and a held deadline", () => {
  touch("hidden", NOW);
  const user = {
    id: "hidden",
    presenceStatus: "invisible",
    presenceUntil: new Date(NOW + 60_000).toISOString(),
  };
  assert.equal(presenceOf(user, NOW).online, false);
});

test("a held status outlives the tab", () => {
  const user = {
    id: "held",
    presenceStatus: "online",
    presenceUntil: new Date(NOW + 4 * 60 * 60 * 1000).toISOString(),
  };
  // never touched, so no heartbeat is keeping this alive
  assert.equal(presenceOf(user, NOW).online, true);
  assert.equal(presenceOf(user, NOW + 5 * 60 * 60 * 1000).online, false);
});

test("forget drops someone immediately", () => {
  touch("bye", NOW);
  forget("bye");
  assert.equal(presenceOf({ id: "bye" }, NOW).online, false);
});

test("status and keep-for inputs are validated, not trusted", () => {
  assert.equal(normalizeStatus("ingame"), "ingame");
  assert.equal(normalizeStatus("bogus"), DEFAULT_STATUS);
  assert.equal(normalizeStatus(undefined), DEFAULT_STATUS);
  assert.equal(keepUntil(0), null);
  assert.equal(keepUntil(7), null, "an unlisted duration is refused");
  assert.equal(keepUntil(99999), null);
  assert.ok(keepUntil(240));
});

test("a listing reports its owner's presence, and nothing for a missing owner", () => {
  touch("owner", NOW);
  const users = [{ id: "owner", presenceStatus: "ingame" }];
  assert.deepEqual(listingPresence({ ownerId: "owner" }, users, NOW), {
    online: true,
    presenceStatus: "ingame",
  });
  assert.deepEqual(listingPresence({ ownerId: "ghost" }, users, NOW), {
    online: false,
    presenceStatus: "offline",
  });
});

// Offline is the default: being signed in with a tab open is not a statement
// that you are available to recruits.
test("a user who never chose a status is offline, not online", () => {
  assert.equal(DEFAULT_STATUS, "invisible");
  const fresh = { id: "u-new" };
  touch(fresh.id);
  const presence = presenceOf(fresh);
  assert.equal(presence.status, "invisible");
  assert.equal(presence.online, false, "a heartbeat alone must not broadcast presence");
  forget(fresh.id);
});

// The hold survived a reload all along - the picker just never rendered it, so
// it always claimed "while tab is open" and looked broken.
test("keepMinutesOf reports the live hold so the picker can show it", () => {
  const now = Date.now();
  const held = { presenceUntil: new Date(now + 20 * 60 * 1000).toISOString(), presenceKeep: 30 };
  assert.equal(keepMinutesOf(held, now), 30, "a 30m hold with 20m left still reads as 30m");
});

test("an expired or absent hold reports zero", () => {
  const now = Date.now();
  assert.equal(keepMinutesOf({ presenceUntil: new Date(now - 1000).toISOString(), presenceKeep: 30 }, now), 0);
  assert.equal(keepMinutesOf({ presenceKeep: 30 }, now), 0, "no deadline means no hold");
  assert.equal(keepMinutesOf({}, now), 0);
  assert.equal(keepMinutesOf(undefined, now), 0);
});


