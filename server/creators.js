import { normalizeDiscordId } from "./admins.js";

export function ensureCreatorGrants(db) {
  if (!Array.isArray(db.creatorGrants)) db.creatorGrants = [];
  return db.creatorGrants;
}

export function creatorUsers(db) {
  return (db.users || []).filter((user) => user.creator && !user.admin);
}

export const CREATOR_SEARCH_MIN = 2;
export const CREATOR_SEARCH_MAX = 8;

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

export function searchCreatorCandidates(users, query, actorId, limit = CREATOR_SEARCH_MAX) {
  const wanted = String(query || "").trim().toLowerCase();
  if (wanted.length < CREATOR_SEARCH_MIN) return [];
  const matches = [];
  for (const user of users || []) {
    if (!user || user.admin || user.creator || user.id === actorId) continue;
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

function exactHits(users, query) {
  const wanted = String(query || "").trim().toLowerCase();
  if (!wanted) return [];
  return uniqueUsers(
    (users || []).filter((user) => nameList(user).some((name) => name.toLowerCase() === wanted))
  );
}

export function grantExistingCreator(db, user, actor) {
  if (!user) return { error: "That account was not found." };
  if (user.id === actor?.id) {
    return { error: "You already run the board, so you can write guides without this." };
  }
  if (user.admin) {
    return { error: "That account already runs the board, so they can write guides without this." };
  }
  if (user.creator) return { error: "That account can already write guides." };
  user.creator = true;
  if (user.discordId) {
    const grants = ensureCreatorGrants(db);
    db.creatorGrants = grants.filter((item) => item.discordId !== user.discordId);
  }
  return { ok: true, pending: false, user };
}

export function grantCreatorByUserId(db, userId, actor) {
  const user = (db.users || []).find((item) => item.id === userId);
  return grantExistingCreator(db, user, actor);
}

export function grantCreator(db, raw, actor) {
  const trimmed = String(raw || "").trim();
  if (normalizeDiscordId(raw) || normalizeDiscordId(trimmed)) {
    return grantCreatorByDiscordId(db, raw, actor);
  }
  if (!trimmed) {
    return { error: "Type a name from this site, or paste a Discord user ID." };
  }
  const hits = exactHits(db.users || [], trimmed);
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
  return grantExistingCreator(db, hits[0], actor);
}

function grantOf(grants, discordId) {
  return grants.find((item) => item.discordId === discordId) || null;
}

export function applyPendingCreator(db, user) {
  if (!user?.discordId) return false;
  const grants = ensureCreatorGrants(db);
  const grant = grantOf(grants, user.discordId);
  if (!grant) return false;
  user.creator = true;
  db.creatorGrants = grants.filter((item) => item.discordId !== user.discordId);
  return true;
}

export function grantCreatorByDiscordId(db, rawId, actor) {
  const discordId = normalizeDiscordId(rawId);
  if (!discordId) {
    return { error: "Paste a Discord user ID. In Discord: Settings → Advanced → Developer Mode, then right-click the person → Copy User ID." };
  }
  const grants = ensureCreatorGrants(db);
  const existing = (db.users || []).find((user) => user.discordId === discordId);
  if (existing?.id === actor?.id || existing?.admin) {
    return { error: "That account already runs the board, so they can write guides without this." };
  }
  if (existing?.creator) return { error: "That account can already write guides." };
  if (existing) {
    existing.creator = true;
    db.creatorGrants = grants.filter((item) => item.discordId !== discordId);
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
  db.creatorGrants = grants;
  return { ok: true, pending: true, discordId };
}

export function revokeCreator(db, { userId, discordId } = {}) {
  const grants = ensureCreatorGrants(db);
  const id = normalizeDiscordId(discordId);
  if (id) {
    const before = grants.length;
    db.creatorGrants = grants.filter((item) => item.discordId !== id);
    if (db.creatorGrants.length === before) return { error: "No pending grant for that Discord ID." };
    return { ok: true, pending: true };
  }

  const user = (db.users || []).find((item) => item.id === userId);
  if (!user || !user.creator) return { error: "That creator was not found." };
  user.creator = false;
  return { ok: true, user };
}

export function creatorList(db, actorId) {
  const grants = ensureCreatorGrants(db);
  return {
    creators: creatorUsers(db).map((user) => ({
      id: user.id,
      username: user.username,
      discordId: user.discordId || null,
      discordUsername: user.discordUsername || null,
      you: user.id === actorId,
    })),
    pending: grants.map((item) => ({
      discordId: item.discordId,
      grantedAt: item.grantedAt || null,
    })),
  };
}
