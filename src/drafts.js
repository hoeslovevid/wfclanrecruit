export const DRAFTS_KEY = "wfr-drafts";
const DRAFTS_MAX = 8;
const SKIP = new Set(["image", "mediaImage", "media"]);
const ROW_FIELDS = new Set(["roles", "links"]);

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

export function draftKey(kind, id) {
  const name = String(kind || "clan");
  return id ? `${name}:${id}` : `${name}:new`;
}

function loadAll(storage) {
  try {
    const raw = storageOf(storage)?.getItem?.(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all, storage) {
  try {
    storageOf(storage)?.setItem?.(DRAFTS_KEY, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}

export function loadDraft(key, storage) {
  const entry = loadAll(storage)[key];
  return entry?.fields && typeof entry.fields === "object" ? entry.fields : null;
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function draftIsBlank(fields) {
  if (!fields || typeof fields !== "object") return true;
  const keys = ["name", "tag", "headline", "summary", "about", "discord", "discordName", "offering", "requirements", "howToJoin"];
  if (!keys.every((key) => !String(fields[key] || "").replace(/<[^>]+>/g, "").trim())) return false;
  if (parseList(fields.roles).some((row) => String(row?.name || "").trim())) return false;
  if (parseList(fields.links).some((row) => String(row?.url || "").trim())) return false;
  return true;
}

export function loadAllDrafts(storage) {
  return loadAll(storage);
}

export function replaceDrafts(all, storage) {
  writeAll(all && typeof all === "object" ? all : {}, storage);
}

export function mergeDrafts(remote, storage) {
  const local = loadAll(storage);
  const next = { ...local };
  for (const [key, entry] of Object.entries(remote || {})) {
    if (!entry?.fields || typeof entry.fields !== "object") continue;
    const mine = local[key];
    if (!mine || String(entry.savedAt || "") > String(mine.savedAt || "")) next[key] = entry;
  }
  writeAll(next, storage);
  return next;
}

export function saveDraft(key, fields, storage) {
  if (!key) return null;
  const all = loadAll(storage);
  if (draftIsBlank(fields)) {
    delete all[key];
    writeAll(all, storage);
    return null;
  }
  all[key] = { fields, savedAt: new Date().toISOString() };
  const keys = Object.keys(all);
  if (keys.length > DRAFTS_MAX) {
    const oldest = keys
      .map((name) => ({ name, at: all[name]?.savedAt || "" }))
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const extra of oldest.slice(0, keys.length - DRAFTS_MAX)) delete all[extra.name];
  }
  writeAll(all, storage);
  return all[key];
}

export function clearDraft(key, storage) {
  const all = loadAll(storage);
  delete all[key];
  writeAll(all, storage);
}

export function serializeComposer(form) {
  const fields = {};
  const lists = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (SKIP.has(el.name) || el.type === "file") continue;
    if (el.type === "checkbox") {
      if (!lists[el.name]) lists[el.name] = [];
      if (el.checked) lists[el.name].push(el.value);
      continue;
    }
    if (el.type === "radio") {
      if (el.checked) fields[el.name] = el.value;
      continue;
    }
    fields[el.name] = el.value;
  }
  for (const [name, values] of Object.entries(lists)) fields[name] = values;
  return fields;
}

export function restoreComposer(form, fields) {
  if (!fields) return false;
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (SKIP.has(el.name) || ROW_FIELDS.has(el.name) || el.type === "file") continue;
    const value = fields[el.name];
    if (value === undefined) continue;
    if (el.type === "checkbox") {
      const wanted = Array.isArray(value) ? value : [value];
      el.checked = wanted.includes(el.value);
      continue;
    }
    if (el.type === "radio") {
      el.checked = el.value === value;
      continue;
    }
    el.value = value == null ? "" : String(value);
  }
  return true;
}

function fillRoleRow(row, role = {}) {
  const name = row.querySelector("[data-role-name]");
  const status = row.querySelector("[data-role-status]");
  const count = row.querySelector("[data-role-count]");
  if (name) name.value = role.name || "";
  if (status) status.value = role.status || "Open";
  if (count) count.value = role.count ?? "";
  const description = row.querySelector("[data-role-field=description] textarea");
  const requirements = row.querySelector("[data-role-field=requirements] textarea");
  if (description) description.value = role.description || "";
  if (requirements) requirements.value = role.requirements || "";
}

function fillLinkRow(row, link = {}) {
  const kind = row.querySelector("[data-link-kind]");
  const url = row.querySelector("[data-link-url]");
  if (kind) kind.value = link.kind || "Other";
  if (url) url.value = link.url || "";
}

function restoreRowList(form, kind, items, fill) {
  const list = form.querySelector(`[data-row-list='${kind}']`);
  const box = list?.querySelector("[data-row-items]");
  const template = list?.querySelector("[data-row-template]");
  if (!box || !template || !items.length) return;
  box.replaceChildren();
  for (const item of items) {
    const row = template.content.firstElementChild?.cloneNode(true);
    if (!row) continue;
    fill(row, item);
    box.append(row);
  }
}

export function restoreComposerRows(form, fields) {
  if (!fields) return;
  restoreRowList(
    form,
    "role",
    parseList(fields.roles).filter((row) => String(row?.name || "").trim()),
    fillRoleRow
  );
  restoreRowList(
    form,
    "link",
    parseList(fields.links).filter((row) => String(row?.url || "").trim()),
    fillLinkRow
  );
}

