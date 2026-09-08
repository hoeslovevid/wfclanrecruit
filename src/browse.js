import { PLAYSTYLES, TIER_CAPS, normalizePlaystyle } from "./data.js";
import { hasOpenRole } from "./roles.js";

export const PAGE_SIZE = 12;

export function parsePlaystyles(values) {
  const wanted = [];
  for (const value of values || []) {
    const name = String(value || "");
    // A saved or shared link may still carry an old tag name; rename it rather
    // than dropping the filter on the floor.
    const tag = normalizePlaystyle(name);
    if (!PLAYSTYLES.includes(tag) || wanted.includes(tag)) continue;
    wanted.push(tag);
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
    role: "",
    region: "",
    language: "",
    status: "",
    online: false,
    recruiting: true,
    mr: "0",
    hours: "",
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
  filters.role = String(params.get("role") || "").trim();
  filters.region = String(params.get("region") || "");
  filters.language = String(params.get("language") || "");
  filters.status = String(params.get("status") || "");
  filters.online = params.get("online") === "1";
  filters.recruiting = params.get("recruiting") !== "0";
  filters.mr = String(params.get("mr") || "0");
  filters.hours = String(params.get("hours") || "");
  filters.sort = String(params.get("sort") || "newest");
  return { filters, page: Number(params.get("page") || 1) };
}

export function filtersToSearch(filters, page = 1) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.tier) params.set("tier", filters.tier);
  for (const playstyle of filters.playstyles || []) params.append("playstyle", playstyle);
  if (filters.role) params.set("role", filters.role);
  if (filters.region) params.set("region", filters.region);
  if (filters.language) params.set("language", filters.language);
  if (filters.status) params.set("status", filters.status);
  if (filters.online) params.set("online", "1");
  if (!filters.recruiting) params.set("recruiting", "0");
  if (Number(filters.mr) > 0) params.set("mr", String(filters.mr));
  if (filters.hours) params.set("hours", filters.hours);
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
    const hay = [
      clan.name,
      clan.tag,
      clan.headline,
      clan.summary,
      (clan.playstyles || []).join(" "),
      // A clan advertising for an architect should be findable by typing it.
      (clan.roles || []).map((role) => role.name).join(" "),
      clan.allianceName || "",
    ]
      .join(" ")
      .toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (filters.platform && !platformMatches(clan.platform, filters.platform)) return false;
    if (filters.tier && clan.tier !== filters.tier) return false;
    if (playstyles.length && !playstyles.every((item) => (clan.playstyles || []).includes(item))) return false;
    // Closed roles do not count: the filter is for seats you could take.
    if (filters.role && !hasOpenRole(clan, filters.role)) return false;
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

// The MR filter means the opposite thing on this side of the board, and that is
// the one trap in reusing the clan filters wholesale.
//
// On clans, `mr` is *the visitor's* rank: they type theirs and the board hides
// clans that would turn them away, so a clan is excluded when it demands more
// than they have. On players, `mr` is a *floor* a recruiter sets: show me people
// at least this experienced, so a player is excluded when they have less than it
// asks for. Same query parameter, opposite comparison - which is why it is
// spelled out here rather than left to be read off the symmetry.
export function applyPlayerFilters(players, filters) {
  const q = String(filters.q || "").toLowerCase();
  const mrFloor = Number(filters.mr || 0);
  const playstyles = selectedPlaystyles(filters);
  const list = (players || []).filter((player) => {
    if (player.hidden) return false;
    const hay = [player.name, player.headline, player.summary, (player.playstyles || []).join(" ")]
      .join(" ")
      .toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (filters.platform && !platformMatches(player.platform, filters.platform)) return false;
    if (playstyles.length && !playstyles.every((item) => (player.playstyles || []).includes(item))) return false;
    if (filters.region && player.region !== filters.region) return false;
    if (filters.language && player.language !== filters.language) return false;
    if (filters.status && player.status !== filters.status) return false;
    if (filters.hours && player.hours !== filters.hours) return false;
    if (filters.online && !player.online) return false;
    // `recruiting` is the shared name for "this listing is live"; on a player it
    // reads as still looking.
    if (filters.recruiting && !player.recruiting) return false;
    if (mrFloor > 0 && Number(player.mr || 0) < mrFloor) return false;
    return true;
  });
  if (filters.sort === "mr") {
    // Highest first. A recruiter sorting by MR is looking for the most
    // experienced player, where a recruit sorting clans wants the lowest bar.
    list.sort((a, b) => Number(b.mr || 0) - Number(a.mr || 0));
  } else {
    list.sort((a, b) => {
      if (a.recruiting !== b.recruiting) return a.recruiting ? -1 : 1;
      return new Date(b.bumpedAt || b.createdAt) - new Date(a.bumpedAt || a.createdAt);
    });
  }
  return list;
}
