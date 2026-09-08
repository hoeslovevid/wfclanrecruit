// A clan recruits for jobs as well as for bodies. A listing can say it wants an
// event organiser or a dojo architect specifically, with its own description,
// its own requirements, and its own answer to "are you taking applications".
//
// Roles are free text with a suggested list rather than a fixed vocabulary:
// clans invent jobs the board has never heard of, and a role nobody can name
// is worse than an untidy list.

import { ROLE_PLAIN_MAX, normalizeRoleText, plainTextFromHtml, roleTextTooLong } from "./richtext.js";

export const ROLE_MAX = 8;
export const ROLE_NAME_MAX = 40;
export { ROLE_PLAIN_MAX };
export const ROLE_COUNT_MAX = 99;

// Offered in the picker; anything typed is kept as written.
export const ROLE_SUGGESTIONS = [
  "Recruiter",
  "Moderator",
  "Event Organizer",
  "Architect",
  "Content Creator",
  "Mentor",
  "Squad Lead",
  "Trader",
  "Translator",
  "Developer",
  "Artist",
];

// What a contact on a listing is called where recruits whisper them. A clan
// invents its own hierarchy - warlord, co-leader, recruitment officer - so this
// is free text with suggestions for the same reason a role is: a rank nobody
// can name is worse than an untidy list.
//
// It is a title and nothing else. What someone can actually do is `role` in
// recruiters.js, and the two must never be read as one thing: a contact
// labelled "Co-Leader" with role "recruiter" still cannot touch the post.
export const CONTACT_LABEL_MAX = 24;

// Long enough for "Recruitment Officer", short enough that a whisper row stays
// on one line.
export const CONTACT_LABEL_SUGGESTIONS = [
  "Leader",
  "Warlord",
  "Co-Leader",
  "Officer",
  "Recruiter",
  "Recruitment Officer",
  "Moderator",
  "Veteran",
];

// The fallbacks are what every listing written before this said, so an
// untouched post reads exactly as it did.
export const OWNER_LABEL_DEFAULT = "Leader";
export const RECRUITER_LABEL_DEFAULT = "Recruiter";

export function normalizeContactLabel(value, fallback = RECRUITER_LABEL_DEFAULT) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONTACT_LABEL_MAX)
    .trim();
  return text || fallback;
}

// Per role, not per listing: a clan can be full of members and still short an
// architect. Closed is kept rather than deleted so a listing can show the shape
// of its team without pretending every seat is open.
export const ROLE_STATUSES = ["Open", "Selective", "Closed"];

export function normalizeRoleStatus(value) {
  const raw = String(value ?? "").trim();
  const match = ROLE_STATUSES.find((status) => status.toLowerCase() === raw.toLowerCase());
  return match || "Open";
}

// Two roles with the same name are one role, so the first wins.
export function roleKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

export function normalizeRoles(list) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(list) ? list : []) {
    if (out.length >= ROLE_MAX) break;
    const name = String(row?.name ?? "").trim().slice(0, ROLE_NAME_MAX);
    if (!name) continue;
    const key = roleKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const count = Math.max(0, Math.min(ROLE_COUNT_MAX, Math.round(Number(row?.count) || 0)));
    out.push({
      name,
      status: normalizeRoleStatus(row?.status),
      count,
      // Formatted now, and sanitised the same way the post body is. Plain text
      // from a role written before this comes back through as editor HTML.
      description: normalizeRoleText(row?.description),
      requirements: normalizeRoleText(row?.requirements),
    });
  }
  return out;
}

// Refused rather than silently truncated: half a requirements list is worse
// than being told to shorten it. Named, so the leader knows which role.
export function roleTextError(roles) {
  for (const role of roles) {
    for (const [field, label] of [["description", "responsibilities"], ["requirements", "requirements"]]) {
      if (roleTextTooLong(role[field])) {
        return `The ${label} for "${role.name}" are too long.`;
      }
    }
  }
  return null;
}

// A role whose prose is only empty markup has no prose.
export function roleTextIsEmpty(html) {
  return !plainTextFromHtml(html).trim();
}

// "Recruiting for this" means the seat is takeable. Selective still takes
// applications - it just says the clan chooses - so only Closed drops out.
export function isRoleOpen(role) {
  return normalizeRoleStatus(role?.status) !== "Closed";
}

export function openRoles(item) {
  return normalizeRoles(item?.roles).filter(isRoleOpen);
}

export function rolesOf(item) {
  return normalizeRoles(item?.roles);
}

// What the browse filter matches against, and what a card counts.
export function openRoleNames(item) {
  return openRoles(item).map((role) => role.name);
}

export function hasOpenRole(item, name) {
  const wanted = roleKey(name);
  return openRoles(item).some((role) => roleKey(role.name) === wanted);
}

// The filter lists the roles clans are actually recruiting for, so it never
// offers a name that would return nothing. Suggestions the board is using come
// first; a clan's invented role appears once someone is recruiting for it.
export function roleFilterOptions(items = []) {
  const counts = new Map();
  for (const item of items) {
    for (const name of openRoleNames(item)) {
      const key = roleKey(name);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { name, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
}
