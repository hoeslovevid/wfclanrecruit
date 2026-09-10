export const FILTERS_KEY = "wfr-filters";
const PATHS = new Set(["/browse", "/alliances", "/players"]);

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

function loadAll(storage) {
  try {
    const raw = storageOf(storage)?.getItem?.(FILTERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all, storage) {
  try {
    storageOf(storage)?.setItem?.(FILTERS_KEY, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}

export function loadRememberedSearch(path, storage) {
  if (!PATHS.has(path)) return "";
  return String(loadAll(storage)[path] || "");
}

export function saveRememberedSearch(path, search, storage) {
  if (!PATHS.has(path)) return;
  const all = loadAll(storage);
  const qs = String(search || "");
  if (!qs) delete all[path];
  else all[path] = qs.startsWith("?") ? qs : `?${qs}`;
  writeAll(all, storage);
}

export function clearRememberedSearch(path, storage) {
  saveRememberedSearch(path, "", storage);
}

export function rememberedIsDefault(search) {
  return !String(search || "").replace(/^\?/, "").trim();
}
