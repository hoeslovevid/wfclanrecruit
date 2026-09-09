import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPendingAdmin,
  grantByDiscordId,
  grantByUserId,
  grantStaff,
  normalizeDiscordId,
  revokeAdmin,
  searchStaffCandidates,
  staffList,
} from "./admins.js";

test("normalizeDiscordId accepts snowflakes and strips mention wrapping", () => {
  assert.equal(normalizeDiscordId("123456789012345678"), "123456789012345678");
  assert.equal(normalizeDiscordId("<@123456789012345678>"), "123456789012345678");
  assert.equal(normalizeDiscordId("ID: 123456789012345678"), "123456789012345678");
  assert.equal(normalizeDiscordId("not-an-id"), "");
  assert.equal(normalizeDiscordId("12345"), "");
});

test("grantByDiscordId promotes an existing account and otherwise waits", () => {
  const actor = { id: "user-a", admin: true };
  const signedIn = {
    users: [{ id: "user-b", discordId: "123456789012345678", admin: false }],
    adminGrants: [],
  };
  const live = grantByDiscordId(signedIn, "123456789012345678", actor);
  assert.equal(live.ok, true);
  assert.equal(live.pending, false);
  assert.equal(signedIn.users[0].admin, true);

  const waiting = { users: [], adminGrants: [] };
  const pending = grantByDiscordId(waiting, "<@987654321098765432>", actor);
  assert.equal(pending.ok, true);
  assert.equal(pending.pending, true);
  assert.equal(waiting.adminGrants[0].discordId, "987654321098765432");
});

test("applyPendingAdmin promotes on first Discord sign-in", () => {
  const db = {
    users: [{ id: "user-c", discordId: "111111111111111111", admin: false }],
    adminGrants: [{ discordId: "111111111111111111", grantedAt: "2026-09-08T00:00:00.000Z" }],
  };
  assert.equal(applyPendingAdmin(db, db.users[0]), true);
  assert.equal(db.users[0].admin, true);
  assert.equal(db.adminGrants.length, 0);
});

test("revokeAdmin refuses self, env operator, and the last live admin", () => {
  const previous = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = "site-op";
  try {
    const actor = { id: "user-a", admin: true };
    const db = {
      users: [
        { id: "user-a", username: "alpha", admin: true },
        { id: "user-admin", username: "site-op", admin: true },
      ],
      adminGrants: [{ discordId: "222222222222222222" }],
    };
    assert.match(revokeAdmin(db, { userId: "user-a" }, actor).error, /own admin/);
    assert.match(revokeAdmin(db, { userId: "user-admin" }, actor).error, /password operator/);

    const only = {
      users: [{ id: "user-a", username: "alpha", admin: true }],
      adminGrants: [],
    };
    assert.match(revokeAdmin(only, { userId: "user-a" }, { id: "user-b" }).error, /last admin/);

    const cancelled = revokeAdmin(db, { discordId: "222222222222222222" }, actor);
    assert.equal(cancelled.ok, true);
    assert.equal(db.adminGrants.length, 0);
  } finally {
    if (previous == null) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previous;
  }
});

test("staffList hides passwords and splits live admins from pending IDs", () => {
  const db = {
    users: [
      { id: "user-a", username: "alpha", discordId: "123456789012345678", admin: true, password: "secret" },
      { id: "user-b", username: "beta", admin: false },
    ],
    adminGrants: [{ discordId: "999999999999999999", grantedAt: "2026-09-08T00:00:00.000Z" }],
  };
  const list = staffList(db, "user-a");
  assert.equal(list.admins.length, 1);
  assert.equal(list.admins[0].you, true);
  assert.equal(list.admins[0].password, undefined);
  assert.deepEqual(list.pending, [{ discordId: "999999999999999999", grantedAt: "2026-09-08T00:00:00.000Z" }]);
});

test("grantStaff promotes an existing account by name", () => {
  const actor = { id: "user-a", admin: true };
  const db = {
    users: [
      { id: "user-a", username: "alpha", admin: true },
      {
        id: "user-b",
        username: "beta",
        discordUsername: "NasNotDaily",
        forumVerified: true,
        forumName: "--Gunson--",
        admin: false,
      },
    ],
    adminGrants: [],
  };
  const byForum = grantStaff(db, "--Gunson--", actor);
  assert.equal(byForum.ok, true);
  assert.equal(byForum.pending, false);
  assert.equal(db.users[1].admin, true);
});

test("grantByUserId promotes from a dashboard pick", () => {
  const actor = { id: "user-a", admin: true };
  const db = {
    users: [
      { id: "user-a", username: "alpha", admin: true },
      { id: "user-b", username: "beta", admin: false },
    ],
    adminGrants: [],
  };
  const result = grantByUserId(db, "user-b", actor);
  assert.equal(result.ok, true);
  assert.equal(db.users[1].admin, true);
});

test("searchStaffCandidates offers signed-in people, not current admins", () => {
  const users = [
    { id: "user-a", username: "alpha", admin: true },
    { id: "user-b", username: "beta", discordUsername: "NasNotDaily", admin: false },
    { id: "user-c", username: "gamma", forumVerified: true, forumName: "--Gunson--", admin: false },
  ];
  const hits = searchStaffCandidates(users, "gun", "user-a");
  assert.deepEqual(
    hits.map((item) => item.id),
    ["user-c"]
  );
  assert.equal(searchStaffCandidates(users, "alp", "user-a").length, 0);
  assert.equal(searchStaffCandidates(users, "g", "user-a").length, 0);
});
