import { plainTextFromHtml, sanitizePostHtml, toEditorHtml } from "../src/richtext.js";

// The rules of a conversation, kept away from both storage and HTTP so they can
// be tested on their own. Nothing in here touches the database.

// Long enough for a real introduction, short enough that the inbox stays a list
// of messages rather than a list of essays. The cap is on readable text;
// formatting tags are extra and have their own ceiling.
export const BODY_MAX = 2000;
export const BODY_HTML_MAX = 4000;

// A thread is always *about* something - a listing or a profile - so a recruit
// opening their inbox can tell which of five clans a stranger is writing about.
// A message with no subject is a message with no context.
export const THREAD_KINDS = ["clan", "alliance", "player"];

export function normalizeBody(value) {
  const html = sanitizePostHtml(toEditorHtml(value)).replace(
    /<span\b[^>]*\bdata-video\b[^>]*>[\s\S]*?<\/span>/gi,
    ""
  );
  if (!plainTextFromHtml(html)) return "";
  const next = html.length > BODY_HTML_MAX ? html.slice(0, BODY_HTML_MAX) : html;
  // A message typed without formatting used to be stored trimmed. Keep that so
  // an old "  hi  " and a new one land on the same row.
  return /<[a-z][\s\S]*>/i.test(next) ? next : next.trim();
}

export function bodyError(value) {
  const html = normalizeBody(value);
  const plain = plainTextFromHtml(html);
  if (!plain) return "Write a message first.";
  if (plain.length > BODY_MAX) return `Messages are up to ${BODY_MAX} characters.`;
  return null;
}

// Two people, always the same two, in a stable order. The id is derived rather
// than random so opening a conversation twice from two different pages lands in
// the same thread instead of forking it - and so "do these two already have a
// thread about this listing?" is a primary-key lookup, not a scan.
export function threadId(kind, listingId, a, b) {
  const pair = [String(a), String(b)].sort();
  return `${kind}:${listingId}:${pair[0]}:${pair[1]}`;
}

// The inverse of threadId. A thread is not written until someone actually says
// something, so the first send arrives quoting an id for a row that does not
// exist yet - and the id is the only description of it we have. Reading it back
// is safe because every part of it is checked again against the listing before
// anything is written: this says what to look up, never what to trust.
//
// User ids never contain a colon (they are minted by newId), so the first two
// segments split cleanly and the rest is the pair.
export function parseThreadId(id) {
  const parts = String(id || "").split(":");
  if (parts.length !== 4) return null;
  const [kind, listingId, a, b] = parts;
  if (!THREAD_KINDS.includes(kind) || !listingId || !a || !b || a === b) return null;
  return { kind, listingId, userIds: [a, b] };
}

// You cannot message yourself, and you cannot open a thread about a listing
// with someone who has nothing to do with it. The caller supplies the owner;
// this only decides whether the pairing makes sense.
export function openError({ senderId, ownerId, listingId }) {
  if (!listingId) return "That listing is gone.";
  if (!ownerId) return "That listing has no owner to write to.";
  if (senderId === ownerId) return "That is your own listing.";
  return null;
}

// Unread is per person, not per thread: the same thread is read for one side
// and unread for the other. A message you sent yourself never counts.
export function unreadIn(messages, { userId, readAt }) {
  const since = readAt ? new Date(readAt).getTime() : 0;
  return (messages || []).filter(
    (item) => item.senderId !== userId && new Date(item.createdAt).getTime() > since
  ).length;
}

// What the inbox row shows before you open it.
export function previewOf(body, max = 90) {
  const line = plainTextFromHtml(
    String(body || "").replace(/<img\b[^>]*\bdata-emoji\b[^>]*>/gi, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// A blocked pair is blocked in both directions. Blocking someone to stop them
// writing to you, and then being able to write to them, is not a block - it is
// a mute with a loophole.
export function blockedBetween(blocks, a, b) {
  return (blocks || []).some(
    (row) =>
      (row.userId === a && row.blockedId === b) || (row.userId === b && row.blockedId === a)
  );
}
