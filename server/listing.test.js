import test from "node:test";
import assert from "node:assert/strict";
import { isRecruiting, ownerVerified, whisperName, withListingState } from "./listing.js";

const VERIFIED = { id: "user-1", forumVerified: true, forumName: "--Gunson--" };
const UNVERIFIED = { id: "user-2", forumVerified: false, forumName: "Impostor" };
const NAMELESS = { id: "user-3", forumVerified: true, forumName: null };
const USERS = [VERIFIED, UNVERIFIED, NAMELESS];

test("whisperName returns the owner's verified forum name", () => {
  assert.equal(whisperName({ ownerId: "user-1" }, USERS), "--Gunson--");
});

test("whisperName refuses an unverified owner", () => {
  assert.equal(whisperName({ ownerId: "user-2" }, USERS), null);
});

test("whisperName refuses a verified owner with no forum name", () => {
  assert.equal(whisperName({ ownerId: "user-3" }, USERS), null);
});

test("whisperName survives a deleted owner", () => {
  assert.equal(whisperName({ ownerId: "user-gone" }, USERS), null);
  assert.equal(whisperName({ ownerId: "user-1" }, undefined), null);
});

test("a hidden listing is not recruiting", () => {
  const live = { paused: false, inviteOk: true, createdAt: new Date().toISOString() };
  assert.equal(isRecruiting(live), true);
  assert.equal(isRecruiting({ ...live, hidden: true }), false);
  assert.equal(withListingState({ ...live, hidden: true }).hidden, true);
});

// The tick and the whisper are different questions. Someone can hold a verified
// forum identity and still have no in-game name published on a listing, and the
// badge belongs to the person either way.
test("ownerVerified follows the flag, not the forum name", () => {
  assert.equal(ownerVerified({ ownerId: "user-1" }, USERS), true);
  assert.equal(ownerVerified({ ownerId: "user-3" }, USERS), true, "verified with no name is still verified");
  assert.equal(whisperName({ ownerId: "user-3" }, USERS), null, "but there is nothing to whisper");
});

test("ownerVerified is false for an unverified or missing owner", () => {
  assert.equal(ownerVerified({ ownerId: "user-2" }, USERS), false);
  assert.equal(ownerVerified({ ownerId: "user-gone" }, USERS), false);
  assert.equal(ownerVerified({ ownerId: "user-1" }, undefined), false);
});
