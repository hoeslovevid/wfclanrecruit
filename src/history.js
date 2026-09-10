export const VIEWED_KEY = "wfr-viewed";
export const VIEWED_MAX = 10;

const KINDS = new Set(["clan", "alliance", "player"]);

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

function asEntry(value) {
  const kind = String(value?.kind || "");
  const id = String(value?.id || "");
  if (!KINDS.has(kind) || !id || id === "preview") return null;
  return { kind, id };
}

export function loadViewed(storage) {
  try {
    const raw = storageOf(storage)?.getItem?.(VIEWED_KEY);
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
      if (list.length >= VIEWED_MAX) break;
    }
    return list;
  } catch {
    return [];
  }
}

export function recordView(kind, id, storage) {
  const wanted = asEntry({ kind, id });
  if (!wanted) return loadViewed(storage);
  const next = [wanted, ...loadViewed(storage).filter((item) => item.kind !== wanted.kind || item.id !== wanted.id)];
  try {
    storageOf(storage)?.setItem?.(VIEWED_KEY, JSON.stringify(next.slice(0, VIEWED_MAX)));
  } catch {
    /* private mode */
  }
  return next.slice(0, VIEWED_MAX);
}
