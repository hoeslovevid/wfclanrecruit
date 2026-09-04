import pg from "pg";

let pool = null;

const LISTING_COMPUTED = new Set([
  "stale",
  "recruiting",
  "canBump",
  "bumpReadyAt",
  "allianceName",
  "allianceTag",
  "memberClans",
]);

const USER_COLUMNS = new Set([
  "id",
  "username",
  "password",
  "admin",
  "createdAt",
  "discordId",
  "discordUsername",
  "discordEmail",
  "forumVerified",
  "forumName",
  "forumProfileUrl",
  "forumToken",
  "forumVerifiedAt",
  "forumCheckedAt",
]);

const LISTING_COLUMNS = new Set([
  "id",
  "ownerId",
  "name",
  "tag",
  "language",
  "platform",
  "platforms",
  "region",
  "status",
  "discord",
  "paused",
  "inviteOk",
  "inviteCheckedAt",
  "featured",
  "allianceId",
  "createdAt",
  "bumpedAt",
]);

export function postgresEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function extraData(item, columns) {
  const data = {};
  for (const [key, value] of Object.entries(item || {})) {
    if (columns.has(key) || LISTING_COMPUTED.has(key)) continue;
    data[key] = value;
  }
  return data;
}

function rowToUser(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    username: row.username,
    password: row.password,
    admin: Boolean(row.admin),
    createdAt: iso(row.created_at),
    discordId: row.discord_id || null,
    discordUsername: row.discord_username || null,
    discordEmail: row.discord_email || null,
    forumVerified: Boolean(row.forum_verified),
    forumName: row.forum_name || null,
    forumProfileUrl: row.forum_profile_url || null,
    forumToken: row.forum_token || null,
    forumVerifiedAt: iso(row.forum_verified_at),
    forumCheckedAt: iso(row.forum_checked_at),
  };
}

function rowToListing(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    tag: row.tag,
    language: row.language || null,
    platform: row.platform || null,
    platforms: row.platforms || undefined,
    region: row.region || null,
    status: row.status || null,
    discord: row.discord || null,
    paused: Boolean(row.paused),
    inviteOk: row.invite_ok !== false,
    inviteCheckedAt: iso(row.invite_checked_at),
    featured: Boolean(row.featured),
    allianceId: row.alliance_id || null,
    createdAt: iso(row.created_at),
    bumpedAt: iso(row.bumped_at),
  };
}

function rowToReport(row) {
  return {
    id: row.id,
    kind: row.kind,
    listingId: row.listing_id,
    listingName: row.listing_name,
    reason: row.reason,
    details: row.details || "",
    reporterId: row.reporter_id || null,
    createdAt: iso(row.created_at),
    status: row.status,
    resolvedAt: iso(row.resolved_at),
  };
}

