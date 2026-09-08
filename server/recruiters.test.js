import test from "node:test";
import assert from "node:assert/strict";
import {
  RECRUITER_MAX,
  acceptedRecruiterIds,
  bestPresence,
  findInvitee,
  inviteBlocker,
  listingContacts,
  normalizeRecruiters,
  pendingInvitesFor,
  recruitingOn,
  searchRecruiterCandidates,
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
  assert.match(inviteBlocker(empty, undefined, OWNER), /No verified player/);
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

test("an invite matches the verified Warframe name, not the account username", () => {
  assert.equal(findInvitee(USERS, "--Gunson--")?.id, OWNER.id);
  assert.equal(findInvitee(USERS, "--gunson--")?.id, OWNER.id);
  assert.equal(findInvitee(USERS, "  --Gunson--  ")?.id, OWNER.id);
  // "owner" is the Discord/account username, and no longer resolves.
  assert.equal(findInvitee(USERS, "owner"), null);
  assert.equal(findInvitee(USERS, ""), null);
  assert.equal(findInvitee(USERS, null), null);
});

test("an unverified player is not found by name, even a matching one", () => {
  const users = [{ id: "u-x", username: "x", forumVerified: false, forumName: "Ghost" }];
  assert.equal(findInvitee(users, "Ghost"), null);
});

test("suggestions wait for two characters", () => {
  assert.deepEqual(searchRecruiterCandidates(USERS, listing([]), ""), []);
  assert.deepEqual(searchRecruiterCandidates(USERS, listing([]), "T"), []);
  assert.deepEqual(searchRecruiterCandidates(USERS, listing([]), "Ti"), ["Tiltskillet"]);
});

test("suggestions match anywhere in the name and ignore case", () => {
  assert.deepEqual(searchRecruiterCandidates(USERS, listing([]), "skil"), ["Tiltskillet"]);
  assert.deepEqual(searchRecruiterCandidates(USERS, listing([]), "TILT"), ["Tiltskillet"]);
});

test("suggestions never offer the owner, the unverified, or anyone already invited", () => {
  // The owner's own name is a match on the text but can never be invited.
  assert.deepEqual(searchRecruiterCandidates(USERS, listing([]), "gunson"), []);
  // Unverified players have no in-game name to whisper.
  assert.deepEqual(searchRecruiterCandidates(USERS, listing([]), "raw"), []);
  const pending = listing([{ userId: MATE.id, status: "pending" }]);
  assert.deepEqual(searchRecruiterCandidates(USERS, pending, "Tilt"), []);
  const accepted = listing([{ userId: MATE.id, status: "accepted" }]);
  assert.deepEqual(searchRecruiterCandidates(USERS, accepted, "Tilt"), []);
});

test("names that start with what was typed come first, then the rest by name", () => {
  const users = [
    { id: "a", username: "a", forumVerified: true, forumName: "Zephyr" },
    { id: "b", username: "b", forumVerified: true, forumName: "Ashen" },
    { id: "c", username: "c", forumVerified: true, forumName: "MidAshField" },
  ];
  assert.deepEqual(searchRecruiterCandidates(users, { ownerId: "owner" }, "ash"), [
    "Ashen",
    "MidAshField",
  ]);
});

test("suggestions are capped", () => {
  const users = Array.from({ length: 20 }, (_, i) => ({
    id: `u${i}`,
    username: `u${i}`,
    forumVerified: true,
    forumName: `Tenno${String(i).padStart(2, "0")}`,
  }));
  assert.equal(searchRecruiterCandidates(users, { ownerId: "owner" }, "tenno").length, 8);
  assert.equal(searchRecruiterCandidates(users, { ownerId: "owner" }, "tenno", 3).length, 3);
});

test("a listing with no recruiters yet still filters its owner out", () => {
  assert.deepEqual(searchRecruiterCandidates(USERS, { ownerId: OWNER.id }, "Gun"), []);
});
