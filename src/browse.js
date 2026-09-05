import { PLAYSTYLES, TIER_CAPS } from "./data.js";

export const PAGE_SIZE = 12;

export function parsePlaystyles(values) {
  const wanted = [];
  for (const value of values || []) {
    const name = String(value || "");
    if (!PLAYSTYLES.includes(name) || wanted.includes(name)) continue;
    wanted.push(name);
  }
  return wanted;
}

function platformMatches(value, filter) {
  return value === filter || value === "All Platforms";
}

function alliancePlatformMatches(platforms, filter) {
  const list = platforms || [];
  return list.includes(filter) || list.includes("All Platforms");
}

export function paginate(list, page, size = PAGE_SIZE) {
  const items = Array.isArray(list) ? list : [];
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    pages,
    total,
    size,
  };
}

export function defaultFilters() {
  return {
    q: "",
    platform: "",
    tier: "",
    playstyles: [],
    region: "",
    language: "",
    status: "",
    online: false,
    recruiting: true,
    mr: "0",
    sort: "newest",
  };
}

export function filtersFromSearch(search) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const filters = defaultFilters();
  filters.q = String(params.get("q") || "").trim();
  filters.platform = String(params.get("platform") || "");
  filters.tier = String(params.get("tier") || "");
  filters.playstyles = parsePlaystyles(params.getAll("playstyle"));
  filters.region = String(params.get("region") || "");
  filters.language = String(params.get("language") || "");
  filters.status = String(params.get("status") || "");
  filters.online = params.get("online") === "1";
  filters.recruiting = params.get("recruiting") !== "0";
  filters.mr = String(params.get("mr") || "0");
  filters.sort = String(params.get("sort") || "newest");
  return { filters, page: Number(params.get("page") || 1) };
}

export function filtersToSearch(filters, page = 1) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.tier) params.set("tier", filters.tier);
  for (const playstyle of filters.playstyles || []) params.append("playstyle", playstyle);
  if (filters.region) params.set("region", filters.region);
  if (filters.language) params.set("language", filters.language);
  if (filters.status) params.set("status", filters.status);
  if (filters.online) params.set("online", "1");
  if (!filters.recruiting) params.set("recruiting", "0");
  if (Number(filters.mr) > 0) params.set("mr", String(filters.mr));
  if (filters.sort && filters.sort !== "newest") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function selectedPlaystyles(filters) {
  if (Array.isArray(filters.playstyles)) return parsePlaystyles(filters.playstyles);
  if (filters.playstyle) return parsePlaystyles([filters.playstyle]);
  return [];
}

export function applyClanFilters(clans, filters) {
  const q = String(filters.q || "").toLowerCase();
  const mr = Number(filters.mr || 0);
  const playstyles = selectedPlaystyles(filters);
  let list = (clans || []).filter((clan) => {
    if (clan.hidden) return false;
    const hay = [clan.name, clan.tag, clan.headline, clan.summary, (clan.playstyles || []).join(" "), clan.allianceName || ""]
      .join(" ")
      .toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (filters.platform && !platformMatches(clan.platform, filters.platform)) return false;
    if (filters.tier && clan.tier !== filters.tier) return false;
    if (playstyles.length && !playstyles.every((item) => (clan.playstyles || []).includes(item))) return false;
    if (filters.region && clan.region !== filters.region) return false;
    if (filters.language && clan.language !== filters.language) return false;
    if (filters.status && clan.status !== filters.status) return false;
    if (filters.online && !clan.online) return false;
    if (filters.recruiting && !clan.recruiting) return false;
    if (mr > 0 && clan.mrRequired > mr) return false;
    return true;
  });
  if (filters.sort === "open") {
    const rank = { Open: 0, Selective: 1, "Trial Required": 2 };
    list.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  } else if (filters.sort === "space") {
    list.sort((a, b) => TIER_CAPS[b.tier] - b.members - (TIER_CAPS[a.tier] - a.members));
  } else if (filters.sort === "mr") {
    list.sort((a, b) => a.mrRequired - b.mrRequired);
  } else {
    list.sort((a, b) => {
      if (a.recruiting !== b.recruiting) return a.recruiting ? -1 : 1;
      return new Date(b.bumpedAt || b.createdAt) - new Date(a.bumpedAt || a.createdAt);
    });
  }
  return list;
}

export function applyAllianceFilters(alliances, filters) {
  const q = String(filters.q || "").toLowerCase();
  return (alliances || [])
    .filter((item) => {
      if (item.hidden) return false;
      const hay = [item.name, item.tag, item.headline, item.summary, (item.platforms || []).join(" ")]
        .join(" ")
        .toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (filters.platform && !alliancePlatformMatches(item.platforms, filters.platform)) return false;
      if (filters.region && item.region !== filters.region) return false;
      if (filters.language && item.language !== filters.language) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.recruiting && !item.recruiting) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.recruiting !== b.recruiting) return a.recruiting ? -1 : 1;
      return new Date(b.bumpedAt || b.createdAt) - new Date(a.bumpedAt || a.createdAt);
    });
}
