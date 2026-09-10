import { defaultFilters, filtersToSearch } from "./browse.js";

export const FILTER_PRESETS = [
  { id: "pc-na", label: "PC · NA", filters: { platform: "PC", region: "North America" } },
  { id: "pc-eu", label: "PC · EU", filters: { platform: "PC", region: "Europe" } },
  { id: "ps-na", label: "PlayStation · NA", filters: { platform: "PlayStation", region: "North America" } },
  { id: "ps-eu", label: "PlayStation · EU", filters: { platform: "PlayStation", region: "Europe" } },
  { id: "steel", label: "Steel Path", filters: { playstyles: ["Late Steel Path"] } },
  { id: "new", label: "New Player Friendly", filters: { playstyles: ["New Player Friendly"] } },
  { id: "mr16", label: "MR 16+", filters: { mr: "16" } },
  { id: "online", label: "Online now", filters: { online: true } },
];

export const ALLIANCE_PRESETS = [
  { id: "pc-na", label: "PC · NA", filters: { platform: "PC", region: "North America" } },
  { id: "pc-eu", label: "PC · EU", filters: { platform: "PC", region: "Europe" } },
  { id: "ps-na", label: "PlayStation · NA", filters: { platform: "PlayStation", region: "North America" } },
];

export const PLAYER_PRESETS = [
  { id: "pc-na", label: "PC · NA", filters: { platform: "PC", region: "North America" } },
  { id: "pc-eu", label: "PC · EU", filters: { platform: "PC", region: "Europe" } },
  { id: "steel", label: "Steel Path", filters: { playstyles: ["Late Steel Path"] } },
  { id: "new", label: "New Player Friendly", filters: { playstyles: ["New Player Friendly"] } },
  { id: "mr16", label: "MR 16+", filters: { mr: "16" } },
  { id: "online", label: "Online now", filters: { online: true } },
];

export function presetSearch(preset) {
  return filtersToSearch({
    ...defaultFilters(),
    ...preset.filters,
    playstyles: preset.filters.playstyles || [],
  });
}

export function presetHref(preset, base = "/browse") {
  return `${base}${presetSearch(preset)}`;
}

export function presetIsActive(preset, filters = {}) {
  const wanted = preset.filters || {};
  if (wanted.platform && filters.platform !== wanted.platform) return false;
  if (wanted.region && filters.region !== wanted.region) return false;
  if (wanted.mr && String(filters.mr || "0") !== String(wanted.mr)) return false;
  if (wanted.online && !filters.online) return false;
  for (const tag of wanted.playstyles || []) {
    if (!(filters.playstyles || []).includes(tag)) return false;
  }
  return true;
}

function samePlatform(a, b) {
  if (!a || !b) return false;
  if (a === "All Platforms" || b === "All Platforms") return true;
  return a === b;
}

function playstyleOverlap(a, b) {
  const wanted = new Set(a || []);
  return (b || []).filter((tag) => wanted.has(tag)).length;
}

function mrScore(a, b) {
  const delta = Math.abs(Number(a || 0) - Number(b || 0));
  if (delta === 0) return 3;
  if (delta <= 3) return 2;
  if (delta <= 8) return 1;
  return 0;
}

function rankSimilar(seed, all, scoreOf, limit = 3) {
  if (!seed) return [];
  return (all || [])
    .filter((item) => item.id !== seed.id && !item.hidden && item.recruiting !== false)
    .map((item) => ({ item, score: scoreOf(item) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.item.bumpedAt || b.item.createdAt) - new Date(a.item.bumpedAt || a.item.createdAt);
    })
    .slice(0, limit)
    .map((row) => row.item);
}

export function similarClans(clan, all, limit = 3) {
  return rankSimilar(
    clan,
    (all || []).filter((item) => samePlatform(clan.platform, item.platform)),
    (item) =>
      playstyleOverlap(clan.playstyles, item.playstyles) * 4 +
      mrScore(clan.mrRequired, item.mrRequired) +
      (item.online ? 1 : 0),
    limit
  );
}

export function similarAlliances(alliance, all, limit = 3) {
  const platforms = alliance?.platforms || [];
  const pool = (all || []).filter((item) => {
    if (!platforms.length) return true;
    const theirs = item.platforms || [];
    return theirs.some((name) => platforms.includes(name) || name === "All Platforms") || theirs.includes("All Platforms");
  });
  return rankSimilar(
    alliance,
    pool,
    (item) => {
      const overlap = (item.platforms || []).filter((name) => platforms.includes(name) || name === "All Platforms").length;
      const region = alliance.region && item.region === alliance.region ? 2 : 0;
      return overlap * 3 + region;
    },
    limit
  );
}

export function similarPlayers(player, all, limit = 3) {
  return rankSimilar(
    player,
    (all || []).filter((item) => samePlatform(player.platform, item.platform)),
    (item) =>
      playstyleOverlap(player.playstyles, item.playstyles) * 4 +
      mrScore(player.mr, item.mr) +
      (item.online ? 1 : 0),
    limit
  );
}

export function matchReasons(item, filters = {}, kind = "clan") {
  if (!item || !filters) return [];
  const reasons = [];
  const platform = kind === "alliance" ? (item.platforms || []) : item.platform;
  if (filters.platform) {
    if (kind === "alliance") {
      if ((platform || []).includes(filters.platform) || (platform || []).includes("All Platforms")) {
        reasons.push(filters.platform);
      }
    } else if (samePlatform(item.platform, filters.platform)) {
      reasons.push(filters.platform);
    }
  }
  if (filters.region && item.region === filters.region) reasons.push(filters.region);
  if (filters.status && item.status === filters.status) reasons.push(filters.status);
  if (filters.online && item.online) reasons.push("Online now");
  if (kind === "clan" && Number(filters.mr) > 0 && Number(item.mrRequired || 0) <= Number(filters.mr)) {
    reasons.push(`MR ${item.mrRequired || 0}`);
  }
  if (kind === "player" && Number(filters.mr) > 0 && Number(item.mr || 0) >= Number(filters.mr)) {
    reasons.push(`MR ${item.mr || 0}`);
  }
  for (const tag of filters.playstyles || []) {
    if ((item.playstyles || []).includes(tag)) reasons.push(tag);
  }
  return reasons;
}

export const REPLY_SNIPPETS = [
  { id: "discord", label: "Join Discord", text: "Join the Discord and say hello in recruitment." },
  { id: "mr", label: "What's your MR?", text: "What's your MR, and what do you usually play?" },
  { id: "cap", label: "At cap", text: "We're at cap right now. I can add you to a wait list if you want." },
];

export function introNote(item) {
  const name = String(item?.name || "this listing").trim();
  return `Hi, I came from wfclanrecruit looking at ${name}.`;
}
