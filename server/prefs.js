const KINDS = new Set(["clan", "alliance", "player"]);
const SAVES_MAX = 40;
const DRAFTS_MAX = 8;
const DRAFT_BYTES = 80_000;

export function sanitizeSaves(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const kind = String(item?.kind || "");
    const id = String(item?.id || "");
    if (!KINDS.has(kind) || !id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id });
    if (out.length >= SAVES_MAX) break;
  }
  return out;
}

export function sanitizeDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .filter(([, entry]) => entry?.fields && typeof entry.fields === "object")
    .sort((a, b) => String(b[1]?.savedAt || "").localeCompare(String(a[1]?.savedAt || "")))
    .slice(0, DRAFTS_MAX);
  const out = {};
  let bytes = 0;
  for (const [key, entry] of entries) {
    const packed = { fields: entry.fields, savedAt: String(entry.savedAt || "") };
    bytes += JSON.stringify(packed).length;
    if (bytes > DRAFT_BYTES) break;
    out[String(key).slice(0, 80)] = packed;
  }
  return out;
}

export function userPrefs(user) {
  return {
    saves: sanitizeSaves(user?.saves),
    drafts: sanitizeDrafts(user?.drafts),
  };
}
