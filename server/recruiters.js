// A listing has one owner and, optionally, a few recruiters: other verified
// players who agreed to be a point of contact on it.
//
// Two rules shape everything here. A recruiter's name appears on a public
// listing and receives whispers from strangers, so nobody is added without
// accepting first - an invite sits pending until they say yes. And recruiters
// are contacts, nothing more: they cannot edit, bump, pause or delete, so the
// worst a hostile one can do is stop answering.

export const RECRUITER_MAX = 5;
export const RECRUITER_STATES = ["pending", "accepted"];

// What a recruiter is allowed to do. "recruiter" is the original deal - a name
// on the post that answers whispers. "editor" also works on the post itself:
// text, images, tags, bump and pause. Neither can delete the listing or decide
// who else is on it, so the owner stays the only route to access and the only
// person who can make the post disappear.
export const RECRUITER_ROLES = ["recruiter", "editor"];

export function normalizeRecruiterRole(role) {
  return RECRUITER_ROLES.includes(role) ? role : "recruiter";
}

export function normalizeRecruiters(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const userId = String(entry?.userId || "");
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push({
      userId,
      status: RECRUITER_STATES.includes(entry?.status) ? entry.status : "pending",
      role: normalizeRecruiterRole(entry?.role),
      invitedAt: entry?.invitedAt || null,
      respondedAt: entry?.respondedAt || null,
    });
    if (out.length >= RECRUITER_MAX) break;
  }
  return out;
}

export function recruiterEntry(listing, userId) {
  return normalizeRecruiters(listing?.recruiters).find((item) => item.userId === userId) || null;
}

export function acceptedRecruiterIds(listing) {
  return normalizeRecruiters(listing?.recruiters)
    .filter((item) => item.status === "accepted")
    .map((item) => item.userId);
}

// Everyone a recruit could whisper on this listing: the owner first, then the
// recruiters who accepted. Only people with a verified forum name appear -
// without one there is no in-game name to whisper.
export function listingContacts(listing, users, presenceOf, now = Date.now()) {
  const byId = new Map((users || []).map((user) => [user.id, user]));
  const ids = [listing.ownerId, ...acceptedRecruiterIds(listing)];
  const out = [];
  for (const id of ids) {
    const user = byId.get(id);
    if (!user?.forumVerified || !user.forumName) continue;
    const { status, online } = presenceOf(user, now);
    out.push({
      name: user.forumName,
      owner: id === listing.ownerId,
      online,
      presenceStatus: online ? status : "offline",
    });
  }
  return out;
}

// The listing is online if anyone who can answer is. In game outranks online,
// so a card shows the most useful thing available.
export function bestPresence(contacts) {
  if (contacts.some((item) => item.online && item.presenceStatus === "ingame")) {
    return { online: true, presenceStatus: "ingame" };
  }
  if (contacts.some((item) => item.online)) {
    return { online: true, presenceStatus: "online" };
  }
  return { online: false, presenceStatus: "offline" };
}

// The invite matches the verified Warframe name, which is the name the listing
// shows and the name a recruit whispers. It used to match the account username
// instead, so an owner looking at "--Gunson--" on the post had to work out that
// the Discord handle behind it was "Gunson".
export function findInvitee(users, name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  return (
    (users || []).find(
      (user) => user.forumVerified && String(user.forumName || "").toLowerCase() === wanted
    ) || null
  );
}

// Suggestions for the invite box. Only verified players can be recruiters, so
// only they are offered - and never the owner or anyone already on this
// listing, since inviting them is the one thing that cannot work.
export const RECRUITER_SEARCH_MIN = 2;
export const RECRUITER_SEARCH_MAX = 8;

export function searchRecruiterCandidates(users, listing, query, limit = RECRUITER_SEARCH_MAX) {
  const wanted = String(query || "").trim().toLowerCase();
  if (wanted.length < RECRUITER_SEARCH_MIN) return [];
  const taken = new Set([listing?.ownerId, ...normalizeRecruiters(listing?.recruiters).map((item) => item.userId)]);
  const matches = [];
  for (const user of users || []) {
    if (!user?.forumVerified || !user.forumName || taken.has(user.id)) continue;
    const name = String(user.forumName);
    const at = name.toLowerCase().indexOf(wanted);
    if (at < 0) continue;
    matches.push({ name, at });
  }
  // A name that starts with what was typed is the one being looked for; the
  // rest are offered underneath, alphabetically, so the list is stable.
  matches.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  return matches.slice(0, limit).map((item) => item.name);
}

// Editing is the one power that is delegated, and only to someone who took the
// invite: a pending editor can do nothing until they accept. The owner and the
// operator are in here too, so every caller can ask one question.
export function canEditListing(user, listing) {
  if (!user) return false;
  if (user.admin || listing?.ownerId === user.id) return true;
  const entry = recruiterEntry(listing, user.id);
  return Boolean(entry && entry.status === "accepted" && entry.role === "editor");
}

export function inviteBlocker(listing, invitee, owner) {
  if (!invitee) return "No verified player with that Warframe name.";
  if (invitee.id === owner.id) return "You are already the owner of this listing.";
  if (!invitee.forumVerified || !invitee.forumName) {
    return "That player has not verified a Warframe Forum profile yet, so they have no in-game name to whisper.";
  }
  const existing = recruiterEntry(listing, invitee.id);
  if (existing?.status === "accepted") return "They are already a recruiter on this listing.";
  if (existing) return "They already have a pending invite for this listing.";
  if (normalizeRecruiters(listing.recruiters).length >= RECRUITER_MAX) {
    return `A listing can have at most ${RECRUITER_MAX} recruiters.`;
  }
  return null;
}

// Pending invites waiting on this user, across every listing.
export function pendingInvitesFor(db, userId) {
  return (db.clans || [])
    .filter((clan) => recruiterEntry(clan, userId)?.status === "pending")
    .map((clan) => ({ id: clan.id, name: clan.name, tag: clan.tag }));
}

// Listings this user already answers for, so they can walk away from one.
export function recruitingOn(db, userId) {
  return (db.clans || [])
    .map((clan) => ({ clan, entry: recruiterEntry(clan, userId) }))
    .filter(({ entry }) => entry?.status === "accepted")
    .map(({ clan, entry }) => ({ id: clan.id, name: clan.name, tag: clan.tag, role: entry.role }));
}
