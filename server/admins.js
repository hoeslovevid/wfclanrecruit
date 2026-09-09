// Discord snowflakes are 17–20 digits. People also paste mentions or quotes;
// strip those so "Copy User ID" and "<@123…>" land on the same grant.
const DISCORD_ID = /^\d{17,20}$/;

export function normalizeDiscordId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return DISCORD_ID.test(digits) ? digits : "";
}

export function ensureAdminGrants(db) {
  if (!Array.isArray(db.adminGrants)) db.adminGrants = [];
  return db.adminGrants;
}

export function envAdminUsername() {
  return String(process.env.ADMIN_USERNAME || "").trim();
}

export function isEnvAdmin(user) {
  const username = envAdminUsername();
  if (!user) return false;
  if (username && String(user.username || "").toLowerCase() === username.toLowerCase()) return true;
  return user.id === "user-admin" || String(user.id || "").startsWith("user-admin-");
}

export function adminUsers(db) {
  return (db.users || []).filter((user) => user.admin);
}

export const STAFF_SEARCH_MIN = 2;
export const STAFF_SEARCH_MAX = 8;

function nameList(user) {
  const names = [];
  if (user?.forumVerified && user.forumName) names.push(String(user.forumName));
  if (user?.discordUsername) names.push(String(user.discordUsername));
  if (user?.username) names.push(String(user.username));
  return names;
}

function uniqueUsers(list) {
  const seen = new Set();
  const out = [];
  for (const user of list) {
    if (!user?.id || seen.has(user.id)) continue;
    seen.add(user.id);
    out.push(user);
  }
  return out;
}

export function searchStaffCandidates(users, query, actorId, limit = STAFF_SEARCH_MAX) {
  const wanted = String(query || "").trim().toLowerCase();
  if (wanted.length < STAFF_SEARCH_MIN) return [];
  const matches = [];
  for (const user of users || []) {
    if (!user || user.admin || user.id === actorId) continue;
    let at = Infinity;
    let matched = "";
    for (const name of nameList(user)) {
      const index = name.toLowerCase().indexOf(wanted);
      if (index >= 0 && index < at) {
        at = index;
        matched = name;
      }
    }
    if (at === Infinity) continue;
    matches.push({
      id: user.id,
      label: nameList(user)[0] || user.username || "Account",
      matched,
      at,
    });
  }
  matches.sort((a, b) => a.at - b.at || a.label.localeCompare(b.label));
  return matches.slice(0, limit).map(({ id, label, matched }) => ({ id, label, matched }));
}

function exactStaffHits(users, query) {
  const wanted = String(query || "").trim().toLowerCase();
  if (!wanted) return [];
  return uniqueUsers(
    (users || []).filter((user) => nameList(user).some((name) => name.toLowerCase() === wanted))
  );
}

export function grantExistingUser(db, user, actor) {
  if (!user) return { error: "That account was not found." };
  if (user.id === actor?.id) return { error: "You already have admin access." };
  if (user.admin) return { error: "That account is already an admin." };
  user.admin = true;
  if (user.discordId) {
    const grants = ensureAdminGrants(db);
    db.adminGrants = grants.filter((item) => item.discordId !== user.discordId);
  }
  return { ok: true, pending: false, user };
}

export function grantByUserId(db, userId, actor) {
  const user = (db.users || []).find((item) => item.id === userId);
  return grantExistingUser(db, user, actor);
}

export function grantStaff(db, raw, actor) {
  const trimmed = String(raw || "").trim();
  if (normalizeDiscordId(raw) || normalizeDiscordId(trimmed)) {
    return grantByDiscordId(db, raw, actor);
  }
  if (!trimmed) {
    return { error: "Type a name from this site, or paste a Discord user ID." };
  }
  const hits = exactStaffHits(db.users || [], trimmed);
  if (!hits.length) {
    return {
      error: "No account matches that name. They need to sign in once, or paste their Discord user ID.",
    };
  }
  if (hits.length > 1) {
    return {
      error: "More than one account matches. Pick them from the list, or paste their Discord user ID.",
    };
  }
  return grantExistingUser(db, hits[0], actor);
}

function grantOf(grants, discordId) {
  return grants.find((item) => item.discordId === discordId) || null;
}

export function applyPendingAdmin(db, user) {
  if (!user?.discordId) return false;
  const grants = ensureAdminGrants(db);
  const grant = grantOf(grants, user.discordId);
  if (!grant) return false;
  user.admin = true;
  db.adminGrants = grants.filter((item) => item.discordId !== user.discordId);
  return true;
}

export function grantByDiscordId(db, rawId, actor) {
  const discordId = normalizeDiscordId(rawId);
  if (!discordId) {
    return { error: "Paste a Discord user ID. In Discord: Settings → Advanced → Developer Mode, then right-click the person → Copy User ID." };
  }
  const grants = ensureAdminGrants(db);
  const existing = (db.users || []).find((user) => user.discordId === discordId);
  if (existing?.id === actor?.id) return { error: "You already have admin access." };
  if (existing?.admin) return { error: "That account is already an admin." };
  if (existing) {
    existing.admin = true;
    db.adminGrants = grants.filter((item) => item.discordId !== discordId);
    return { ok: true, pending: false, user: existing };
  }
  if (grantOf(grants, discordId)) {
    return { error: "That Discord ID is already waiting for them to sign in." };
  }
  grants.push({
    discordId,
    grantedBy: actor?.id || null,
    grantedAt: new Date().toISOString(),
  });
  db.adminGrants = grants;
  return { ok: true, pending: true, discordId };
}

export function revokeAdmin(db, { userId, discordId } = {}, actor) {
  const grants = ensureAdminGrants(db);
  const id = normalizeDiscordId(discordId);
  if (id) {
    const before = grants.length;
    db.adminGrants = grants.filter((item) => item.discordId !== id);
    if (db.adminGrants.length === before) return { error: "No pending grant for that Discord ID." };
    return { ok: true, pending: true };
  }

  const user = (db.users || []).find((item) => item.id === userId);
  if (!user || !user.admin) return { error: "That admin was not found." };
  if (user.id === actor?.id) return { error: "You cannot remove your own admin access." };
  if (isEnvAdmin(user)) {
    return { error: "The password operator account cannot be removed from this page." };
  }
  if (adminUsers(db).length <= 1) {
    return { error: "The last admin cannot be removed, or the board would have nobody to run it." };
  }
  user.admin = false;
  return { ok: true, user };
}

export function publicStaff(user, actorId) {
  return {
    id: user.id,
    username: user.username,
    discordId: user.discordId || null,
    discordUsername: user.discordUsername || null,
    env: isEnvAdmin(user),
    you: user.id === actorId,
  };
}

export function staffList(db, actorId) {
  const grants = ensureAdminGrants(db);
  return {
    admins: adminUsers(db).map((user) => publicStaff(user, actorId)),
    pending: grants.map((item) => ({
      discordId: item.discordId,
      grantedAt: item.grantedAt || null,
    })),
  };
}
