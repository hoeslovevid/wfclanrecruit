// A clan can be full and still be short an architect, so roles are recruited
// for separately from members. What the board filters on is which of those
// seats are actually takeable.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_MAX,
  ROLE_NAME_MAX,
  ROLE_TEXT_MAX,
  hasOpenRole,
  isRoleOpen,
  normalizeRoleStatus,
  normalizeRoles,
  openRoleNames,
  roleFilterOptions,
  rolesOf,
} from "../src/roles.js";

const role = (name, extra = {}) => ({ name, status: "Open", count: 1, ...extra });

test("a role needs a name and nothing else", () => {
  assert.deepEqual(normalizeRoles([{ name: "Architect" }]), [
    { name: "Architect", status: "Open", count: 0, description: "", requirements: "" },
  ]);
  assert.deepEqual(normalizeRoles([{ name: "   " }, {}, null]), [], "a nameless role is not a role");
});

test("status falls back to Open rather than refusing the save", () => {
  assert.equal(normalizeRoleStatus("selective"), "Selective");
  assert.equal(normalizeRoleStatus("CLOSED"), "Closed");
  assert.equal(normalizeRoleStatus("bogus"), "Open");
  assert.equal(normalizeRoleStatus(undefined), "Open");
});

test("the same role twice is one role", () => {
  const out = normalizeRoles([role("Recruiter"), role("recruiter", { count: 9 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 1, "the first one wins");
});

test("counts and free text are bounded", () => {
  const [out] = normalizeRoles([
    { name: "x".repeat(ROLE_NAME_MAX + 20), count: 9999, description: "d".repeat(ROLE_TEXT_MAX + 50) },
  ]);
  assert.equal(out.name.length, ROLE_NAME_MAX);
  assert.equal(out.count, 99);
  assert.equal(out.description.length, ROLE_TEXT_MAX);
  assert.equal(normalizeRoles([{ name: "a", count: -5 }])[0].count, 0);
  assert.equal(normalizeRoles([{ name: "a", count: "not a number" }])[0].count, 0);
});

test("the list is capped", () => {
  const many = Array.from({ length: ROLE_MAX + 4 }, (_, i) => role(`Role ${i}`));
  assert.equal(normalizeRoles(many).length, ROLE_MAX);
});

// Selective still takes applications - it just says the clan chooses - so only
// Closed drops out of the filter.
test("only Closed roles stop counting as recruiting", () => {
  assert.equal(isRoleOpen({ status: "Open" }), true);
  assert.equal(isRoleOpen({ status: "Selective" }), true);
  assert.equal(isRoleOpen({ status: "Closed" }), false);

  const clan = {
    roles: [role("Architect"), role("Event Organizer", { status: "Selective" }), role("Moderator", { status: "Closed" })],
  };
  assert.deepEqual(openRoleNames(clan), ["Architect", "Event Organizer"]);
  assert.equal(hasOpenRole(clan, "architect"), true, "matching ignores case");
  assert.equal(hasOpenRole(clan, "Moderator"), false, "a closed seat is not a vacancy");
  assert.equal(hasOpenRole(clan, "Nobody"), false);
});

test("a listing with no roles is simply not recruiting for any", () => {
  assert.deepEqual(rolesOf({}), []);
  assert.deepEqual(openRoleNames({}), []);
  assert.equal(hasOpenRole({}, "Architect"), false);
});

// The filter is built from the board so it can never offer a role that would
// return nothing.
test("filter options come from open roles, commonest first", () => {
  const clans = [
    { roles: [role("Architect"), role("Recruiter")] },
    { roles: [role("Architect")] },
    { roles: [role("Moderator", { status: "Closed" })] },
  ];
  assert.deepEqual(
    roleFilterOptions(clans).map((option) => `${option.name}:${option.count}`),
    ["Architect:2", "Recruiter:1"]
  );
  assert.deepEqual(roleFilterOptions([]), []);
});
