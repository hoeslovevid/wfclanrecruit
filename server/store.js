// The second storage lane.
//
// db.js loads every listing, user and session into memory and rewrites the
// changed rows on every mutation. That is the right shape for data that is
// bounded and changes rarely, and the wrong shape for messages: they grow
// forever and every send is a write, so mirroring them would put the whole
// history in memory and walk it on every bump and sign-in.
//
// So these tables are never loaded into `db`. They are queried directly, which
// is what makes the write cost of a message independent of how big the board
// gets. Everything here is addressed by id or by user, and never scanned.
//
// Two backends, one API. Postgres in production; a JSON file otherwise, kept
// deliberately separate from db.json so that even locally a message write never
// touches the listings file. The file backend is not a scaling story - it is
// what makes the feature testable and usable without a database.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { postgresEnabled, query } from "./pg.js";

let usingPostgres = false;
let filePath = "";
let cache = null;

export function storeReady() {
  return usingPostgres || Boolean(cache);
}

// Unread is "messages newer than the moment you last looked", which is a
// comparison on the timestamp - so two writes inside the same millisecond make
// one of them invisible. Node's clock has millisecond resolution and a
// conversation absolutely can produce two writes that fast, so the store issues
// its own strictly increasing stamps rather than trusting Date.now() to
// separate them. It also makes the ordering of a thread deterministic, which
// sorting on a tied timestamp is not.
let lastStamp = 0;

export function nextStamp() {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return new Date(lastStamp).toISOString();
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function emptyStore() {
  return { threads: [], members: [], messages: [], blocks: [] };
}

// The file backend serialises through one queue for the same reason writeDb
// does: two concurrent sends must not each read, mutate and write a stale copy.
let queue = Promise.resolve();

function flush() {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, filePath);
}

