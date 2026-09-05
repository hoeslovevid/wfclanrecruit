import test from "node:test";
import assert from "node:assert/strict";
import { isRecruiting, whisperName, withListingState } from "./listing.js";

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
