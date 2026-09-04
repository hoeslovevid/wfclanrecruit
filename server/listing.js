export const STALE_AFTER_MS = 21 * 24 * 60 * 60 * 1000;
export const REPORT_REASONS = ["dead_invite", "inactive", "fake", "stolen_name", "other"];

export function activityAt(item) {
  return item.bumpedAt || item.createdAt;
}

export function isStale(item) {
  const at = new Date(activityAt(item)).getTime();
  if (!Number.isFinite(at)) return false;
  return Date.now() - at > STALE_AFTER_MS;
}

export function isRecruiting(item) {
  return !item.paused && !isStale(item) && item.inviteOk !== false;
}

export function nameKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function tagKey(value) {
  return String(value || "").trim().toUpperCase();
}

export function listingConflict(list, { name, tag, id }) {
  const n = nameKey(name);
  const t = tagKey(tag);
  const other = (list || []).find((item) => item.id !== id && (nameKey(item.name) === n || tagKey(item.tag) === t));
  if (!other) return null;
  if (nameKey(other.name) === n) return `A listing already uses the name "${other.name}".`;
  return `A listing already uses the tag [${other.tag}].`;
}

export function withListingState(item) {
  const stale = isStale(item);
  const paused = Boolean(item.paused);
  return {
    ...item,
    stale,
    paused,
    recruiting: isRecruiting(item),
  };
}

export function applyAllianceRoster(db, allianceId, ownerId, rosterIds) {
  const allowed = new Set(
    (rosterIds || []).filter((id) => {
      const clan = (db.clans || []).find((item) => item.id === id);
      return clan && clan.ownerId === ownerId;
    })
  );
  for (const clan of db.clans || []) {
    if (clan.ownerId !== ownerId) continue;
    if (allowed.has(clan.id)) clan.allianceId = allianceId;
    else if (clan.allianceId === allianceId) clan.allianceId = null;
  }
  const alliance = (db.alliances || []).find((item) => item.id === allianceId);
  if (alliance) alliance.clanCount = Math.max(alliance.clanCount || 0, allowed.size);
}
