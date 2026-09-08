// Who a listing belongs to, and how that moves.
//
// The person who writes a post is not always the person it is about. A
// recruiter sets one up for their clan; someone builds the account on their
// leader's behalf; a leader steps down and hands the clan on. Until now the
// `ownerId` written at creation was permanent, so the only way out was to
// delete the post and rebuild it - losing its bumps, its views, and its URL.
//
// So ownership moves, under the same rule that governs recruiters: nobody is
// given a name on a public listing without agreeing first. An offer sits
// pending until the other side accepts. The difference is what is at stake -
// ownership carries delete rights and the whisper name - so the outgoing owner
// does not simply vanish: they stay on as an editor, which is everything they
// had except the ability to make the post disappear.

import { RECRUITER_MAX, normalizeRecruiters } from "./recruiters.js";

export function normalizeTransfer(listing) {
  const toUserId = String(listing?.transfer?.toUserId || "");
  if (!toUserId) return null;
  return { toUserId, invitedAt: listing.transfer.invitedAt || null };
}

// Same vocabulary as inviteBlocker: the person reading it has just typed a name
// into a box and needs to know why nothing happened.
export function transferBlocker(listing, invitee) {
  if (!invitee) return "No verified player with that Warframe name.";
  if (!invitee.forumVerified || !invitee.forumName) {
    return "That player has not verified a Warframe Forum profile yet, so they have no in-game name to whisper.";
  }
  if (invitee.id === listing?.ownerId) return "They already own this listing.";
  const pending = normalizeTransfer(listing);
  if (pending?.toUserId === invitee.id) {
    return "They already have a pending offer for this listing.";
  }
  if (pending) {
    return "This listing is already offered to someone. Cancel that offer first.";
  }
  return null;
}

export function offerTransfer(listing, inviteeId, now = new Date().toISOString()) {
  listing.transfer = { toUserId: String(inviteeId), invitedAt: now };
  return listing;
}

export function clearTransfer(listing) {
  listing.transfer = null;
  return listing;
}

// The hand-over itself. The new owner cannot also be a recruiter on their own
// post, so their roster entry goes; the old owner takes an editor seat, because
// the person who has been running the post is usually still the person keeping
// it current.
//
// A full roster is the one case where the seat cannot simply be added. The
// oldest pending invite gives way rather than an accepted recruiter: a pending
// invite is a name nobody has agreed to yet, and dropping it costs the listing
// nothing it currently has.
export function applyTransfer(listing, newOwnerId, now = new Date().toISOString()) {
  const previousOwnerId = listing.ownerId;
  let entries = normalizeRecruiters(listing.recruiters).filter(
    (item) => item.userId !== newOwnerId
  );
  if (previousOwnerId && previousOwnerId !== newOwnerId) {
    if (entries.length >= RECRUITER_MAX) {
      const pending = entries.filter((item) => item.status === "pending");
      const oldest = pending[pending.length - 1];
      if (oldest) entries = entries.filter((item) => item !== oldest);
    }
    if (entries.length < RECRUITER_MAX) {
      entries.push({
        userId: previousOwnerId,
        status: "accepted",
        role: "editor",
        // They were the owner, so what the post called them is what it keeps
        // calling them - unless it called them nothing, in which case the
        // default for a recruiter is right.
        label: listing.ownerLabel || undefined,
        invitedAt: now,
        respondedAt: now,
      });
    }
  }
  listing.ownerId = String(newOwnerId);
  listing.recruiters = normalizeRecruiters(entries);
  // The incoming owner writes their own label; carrying the last owner's over
  // would put a stranger's title on their name.
  listing.ownerLabel = null;
  clearTransfer(listing);
  // The clan keeps its allianceId, and falls out of the previous owner's
  // alliance roster edits (applyAllianceRoster only touches clans they own).
  // That is the point: it is not their clan any more.
  return listing;
}

// Offers waiting on this user, across every listing. The mirror of
// pendingInvitesFor in recruiters.js, and read by the account page.
export function transfersFor(db, userId) {
  return (db.clans || [])
    .filter((clan) => normalizeTransfer(clan)?.toUserId === userId)
    .map((clan) => ({ id: clan.id, name: clan.name, tag: clan.tag }));
}

// Whether this user has anything to answer on this listing. Used to keep the
// two invite kinds from being confused: someone can hold a recruiter invite and
// an ownership offer on the same post.
export function hasTransferFor(listing, userId) {
  return normalizeTransfer(listing)?.toUserId === userId;
}
