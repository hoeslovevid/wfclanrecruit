import test from "node:test";
import assert from "node:assert/strict";
import {
  RECRUITER_MAX,
  acceptedRecruiterIds,
  bestPresence,
  inviteBlocker,
  listingContacts,
  normalizeRecruiters,
  pendingInvitesFor,
  recruitingOn,
} from "./recruiters.js";

const OWNER = { id: "u-owner", username: "owner", forumVerified: true, forumName: "--Gunson--" };
const MATE = { id: "u-mate", username: "mate", forumVerified: true, forumName: "Tiltskillet" };
const RAW = { id: "u-raw", username: "raw", forumVerified: false, forumName: null };
const USERS = [OWNER, MATE, RAW];

const listing = (recruiters) => ({ ownerId: OWNER.id, recruiters });
const offline = () => ({ status: "online", online: false });
const inGame = () => ({ status: "ingame", online: true });

test("the roster is sanitized, deduped and capped", () => {
  assert.deepEqual(normalizeRecruiters(null), []);
  assert.deepEqual(normalizeRecruiters("nope"), []);
  const dupes = normalizeRecruiters([{ userId: "a" }, { userId: "a", status: "accepted" }]);
  assert.equal(dupes.length, 1, "a user cannot be on a roster twice");
  assert.equal(dupes[0].status, "pending", "first entry wins");
  assert.equal(normalizeRecruiters([{ userId: "x", status: "admin" }])[0].status, "pending", "unknown states fall back to pending");
  const many = normalizeRecruiters(Array.from({ length: 20 }, (_, i) => ({ userId: `u${i}` })));
  assert.equal(many.length, RECRUITER_MAX);
});

test("only accepted recruiters count", () => {
  const item = listing([
    { userId: "a", status: "accepted" },
    { userId: "b", status: "pending" },
  ]);
  assert.deepEqual(acceptedRecruiterIds(item), ["a"]);
});

test("contacts list the owner first and skip unverified or pending people", () => {
  const item = listing([
    { userId: MATE.id, status: "accepted" },
    { userId: RAW.id, status: "accepted" },
  ]);
  const contacts = listingContacts(item, USERS, offline);
  assert.deepEqual(
    contacts.map((c) => [c.name, c.owner]),
    [["--Gunson--", true], ["Tiltskillet", false]],
    "unverified recruiter has no in-game name, so cannot be whispered"
  );
});

test("a pending recruiter is not a contact", () => {
  const item = listing([{ userId: MATE.id, status: "pending" }]);
  assert.equal(listingContacts(item, USERS, offline).length, 1, "owner only");
});

test("the listing is online if anyone is, and in game outranks online", () => {
  assert.deepEqual(bestPresence([]), { online: false, presenceStatus: "offline" });
  assert.deepEqual(
    bestPresence([{ online: false }, { online: true, presenceStatus: "online" }]),
    { online: true, presenceStatus: "online" },
    "an offline owner does not hide an online recruiter"
  );
  assert.deepEqual(
    bestPresence([
      { online: true, presenceStatus: "online" },
      { online: true, presenceStatus: "ingame" },
    ]),
    { online: true, presenceStatus: "ingame" }
  );
});

test("presence flows from any accepted recruiter", () => {
  const item = listing([{ userId: MATE.id, status: "accepted" }]);
  const contacts = listingContacts(item, USERS, (user) => (user.id === MATE.id ? inGame() : offline()));
  assert.deepEqual(bestPresence(contacts), { online: true, presenceStatus: "ingame" });
});

test("invites are refused for every reason that would break a listing", () => {
  const empty = listing([]);
  assert.match(inviteBlocker(empty, undefined, OWNER), /No account/);
  assert.match(inviteBlocker(empty, OWNER, OWNER), /already the owner/);
  assert.match(inviteBlocker(empty, RAW, OWNER), /not verified/);
  assert.match(inviteBlocker(listing([{ userId: MATE.id, status: "accepted" }]), MATE, OWNER), /already a recruiter/);
  assert.match(inviteBlocker(listing([{ userId: MATE.id, status: "pending" }]), MATE, OWNER), /pending invite/);
  const full = listing(Array.from({ length: RECRUITER_MAX }, (_, i) => ({ userId: `u${i}` })));
  assert.match(inviteBlocker(full, MATE, OWNER), /at most/);
  assert.equal(inviteBlocker(empty, MATE, OWNER), null, "a verified stranger is invitable");
});

test("a user can find their pending invites and their memberships", () => {
  const db = {
    clans: [
      { id: "c1", name: "One", tag: "ONE", ownerId: OWNER.id, recruiters: [{ userId: MATE.id, status: "pending" }] },
      { id: "c2", name: "Two", tag: "TWO", ownerId: OWNER.id, recruiters: [{ userId: MATE.id, status: "accepted" }] },
      { id: "c3", name: "Three", tag: "THR", ownerId: OWNER.id, recruiters: [] },
    ],
  };
  assert.deepEqual(pendingInvitesFor(db, MATE.id).map((c) => c.id), ["c1"]);
  assert.deepEqual(recruitingOn(db, MATE.id).map((c) => c.id), ["c2"]);
  assert.deepEqual(pendingInvitesFor(db, "nobody"), []);
});
