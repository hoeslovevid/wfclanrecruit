// A clan can be full and still be short an architect, so roles are recruited
// for separately from members. What the board filters on is which of those
// seats are actually takeable.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_LABEL_MAX,
  normalizeContactLabel,
  ROLE_MAX,
  ROLE_NAME_MAX,
  ROLE_PLAIN_MAX,
  hasOpenRole,
  isRoleOpen,
  normalizeRoleStatus,
  normalizeRoles,
  openRoleNames,
  roleFilterOptions,
  roleTextError,
  rolesOf,
} from "../src/roles.js";
import { plainTextFromHtml } from "../src/richtext.js";

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

test("names and counts are bounded", () => {
  const [out] = normalizeRoles([{ name: "x".repeat(ROLE_NAME_MAX + 20), count: 9999 }]);
  assert.equal(out.name.length, ROLE_NAME_MAX);
  assert.equal(out.count, 99);
  assert.equal(normalizeRoles([{ name: "a", count: -5 }])[0].count, 0);
  assert.equal(normalizeRoles([{ name: "a", count: "not a number" }])[0].count, 0);
});

// The prose takes the same formatting the post body does.
test("role prose keeps its formatting and loses its scripts", () => {
  const [out] = normalizeRoles([
    { name: "Recruiter", description: "<ul><li><strong>Greet</strong> newcomers</li></ul><script>alert(1)</script>" },
  ]);
  assert.equal(out.description, "<ul><li><strong>Greet</strong> newcomers</li></ul>");
});

// A role written before the fields took formatting is plain text.
test("plain text from an older role comes back as editor HTML", () => {
  const [out] = normalizeRoles([{ name: "Mentor", requirements: "MR 10+\nPatience" }]);
  assert.equal(plainTextFromHtml(out.requirements), "MR 10+\nPatience");
});

// Refused, not truncated: half a requirements list is worse than being asked
// to shorten it.
test("over-long prose is refused, and says which role", () => {
  const long = "d".repeat(ROLE_PLAIN_MAX + 50);
  const message = roleTextError(normalizeRoles([{ name: "Architect", description: long }]));
  assert.match(message, /Architect/);
  assert.match(message, /responsibilities/);
  assert.equal(roleTextError(normalizeRoles([{ name: "Architect", description: "short" }])), null);
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

// A label is what a clan calls someone, so the board does not get a say in the
// vocabulary - only in how long it is and that it is there at all.
test("a contact label keeps whatever the clan invented", () => {
  assert.equal(normalizeContactLabel("Warlord", "Leader"), "Warlord");
  assert.equal(normalizeContactLabel("  Recruitment   Officer  "), "Recruitment Officer");
});

test("an empty label falls back to what that side of the post is called", () => {
  assert.equal(normalizeContactLabel("", "Leader"), "Leader");
  assert.equal(normalizeContactLabel("   ", "Leader"), "Leader");
  assert.equal(normalizeContactLabel(null), "Recruiter");
  assert.equal(normalizeContactLabel(undefined), "Recruiter");
});

test("a label too long for a whisper row is cut, not refused", () => {
  const label = normalizeContactLabel("x".repeat(200), "Leader");
  assert.equal(label.length, CONTACT_LABEL_MAX);
});
