export const SAVES_KEY = "wfr-saves";
export const SAVES_MAX = 40;

const KINDS = new Set(["clan", "alliance", "player"]);

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

function asEntry(value) {
  const kind = String(value?.kind || "");
  const id = String(value?.id || "");
  if (!KINDS.has(kind) || !id) return null;
  return { kind, id };
}

export function loadSaves(storage) {
  try {
    const raw = storageOf(storage)?.getItem?.(SAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const list = [];
    for (const item of parsed) {
      const entry = asEntry(item);
      if (!entry) continue;
      const key = `${entry.kind}:${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(entry);
      if (list.length >= SAVES_MAX) break;
    }
    return list;
  } catch {
    return [];
  }
}

function writeSaves(list, storage) {
  try {
    storageOf(storage)?.setItem?.(SAVES_KEY, JSON.stringify(list.slice(0, SAVES_MAX)));
  } catch {
    /* private mode */
  }
  return list;
}

export function replaceSaves(list, storage) {
  const seen = new Set();
  const next = [];
  for (const item of list || []) {
    const entry = asEntry(item);
    if (!entry) continue;
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(entry);
    if (next.length >= SAVES_MAX) break;
  }
  return writeSaves(next, storage);
}

export function mergeSaves(remote, storage) {
  return replaceSaves([...loadSaves(storage), ...(remote || [])], storage);
}

export function isSaved(kind, id, storage) {
  const wanted = asEntry({ kind, id });
  if (!wanted) return false;
  return loadSaves(storage).some((item) => item.kind === wanted.kind && item.id === wanted.id);
}

export function toggleSave(kind, id, storage) {
  const wanted = asEntry({ kind, id });
  if (!wanted) return loadSaves(storage);
  const current = loadSaves(storage);
  const next = current.filter((item) => item.kind !== wanted.kind || item.id !== wanted.id);
  if (next.length === current.length) next.unshift(wanted);
  return writeSaves(next.slice(0, SAVES_MAX), storage);
}

const LISTS = { clan: "clans", alliance: "alliances", player: "players" };
const HREFS = { clan: "/clans", alliance: "/alliances", player: "/players" };

export function resolveSaves(saves, boards = {}) {
  return (saves || [])
    .map((entry) => {
      const list = boards[LISTS[entry.kind]] || [];
      const item = list.find((row) => row.id === entry.id && !row.hidden);
      if (!item) return null;
      return {
        kind: entry.kind,
        id: entry.id,
        href: `${HREFS[entry.kind]}/${entry.id}`,
        item,
      };
    })
    .filter(Boolean);
}