export async function connectPg() {
  if (pool) return pool;
  const ssl =
    process.env.DATABASE_SSL === "0"
      ? false
      : process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false };
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: 5,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password TEXT,
      admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ,
      discord_id TEXT,
      discord_username TEXT,
      discord_email TEXT,
      forum_verified BOOLEAN NOT NULL DEFAULT FALSE,
      forum_name TEXT,
      forum_profile_url TEXT,
      forum_token TEXT,
      forum_verified_at TIMESTAMPTZ,
      forum_checked_at TIMESTAMPTZ,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clans (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      name TEXT NOT NULL,
      tag TEXT NOT NULL,
      language TEXT,
      platform TEXT,
      region TEXT,
      status TEXT,
      discord TEXT,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      invite_ok BOOLEAN NOT NULL DEFAULT TRUE,
      invite_checked_at TIMESTAMPTZ,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      alliance_id TEXT,
      created_at TIMESTAMPTZ,
      bumped_at TIMESTAMPTZ,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS alliances (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      name TEXT NOT NULL,
      tag TEXT NOT NULL,
      language TEXT,
      platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
      region TEXT,
      status TEXT,
      discord TEXT,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      invite_ok BOOLEAN NOT NULL DEFAULT TRUE,
      invite_checked_at TIMESTAMPTZ,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ,
      bumped_at TIMESTAMPTZ,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      listing_id TEXT,
      listing_name TEXT,
      reason TEXT,
      details TEXT,
      reporter_id TEXT,
      created_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
    CREATE INDEX IF NOT EXISTS users_discord_id ON users (discord_id);
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);
    CREATE INDEX IF NOT EXISTS clans_name_lower ON clans (lower(name));
    CREATE INDEX IF NOT EXISTS clans_tag ON clans (tag);
    CREATE INDEX IF NOT EXISTS clans_owner ON clans (owner_id);
    CREATE INDEX IF NOT EXISTS clans_language ON clans (language);
    CREATE INDEX IF NOT EXISTS clans_alliance ON clans (alliance_id);
    CREATE INDEX IF NOT EXISTS alliances_name_lower ON alliances (lower(name));
    CREATE INDEX IF NOT EXISTS alliances_tag ON alliances (tag);
    CREATE INDEX IF NOT EXISTS reports_status ON reports (status);
  `);
  await migrateFromAppState();
  await hardenDiscordIdentity();
  return pool;
}

// One account per Discord identity is enforced in the OAuth callback, but only
// in application code. Promote it to a database guarantee - with a partial
// index, since local accounts carry a NULL discord_id. If existing rows already
// violate it the index cannot be built; log the offenders and carry on rather
// than failing the healthcheck and rolling back the deploy.
async function hardenDiscordIdentity() {
  const { rows } = await pool.query(`
    SELECT discord_id, COUNT(*)::int AS accounts, ARRAY_AGG(id ORDER BY created_at) AS ids
    FROM users
    WHERE discord_id IS NOT NULL
    GROUP BY discord_id
    HAVING COUNT(*) > 1
  `);
  if (rows.length) {
    console.warn(
      `users.discord_id left non-unique: ${rows.length} Discord id(s) map to more than one account. ` +
        "Merge them, then redeploy to add the constraint."
    );
    for (const row of rows) {
      console.warn(`  discord_id ${row.discord_id} -> ${row.accounts} accounts: ${row.ids.join(", ")}`);
    }
    return;
  }
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_unique ON users (discord_id) WHERE discord_id IS NOT NULL"
  );
}

async function migrateFromAppState() {
  const exists = await pool.query("SELECT to_regclass('public.app_state') AS name");
  if (!exists.rows[0]?.name) return;
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM sessions) AS sessions,
      (SELECT COUNT(*)::int FROM clans) AS clans,
      (SELECT COUNT(*)::int FROM alliances) AS alliances,
      (SELECT COUNT(*)::int FROM reports) AS reports
  `);
  const n = counts.rows[0];
  if (n.users || n.sessions || n.clans || n.alliances || n.reports) return;
  const { rows } = await pool.query("SELECT users, sessions, clans, alliances, reports FROM app_state WHERE id = 1");
  if (!rows[0]) return;
  const blob = {
    users: rows[0].users || [],
    sessions: rows[0].sessions || [],
    clans: rows[0].clans || [],
    alliances: rows[0].alliances || [],
    reports: rows[0].reports || [],
  };
  if (!blob.users.length && !blob.clans.length && !blob.alliances.length && !blob.reports.length) return;
  await saveState(blob);
  console.log("Migrated app_state JSON into Postgres tables.");
}

export async function loadState() {
  // Whatever we thought we had written no longer describes this process's view.
  digests = null;
  const [users, sessions, clans, alliances, reports] = await Promise.all([
    pool.query("SELECT * FROM users"),
    pool.query("SELECT token, user_id, expires FROM sessions"),
    pool.query("SELECT * FROM clans"),
    pool.query("SELECT * FROM alliances"),
    pool.query("SELECT * FROM reports ORDER BY created_at DESC"),
  ]);
  if (
    !users.rows.length &&
    !sessions.rows.length &&
    !clans.rows.length &&
    !alliances.rows.length &&
    !reports.rows.length
  ) {
    return null;
  }
  return {
    users: users.rows.map(rowToUser),
    sessions: sessions.rows.map((row) => ({
      token: row.token,
      userId: row.user_id,
      expires: Number(row.expires),
    })),
    clans: clans.rows.map((row) => {
      const item = rowToListing(row);
      delete item.platforms;
      return item;
    }),
    alliances: alliances.rows.map(rowToListing),
    reports: reports.rows.map(rowToReport),
  };
}

function uniqueBy(list, key) {
  const seen = new Map();
  for (const item of list || []) {
    if (!item || item[key] == null || item[key] === "") continue;
    seen.set(String(item[key]), item);
  }
  return [...seen.values()];
}

function uniqueByLower(list, key) {
  const seen = new Map();
  for (const item of list || []) {
    const value = item?.[key];
    if (value == null || value === "") continue;
    seen.set(String(value).toLowerCase(), item);
  }
  return [...seen.values()];
}

// Writing every row on every save was the biggest scaling problem in here: a
// bump, a sign-in or a status change rewrote every user, session, listing and
// report inside one transaction, behind a global lock. Keep a digest of what
// was last written and send only the rows that actually changed.
//
// `digests` is the committed snapshot and is only adopted after COMMIT, so a
// failed save cannot leave us believing we wrote something we did not. It
// starts null - after a load, or after any error - and a null snapshot means
// the next save writes everything, which is the old behaviour and always safe.
let digests = null;
let pending = null;

