import pg from "pg";

let pool = null;

export function postgresEnabled() {
  return Boolean(process.env.DATABASE_URL);
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
    CREATE TABLE IF NOT EXISTS app_state (
      id INT PRIMARY KEY,
      users JSONB NOT NULL DEFAULT '[]'::jsonb,
      sessions JSONB NOT NULL DEFAULT '[]'::jsonb,
      clans JSONB NOT NULL DEFAULT '[]'::jsonb,
      alliances JSONB NOT NULL DEFAULT '[]'::jsonb,
      reports JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT app_state_one_row CHECK (id = 1)
    )
  `);
  return pool;
}

export async function loadState() {
  const { rows } = await pool.query("SELECT users, sessions, clans, alliances, reports FROM app_state WHERE id = 1");
  if (!rows[0]) return null;
  return {
    users: rows[0].users || [],
    sessions: rows[0].sessions || [],
    clans: rows[0].clans || [],
    alliances: rows[0].alliances || [],
    reports: rows[0].reports || [],
  };
}

export async function saveState(db) {
  await pool.query(
    `INSERT INTO app_state (id, users, sessions, clans, alliances, reports, updated_at)
     VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       users = EXCLUDED.users,
       sessions = EXCLUDED.sessions,
       clans = EXCLUDED.clans,
       alliances = EXCLUDED.alliances,
       reports = EXCLUDED.reports,
       updated_at = NOW()`,
    [
      JSON.stringify(db.users || []),
      JSON.stringify(db.sessions || []),
      JSON.stringify(db.clans || []),
      JSON.stringify(db.alliances || []),
      JSON.stringify(db.reports || []),
    ]
  );
}

export async function closePg() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