function write(mutate) {
  const run = async () => {
    const out = mutate(cache);
    flush();
    return out;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

export async function initStore(dataDir) {
  usingPostgres = postgresEnabled();
  if (usingPostgres) {
    await query(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        listing_name TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        last_message_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_members (
        thread_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        read_at TIMESTAMPTZ,
        -- When this side last cleared the conversation. Deleting a DM is
        -- one-sided: the other person keeps their copy, so nothing is removed -
        -- everything up to this moment simply stops being theirs to see. A
        -- later message brings the thread back with only what is new in it.
        cleared_at TIMESTAMPTZ,
        PRIMARY KEY (thread_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        -- Null once the sender deletes their account. The message stays so the
        -- other side's conversation does not develop holes; the name is gone.
        sender_id TEXT,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocks (
        user_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (user_id, blocked_id)
      );
      -- The inbox reads by member, the conversation reads by thread. Both are
      -- indexed so neither ever degrades into a scan.
      CREATE INDEX IF NOT EXISTS thread_members_user ON thread_members (user_id);
      CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_id, created_at);
      CREATE INDEX IF NOT EXISTS threads_last ON threads (last_message_at DESC);
    `);
    // CREATE TABLE IF NOT EXISTS is a no-op against a table that already
    // exists, so a column added after the first deploy needs saying twice.
    await query("ALTER TABLE thread_members ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ");
    return;
  }
  filePath = path.join(dataDir, "messages.json");
  if (!fs.existsSync(filePath)) {
    cache = emptyStore();
    flush();
    return;
  }
  try {
    cache = { ...emptyStore(), ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    cache = emptyStore();
  }
}

function rowToThread(row) {
  return {
    id: row.id,
    kind: row.kind,
    listingId: row.listing_id,
    listingName: row.listing_name || null,
    createdAt: iso(row.created_at),
    lastMessageAt: iso(row.last_message_at),
  };
}

function rowToMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id || null,
    body: row.body,
    createdAt: iso(row.created_at),
  };
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// --- Threads ---------------------------------------------------------------

export async function getThread(id) {
  if (usingPostgres) {
    const { rows } = await query("SELECT * FROM threads WHERE id = $1", [id]);
    return rows[0] ? rowToThread(rows[0]) : null;
  }
  return cache.threads.find((item) => item.id === id) || null;
}

export async function membersOf(threadId) {
  if (usingPostgres) {
    const { rows } = await query("SELECT * FROM thread_members WHERE thread_id = $1", [threadId]);
    return rows.map((row) => ({
      threadId: row.thread_id,
      userId: row.user_id,
      readAt: iso(row.read_at),
      clearedAt: iso(row.cleared_at),
    }));
  }
  return cache.members.filter((item) => item.threadId === threadId);
}

// Opening a conversation that already exists must return the existing one, not
// a second copy of it - hence the derived id and the upsert.
export async function openThread({ id, kind, listingId, listingName, userIds }) {
  const now = nextStamp();
  if (usingPostgres) {
    await query(
      `INSERT INTO threads (id, kind, listing_id, listing_name, created_at, last_message_at)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (id) DO UPDATE SET listing_name = EXCLUDED.listing_name`,
      [id, kind, listingId, listingName || null, now]
    );
    for (const userId of userIds) {
      await query(
        `INSERT INTO thread_members (thread_id, user_id, read_at) VALUES ($1,$2,NULL)
         ON CONFLICT (thread_id, user_id) DO NOTHING`,
        [id, userId]
      );
    }
    return getThread(id);
  }
  return write((db) => {
    let thread = db.threads.find((item) => item.id === id);
    if (!thread) {
      thread = { id, kind, listingId, listingName: listingName || null, createdAt: now, lastMessageAt: now };
      db.threads.push(thread);
    } else {
      thread.listingName = listingName || thread.listingName;
    }
    for (const userId of userIds) {
      if (!db.members.some((item) => item.threadId === id && item.userId === userId)) {
        db.members.push({ threadId: id, userId, readAt: null });
      }
    }
    return thread;
  });
}

// The inbox: every thread this person is in, newest activity first, with the
// last message and their own unread count already counted. One query rather
// than one per thread, because an inbox with thirty threads is not thirty
// round trips.
export async function inboxFor(userId, limit = 50) {
  if (usingPostgres) {
    const { rows } = await query(
      `SELECT t.*, m.read_at,
              last.body AS last_body, last.created_at AS last_created_at, last.sender_id AS last_sender_id,
              (SELECT count(*) FROM messages u
                WHERE u.thread_id = t.id
                  AND u.sender_id IS DISTINCT FROM $1
                  AND (m.read_at IS NULL OR u.created_at > m.read_at)
                  AND (m.cleared_at IS NULL OR u.created_at > m.cleared_at))::int AS unread
         FROM thread_members m
         JOIN threads t ON t.id = m.thread_id
         LEFT JOIN LATERAL (
            SELECT body, created_at, sender_id FROM messages
             WHERE thread_id = t.id
               AND (m.cleared_at IS NULL OR created_at > m.cleared_at)
             ORDER BY created_at DESC LIMIT 1
         ) last ON true
        WHERE m.user_id = $1
          AND (m.cleared_at IS NULL OR t.last_message_at > m.cleared_at)
        ORDER BY t.last_message_at DESC
        LIMIT $2`,
      [userId, limit]
    );
    return rows.map((row) => ({
      ...rowToThread(row),
      readAt: iso(row.read_at),
      unread: row.unread || 0,
      last: row.last_created_at
        ? { body: row.last_body, createdAt: iso(row.last_created_at), senderId: row.last_sender_id || null }
        : null,
    }));
  }
  const mine = cache.members.filter((item) => item.userId === userId);
  return mine
    .map((member) => {
      const thread = cache.threads.find((item) => item.id === member.threadId);
      if (!thread) return null;
      const cleared = member.clearedAt ? new Date(member.clearedAt).getTime() : 0;
      const messages = cache.messages
        .filter(
          (item) =>
            item.threadId === thread.id && new Date(item.createdAt).getTime() > cleared
        )
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      // Cleared and nothing said since: this side is not in the conversation
      // any more until someone writes again.
      if (cleared && !messages.length) return null;
      const since = member.readAt ? new Date(member.readAt).getTime() : 0;
      return {
        ...thread,
        readAt: member.readAt,
        unread: messages.filter(
          (item) => item.senderId !== userId && new Date(item.createdAt).getTime() > since
        ).length,
        last: messages.length ? messages[messages.length - 1] : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    .slice(0, limit);
}

export async function unreadTotal(userId) {
  if (usingPostgres) {
    const { rows } = await query(
      `SELECT count(*)::int AS total
         FROM messages msg
         JOIN thread_members m ON m.thread_id = msg.thread_id AND m.user_id = $1
        WHERE msg.sender_id IS DISTINCT FROM $1
          AND (m.read_at IS NULL OR msg.created_at > m.read_at)
          AND (m.cleared_at IS NULL OR msg.created_at > m.cleared_at)`,
      [userId]
    );
    return rows[0]?.total || 0;
  }
  const inbox = await inboxFor(userId, 1000);
  return inbox.reduce((total, thread) => total + thread.unread, 0);
}

// --- Messages --------------------------------------------------------------

// `since` is the caller's own cleared_at: a conversation they deleted comes back
// holding only what arrived after they deleted it, never the history they let
// go of.
export async function messagesIn(threadId, { limit = 200, since = null } = {}) {
  if (usingPostgres) {
    const { rows } = await query(
      `SELECT * FROM messages
        WHERE thread_id = $1 AND ($3::timestamptz IS NULL OR created_at > $3)
        ORDER BY created_at ASC LIMIT $2`,
      [threadId, limit, since]
    );
    return rows.map(rowToMessage);
  }
  const after = since ? new Date(since).getTime() : 0;
  return cache.messages
    .filter((item) => item.threadId === threadId && new Date(item.createdAt).getTime() > after)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
}

export async function addMessage({ threadId, senderId, body }) {
  const message = {
    id: newId("msg"),
    threadId,
    senderId,
    body,
    createdAt: nextStamp(),
  };
  if (usingPostgres) {
    await query(
      "INSERT INTO messages (id, thread_id, sender_id, body, created_at) VALUES ($1,$2,$3,$4,$5)",
      [message.id, threadId, senderId, body, message.createdAt]
    );
    await query("UPDATE threads SET last_message_at = $2 WHERE id = $1", [threadId, message.createdAt]);
    // Sending is also reading: your own message must not come back as unread.
    await query("UPDATE thread_members SET read_at = $3 WHERE thread_id = $1 AND user_id = $2", [
      threadId,
      senderId,
      message.createdAt,
    ]);
    return message;
  }
  return write((db) => {
    db.messages.push(message);
    const thread = db.threads.find((item) => item.id === threadId);
    if (thread) thread.lastMessageAt = message.createdAt;
    const member = db.members.find((item) => item.threadId === threadId && item.userId === senderId);
    if (member) member.readAt = message.createdAt;
    return message;
  });
}

// Deleting a DM, from one side. Nothing is removed: the row that says where
// this person's view of the conversation starts simply moves to now. The other
// side is untouched, which is the point - someone cannot delete a conversation
// out from under the person who may need to report it.
export async function clearThread(threadId, userId) {
  const now = nextStamp();
  if (usingPostgres) {
    await query(
      "UPDATE thread_members SET cleared_at = $3, read_at = $3 WHERE thread_id = $1 AND user_id = $2",
      [threadId, userId, now]
    );
    return now;
  }
  return write((db) => {
    const member = db.members.find((item) => item.threadId === threadId && item.userId === userId);
    if (member) {
      member.clearedAt = now;
      member.readAt = now;
    }
    return now;
  });
}

export async function markRead(threadId, userId) {
  const now = nextStamp();
  if (usingPostgres) {
    await query("UPDATE thread_members SET read_at = $3 WHERE thread_id = $1 AND user_id = $2", [
      threadId,
      userId,
      now,
    ]);
    return now;
  }
  return write((db) => {
    const member = db.members.find((item) => item.threadId === threadId && item.userId === userId);
    if (member) member.readAt = now;
    return now;
  });
}

// --- Blocks ----------------------------------------------------------------

export async function blocksFor(userId) {
  if (usingPostgres) {
    const { rows } = await query(
      "SELECT * FROM blocks WHERE user_id = $1 OR blocked_id = $1",
      [userId]
    );
    return rows.map((row) => ({ userId: row.user_id, blockedId: row.blocked_id, createdAt: iso(row.created_at) }));
  }
  return cache.blocks.filter((item) => item.userId === userId || item.blockedId === userId);
}

export async function setBlock(userId, blockedId, on) {
  if (usingPostgres) {
    if (on) {
      await query(
        `INSERT INTO blocks (user_id, blocked_id, created_at) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, blocked_id) DO NOTHING`,
        [userId, blockedId, new Date().toISOString()]
      );
    } else {
      await query("DELETE FROM blocks WHERE user_id = $1 AND blocked_id = $2", [userId, blockedId]);
    }
    return on;
  }
  return write((db) => {
    const at = db.blocks.findIndex((item) => item.userId === userId && item.blockedId === blockedId);
    if (on && at < 0) db.blocks.push({ userId, blockedId, createdAt: new Date().toISOString() });
    if (!on && at >= 0) db.blocks.splice(at, 1);
    return on;
  });
}

// --- Account deletion ------------------------------------------------------

// Deleting an account must not punch holes in someone else's conversation, so
// the messages stay and only the authorship goes. This mirrors what db.js
// already does to reports, where reporterId is nulled rather than the report
// removed. The membership row does go: a deleted account has no inbox.
export async function dropUser(userId) {
  if (usingPostgres) {
    await query("UPDATE messages SET sender_id = NULL WHERE sender_id = $1", [userId]);
    await query("DELETE FROM thread_members WHERE user_id = $1", [userId]);
    await query("DELETE FROM blocks WHERE user_id = $1 OR blocked_id = $1", [userId]);
    return;
  }
  await write((db) => {
    for (const message of db.messages) {
      if (message.senderId === userId) message.senderId = null;
    }
    db.members = db.members.filter((item) => item.userId !== userId);
    db.blocks = db.blocks.filter((item) => item.userId !== userId && item.blockedId !== userId);
  });
}

// Removing a listing removes the conversations about it, which is the one place
// messages are deleted outright: the subject is gone, so the thread has no
// context left to sit in.
export async function dropListing(listingId) {
  if (usingPostgres) {
    await query(
      `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE listing_id = $1)`,
      [listingId]
    );
    await query(
      `DELETE FROM thread_members WHERE thread_id IN (SELECT id FROM threads WHERE listing_id = $1)`,
      [listingId]
    );
    await query("DELETE FROM threads WHERE listing_id = $1", [listingId]);
    return;
  }
  await write((db) => {
    const gone = new Set(db.threads.filter((item) => item.listingId === listingId).map((item) => item.id));
    db.threads = db.threads.filter((item) => !gone.has(item.id));
    db.members = db.members.filter((item) => !gone.has(item.threadId));
    db.messages = db.messages.filter((item) => !gone.has(item.threadId));
  });
}
