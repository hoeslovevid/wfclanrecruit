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
  return pool;
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

export async function saveState(db) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM reports");
    await client.query("DELETE FROM sessions");
    await client.query("DELETE FROM clans");
    await client.query("DELETE FROM alliances");
    await client.query("DELETE FROM users");

    for (const user of db.users || []) {
      await client.query(
        `INSERT INTO users (
          id, username, password, admin, created_at, discord_id, discord_username, discord_email,
          forum_verified, forum_name, forum_profile_url, forum_token, forum_verified_at, forum_checked_at, data
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
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

    for (const session of db.sessions || []) {
      await client.query("INSERT INTO sessions (token, user_id, expires) VALUES ($1,$2,$3)", [
        session.token,
        session.userId,
        Number(session.expires) || 0,
      ]);
    }

    for (const clan of db.clans || []) {
      await client.query(
        `INSERT INTO clans (
          id, owner_id, name, tag, language, platform, region, status, discord, paused,
          invite_ok, invite_checked_at, featured, alliance_id, created_at, bumped_at, data
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
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

    for (const alliance of db.alliances || []) {
      await client.query(
        `INSERT INTO alliances (
          id, owner_id, name, tag, language, platforms, region, status, discord, paused,
          invite_ok, invite_checked_at, featured, created_at, bumped_at, data
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
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

    for (const report of db.reports || []) {
      await client.query(
        `INSERT INTO reports (
          id, kind, listing_id, listing_name, reason, details, reporter_id, created_at, status, resolved_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePg() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
