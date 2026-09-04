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

export function inviteBlocker(listing, invitee, owner) {
  if (!invitee) return "No account with that username.";
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
    .filter((clan) => recruiterEntry(clan, userId)?.status === "accepted")
    .map((clan) => ({ id: clan.id, name: clan.name, tag: clan.tag }));
}