function emptySnapshot() {
  return {
    users: new Map(),
    sessions: new Map(),
    clans: new Map(),
    alliances: new Map(),
    reports: new Map(),
  };
}

async function upsert(client, table, id, sql, params) {
  const digest = JSON.stringify(params);
  pending[table].set(id, digest);
  if (digests && digests[table].get(id) === digest) return false;
  await client.query(sql, params);
  return true;
}

// Deleting rows that are gone from memory. Once a snapshot exists this is
// exact: the ids we wrote last time, minus the ids we have now.
async function reconcile(client, table, column, ids) {
  if (digests) {
    const gone = [...digests[table].keys()].filter((id) => !pending[table].has(id));
    assertSaneDelete(table, gone.length);
    if (gone.length) {
      await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::text[])`, [gone]);
    }
    return;
  }
  await deleteMissing(client, table, column, ids);
}

// An empty id list used to mean "delete the whole table", so a cache that came
// back empty for any reason took the data with it. Emptying a table is still
// legitimate - deleting your last listing, or an account that owned them all -
// but only ever a handful of rows at a time, because every mutation saves
// immediately. A large unexplained wipe is a bug, so fail loudly instead:
// writeDb catches this and resyncs the cache from Postgres.
const WIPE_LIMIT = 25;
const PROTECTED = new Set(["users", "clans", "alliances"]);

// Sessions and reports churn on their own - sessions expire in batches - so
// only the irreplaceable tables are guarded.
export function assertSaneDelete(table, count) {
  if (!PROTECTED.has(table) || count <= WIPE_LIMIT) return;
  throw new Error(
    `Refusing to delete ${count} rows from ${table} in one save: the in-memory state lost them.`
  );
}

async function deleteMissing(client, table, column, ids) {
  if (!ids.length) {
    if (PROTECTED.has(table)) {
      const { rows } = await client.query(`SELECT count(*)::int AS total FROM ${table}`);
      assertSaneDelete(table, rows[0]?.total || 0);
    }
    await client.query(`DELETE FROM ${table}`);
    return;
  }
  await client.query(`DELETE FROM ${table} WHERE NOT (${column} = ANY($1::text[]))`, [ids]);
}

let saveLock = Promise.resolve();

async function persistTables(db) {
  const users = uniqueByLower(uniqueBy(db.users, "id"), "username");
  const sessions = uniqueBy(db.sessions, "token");
  const clans = uniqueBy(db.clans, "id");
  const alliances = uniqueBy(db.alliances, "id");
  const reports = uniqueBy(db.reports, "id");
  const client = await pool.connect();
  pending = emptySnapshot();
  try {
    await client.query("BEGIN");

    for (const user of users) {
      await upsert(client, "users", user.id,
        `INSERT INTO users (
          id, username, password, admin, created_at, discord_id, discord_username, discord_email,
          forum_verified, forum_name, forum_profile_url, forum_token, forum_verified_at, forum_checked_at, data
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          password = EXCLUDED.password,
          admin = EXCLUDED.admin,
          created_at = EXCLUDED.created_at,
          discord_id = EXCLUDED.discord_id,
          discord_username = EXCLUDED.discord_username,
          discord_email = EXCLUDED.discord_email,
          forum_verified = EXCLUDED.forum_verified,
          forum_name = EXCLUDED.forum_name,
          forum_profile_url = EXCLUDED.forum_profile_url,
          forum_token = EXCLUDED.forum_token,
          forum_verified_at = EXCLUDED.forum_verified_at,
          forum_checked_at = EXCLUDED.forum_checked_at,
          data = EXCLUDED.data`,
        [
          user.id,
          user.username,
          user.password || null,
          Boolean(user.admin),
          user.createdAt || null,
          user.discordId || null,
          user.discordUsername || null,
          user.discordEmail || null,
          Boolean(user.forumVerified),
          user.forumName || null,
          user.forumProfileUrl || null,
          user.forumToken || null,
          user.forumVerifiedAt || null,
          user.forumCheckedAt || null,
          JSON.stringify(extraData(user, USER_COLUMNS)),
        ]
      );
    }
    await reconcile(client, "users", "id", users.map((item) => item.id));

    for (const session of sessions) {
      await upsert(client, "sessions", session.token,
        `INSERT INTO sessions (token, user_id, expires) VALUES ($1,$2,$3)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, expires = EXCLUDED.expires`,
        [session.token, session.userId, Number(session.expires) || 0]
      );
    }
    await reconcile(
      client,
      "sessions",
      "token",
      sessions.map((item) => item.token)
    );

    for (const clan of clans) {
      await upsert(client, "clans", clan.id,
        `INSERT INTO clans (
          id, owner_id, name, tag, language, platform, region, status, discord, paused,
          invite_ok, invite_checked_at, featured, alliance_id, created_at, bumped_at, data
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          name = EXCLUDED.name,
          tag = EXCLUDED.tag,
          language = EXCLUDED.language,
          platform = EXCLUDED.platform,
          region = EXCLUDED.region,
          status = EXCLUDED.status,
          discord = EXCLUDED.discord,
          paused = EXCLUDED.paused,
          invite_ok = EXCLUDED.invite_ok,
          invite_checked_at = EXCLUDED.invite_checked_at,
          featured = EXCLUDED.featured,
          alliance_id = EXCLUDED.alliance_id,
          created_at = EXCLUDED.created_at,
          bumped_at = EXCLUDED.bumped_at,
          data = EXCLUDED.data`,
        [
          clan.id,
          clan.ownerId || null,
          clan.name,
          clan.tag,
          clan.language || null,
          clan.platform || null,
          clan.region || null,
          clan.status || null,
          clan.discord || null,
          Boolean(clan.paused),
          clan.inviteOk !== false,
          clan.inviteCheckedAt || null,
          Boolean(clan.featured),
          clan.allianceId || null,
          clan.createdAt || null,
          clan.bumpedAt || null,
          JSON.stringify(extraData(clan, LISTING_COLUMNS)),
        ]
      );
    }
    await reconcile(client, "clans", "id", clans.map((item) => item.id));

    for (const alliance of alliances) {
      await upsert(client, "alliances", alliance.id,
        `INSERT INTO alliances (
          id, owner_id, name, tag, language, platforms, region, status, discord, paused,
          invite_ok, invite_checked_at, featured, created_at, bumped_at, data
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          name = EXCLUDED.name,
          tag = EXCLUDED.tag,
          language = EXCLUDED.language,
          platforms = EXCLUDED.platforms,
          region = EXCLUDED.region,
          status = EXCLUDED.status,
          discord = EXCLUDED.discord,
          paused = EXCLUDED.paused,
          invite_ok = EXCLUDED.invite_ok,
          invite_checked_at = EXCLUDED.invite_checked_at,
          featured = EXCLUDED.featured,
          created_at = EXCLUDED.created_at,
          bumped_at = EXCLUDED.bumped_at,
          data = EXCLUDED.data`,
        [
          alliance.id,
          alliance.ownerId || null,
          alliance.name,
          alliance.tag,
          alliance.language || null,
          JSON.stringify(alliance.platforms || []),
          alliance.region || null,
          alliance.status || null,
          alliance.discord || null,
          Boolean(alliance.paused),
          alliance.inviteOk !== false,
          alliance.inviteCheckedAt || null,
          Boolean(alliance.featured),
          alliance.createdAt || null,
          alliance.bumpedAt || null,
          JSON.stringify(extraData(alliance, LISTING_COLUMNS)),
        ]
      );
    }
    await reconcile(
      client,
      "alliances",
      "id",
      alliances.map((item) => item.id)
    );

    for (const report of reports) {
      await upsert(client, "reports", report.id,
        `INSERT INTO reports (
          id, kind, listing_id, listing_name, reason, details, reporter_id, created_at, status, resolved_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET
          kind = EXCLUDED.kind,
          listing_id = EXCLUDED.listing_id,
          listing_name = EXCLUDED.listing_name,
          reason = EXCLUDED.reason,
          details = EXCLUDED.details,
          reporter_id = EXCLUDED.reporter_id,
          created_at = EXCLUDED.created_at,
          status = EXCLUDED.status,
          resolved_at = EXCLUDED.resolved_at`,
        [
          report.id,
          report.kind,
          report.listingId || null,
          report.listingName || null,
          report.reason || null,
          report.details || "",
          report.reporterId || null,
          report.createdAt || null,
          report.status || "open",
          report.resolvedAt || null,
        ]
      );
    }
    await reconcile(client, "reports", "id", reports.map((item) => item.id));

    await client.query("COMMIT");
    digests = pending;
  } catch (error) {
    await client.query("ROLLBACK");
    // Forget what we thought was written; the next save reconciles in full.
    digests = null;
    throw error;
  } finally {
    pending = null;
    client.release();
  }
}

export function saveState(db) {
  const next = saveLock.then(() => persistTables(db), () => persistTables(db));
  saveLock = next.catch(() => {});
  return next;
}

export async function closePg() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
