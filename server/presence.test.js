import test from "node:test";
import assert from "node:assert/strict";
import {
  STALE_AFTER_MS,
  forget,
  keepUntil,
  listingPresence,
  normalizeStatus,
  presenceOf,
  touch,
} from "./presence.js";

const NOW = Date.now();

test("a user with no stored choice defaults to online once their tab pings", () => {
  const user = { id: "fresh" };
  assert.equal(presenceOf(user, NOW).online, false);
  touch("fresh", NOW);
  assert.deepEqual(presenceOf(user, NOW), { status: "online", online: true, until: null });
});

test("a heartbeat goes stale", () => {
  touch("stale", NOW);
  assert.equal(presenceOf({ id: "stale" }, NOW + STALE_AFTER_MS - 1).online, true);
  assert.equal(presenceOf({ id: "stale" }, NOW + STALE_AFTER_MS + 1).online, false);
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
  const user = { id: "held", presenceUntil: new Date(NOW + 4 * 60 * 60 * 1000).toISOString() };
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
  assert.equal(normalizeStatus("bogus"), "online");
  assert.equal(normalizeStatus(undefined), "online");
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
