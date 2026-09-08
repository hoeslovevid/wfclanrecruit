// Ownership moves because the person who wrote the post is not always the
// person it belongs to. What is worth pinning is the shape of the hand-over:
// nobody is given a listing without accepting, and the person handing it over
// does not fall off the post they have been running.
import test from "node:test";
import assert from "node:assert/strict";
import { RECRUITER_MAX } from "./recruiters.js";
import {
  applyTransfer,
  clearTransfer,
  hasTransferFor,
  normalizeTransfer,
  offerTransfer,
  transferBlocker,
  transfersFor,
} from "./ownership.js";

const verified = (id, forumName) => ({ id, forumName, forumVerified: true });

function listing(extra = {}) {
  return { id: "clan-a", name: "Alpha", tag: "AAA", ownerId: "user-1", recruiters: [], ...extra };
}

test("a listing with no offer has no transfer", () => {
  assert.equal(normalizeTransfer(listing()), null);
  assert.equal(normalizeTransfer({ transfer: { toUserId: "" } }), null);
});

test("an offer names who it is waiting on", () => {
  const clan = offerTransfer(listing(), "user-2", "2026-01-01T00:00:00.000Z");
  assert.deepEqual(normalizeTransfer(clan), {
    toUserId: "user-2",
    invitedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(hasTransferFor(clan, "user-2"), true);
  assert.equal(hasTransferFor(clan, "user-3"), false);
  assert.equal(normalizeTransfer(clearTransfer(clan)), null);
});

test("you cannot offer a listing to nobody, to yourself, or twice", () => {
  const clan = listing();
  assert.match(transferBlocker(clan, null), /No verified player/);
  assert.match(
    transferBlocker(clan, { id: "user-9", forumName: "Nine", forumVerified: false }),
    /has not verified/
  );
  assert.match(transferBlocker(clan, verified("user-1", "Owner")), /already own/);
  assert.equal(transferBlocker(clan, verified("user-2", "Two")), null);

  offerTransfer(clan, "user-2");
  assert.match(transferBlocker(clan, verified("user-2", "Two")), /already have a pending offer/);
  // A second offer would leave two people each believing the post was theirs.
  assert.match(transferBlocker(clan, verified("user-3", "Three")), /already offered/);
});

test("accepting hands the post over and leaves the old owner editing it", () => {
  const clan = offerTransfer(listing({ ownerLabel: "Recruiter" }), "user-2");
  applyTransfer(clan, "user-2", "2026-02-02T00:00:00.000Z");

  assert.equal(clan.ownerId, "user-2");
  assert.equal(normalizeTransfer(clan), null);
  // The incoming owner writes their own title rather than inheriting one.
  assert.equal(clan.ownerLabel, null);

  assert.deepEqual(clan.recruiters, [
    {
      userId: "user-1",
      status: "accepted",
      role: "editor",
      label: "Recruiter",
      invitedAt: "2026-02-02T00:00:00.000Z",
      respondedAt: "2026-02-02T00:00:00.000Z",
    },
  ]);
});

test("the new owner stops being a recruiter on their own listing", () => {
  const clan = listing({
    recruiters: [
      { userId: "user-2", status: "accepted", role: "recruiter" },
      { userId: "user-3", status: "accepted", role: "editor" },
    ],
  });
  applyTransfer(clan, "user-2");
  assert.deepEqual(
    clan.recruiters.map((item) => item.userId),
    ["user-3", "user-1"]
  );
});

test("a full roster gives up a pending invite rather than an accepted recruiter", () => {
  const clan = listing({
    recruiters: Array.from({ length: RECRUITER_MAX }, (unused, index) => ({
      userId: `user-r${index}`,
      status: index === RECRUITER_MAX - 1 ? "pending" : "accepted",
      role: "recruiter",
    })),
  });
  applyTransfer(clan, "user-9");

  assert.equal(clan.recruiters.length, RECRUITER_MAX);
  assert.equal(clan.ownerId, "user-9");
  // The pending seat went; every accepted name is still on the post, and the
  // outgoing owner took the seat that freed up.
  assert.equal(
    clan.recruiters.some((item) => item.userId === `user-r${RECRUITER_MAX - 1}`),
    false
  );
  assert.equal(
    clan.recruiters.some((item) => item.userId === "user-1" && item.role === "editor"),
    true
  );
});

test("a full roster of accepted recruiters keeps every one of them", () => {
  const clan = listing({
    recruiters: Array.from({ length: RECRUITER_MAX }, (unused, index) => ({
      userId: `user-r${index}`,
      status: "accepted",
      role: "recruiter",
    })),
  });
  applyTransfer(clan, "user-9");
  assert.equal(clan.recruiters.length, RECRUITER_MAX);
  // No seat to give, so the outgoing owner does not get one - a name someone
  // agreed to publish is not dropped to make room for one they did not.
  assert.equal(
    clan.recruiters.some((item) => item.userId === "user-1"),
    false
  );
});

test("offers waiting on a person are found across every listing", () => {
  const db = {
    clans: [
      offerTransfer(listing(), "user-2"),
      listing({ id: "clan-b", name: "Beta", tag: "BBB" }),
      offerTransfer(listing({ id: "clan-c", name: "Gamma", tag: "CCC" }), "user-3"),
    ],
  };
  assert.deepEqual(transfersFor(db, "user-2"), [{ id: "clan-a", name: "Alpha", tag: "AAA" }]);
  assert.deepEqual(transfersFor(db, "user-4"), []);
});
