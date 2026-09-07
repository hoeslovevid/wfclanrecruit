export const PLATFORMS = ["All Platforms", "PC", "PlayStation", "Xbox", "Nintendo Switch", "Mobile"];
export const TIERS = ["Ghost", "Shadow", "Storm", "Mountain", "Moon"];

// The tag vocabulary, grouped the way a recruit reads it: how far the clan
// plays, what it is like to be in, how it talks, and what it actually runs.
// The grouping is presentation only - a listing still stores `playstyles` as a
// flat array of these strings, so the list can move without a migration.
export const PLAYSTYLE_GROUPS = [
  {
    id: "progression",
    label: "Playstyle / Progression",
    hint: "How far the clan plays",
    tags: [
      "Casual",
      "Early Star Chart",
      "Late Star Chart",
      "Early Steel Path",
      "Late Steel Path",
      "Endgame",
      "Competitive",
      "Completionist",
    ],
  },
  {
    id: "community",
    label: "Community & Dojo",
    hint: "What it is like to be in",
    tags: [
      "New Player Friendly",
      "Veteran Friendly",
      "Social",
      "Active Alliance",
      "Cross-Save",
      "Transparent Leadership",
      "Closed Leadership",
      "Ranks",
      "No Contribution Required",
      "Optional Contributions",
      "Regular Contributions Required",
      "Restricted Research Access",
      "Access to All Research",
      "All Research Completed",
      "Extra Resources",
      "No Activity Rules",
      "Relaxed Activity Rules",
      "Strict Activity Rules",
      "All ages",
      "18+",
    ],
  },
  {
    id: "communication",
    label: "Communication",
    hint: "How the clan talks",
    tags: [
      "Voice Optional",
      "Voice Required",
      "Text Preferred",
      "Active In-Game Chat",
      "Active Third-Party Chat (Discord, etc.)",
    ],
  },
  {
    id: "activities",
    label: "Activities",
    hint: "What the clan runs together",
    tags: [
      "Archon Hunts",
      "Eidolon Hunts",
      "Profit-Taker Runs",
      "Exploiter Orb Runs",
      "Steel Path",
      "Circuit",
      "Elite Deep Archimedea (EDA)",
      "Elite Temporal Archimedea (ETA)",
      "Arbitrations",
      "Sorties",
      "Void Fissures",
      "Relic Farming",
      "Duviri",
      "Lich Hunts",
      "Sister Hunts",
      "Coda Hunts",
      "Resource Farming",
      "Decoration",
      "Fashionframe",
      "Trading",
      "Buildcrafting",
      "Loadoutcrafting",
      "Mentoring",
      "Game Events",
      "Clan Events",
      "Clan Challenges",
      "Alliance Events",
      "Alliance Challenges",
      "Conclave",
      "Speedrunning",
      "Level Cap",
      "Endurance Runs",
      "Giveaways",
    ],
  },
];

export const PLAYSTYLES = PLAYSTYLE_GROUPS.flatMap((group) => group.tags);

const PLAYSTYLE_GROUP_BY_TAG = new Map(
  PLAYSTYLE_GROUPS.flatMap((group) => group.tags.map((tag) => [tag, group.id]))
);

// The same tag under a new name. Listings written against the old vocabulary
// keep working - the tag is renamed as it is read and again as it is saved -
// so nobody has to re-tag a post that was already correct.
//
// Tags the new list drops (Nightwave, Railjack, Hardcore, Hunting) are absent
// on purpose: they stop matching filters now and fall off a listing the next
// time it is saved.
export const PLAYSTYLE_ALIASES = new Map([
  ["Archon", "Archon Hunts"],
  ["Eidolon", "Eidolon Hunts"],
  ["Profit-Taker", "Profit-Taker Runs"],
  ["The Circuit", "Circuit"],
  ["EDA", "Elite Deep Archimedea (EDA)"],
  ["Fashion Frame", "Fashionframe"],
  ["Cross-save", "Cross-Save"],
  ["Voice required", "Voice Required"],
]);

export function normalizePlaystyle(tag) {
  const raw = String(tag ?? "").trim();
  return PLAYSTYLE_ALIASES.get(raw) || raw;
}

// The one gate every stored tag list passes through, on the way in and on the
// way out. Renames land, retired tags fall away, duplicates collapse, and the
// order follows the groups so two clans with the same tags show them the same.
export function normalizePlaystyles(list) {
  const seen = new Set();
  for (const tag of Array.isArray(list) ? list : []) {
    const name = normalizePlaystyle(tag);
    if (PLAYSTYLE_GROUP_BY_TAG.has(name)) seen.add(name);
  }
  return PLAYSTYLES.filter((tag) => seen.has(tag));
}

// A tag from a listing the vocabulary no longer knows still has to render, so
// it lands in the last group rather than throwing the chip away.
export function groupOf(tag) {
  return PLAYSTYLE_GROUP_BY_TAG.get(normalizePlaystyle(tag)) || "activities";
}

export const REGIONS = ["North America", "Europe", "South America", "Asia", "Oceania", "Global"];
export const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Russian",
  "Japanese",
  "Korean",
  "Chinese",
];
export const STATUSES = ["Open", "Selective", "Trial Required"];

// How a listing wants to be reached. Shared with the server so validation and
// rendering cannot drift: a listing that hides its Discord button must not be
// forced to supply an invite, and one that hides its whisper must not require a
// verified forum name.
export const CONTACT_MODES = ["both", "discord", "whisper"];
export const CONTACT_LABELS = {
  both: "Discord and in-game whisper",
  discord: "Discord only",
  whisper: "In-game whisper only",
};

export function normalizeContact(value) {
  return CONTACT_MODES.includes(value) ? value : "both";
}

export function wantsDiscord(item) {
  return normalizeContact(item?.contact) !== "whisper";
}

export function wantsWhisper(item) {
  return normalizeContact(item?.contact) !== "discord";
}

// Warframe caps a clan tag at four characters, but leaders decorate them -
// -ONYX-, [ONYX], ~ONYX~ - and the old five-character box silently truncated
// the closing character. Eight fits every decoration anyone has asked for
// without letting a second clan name into the field.
export const TAG_MAX = 8;

// A clan with several contest entries wants to show them all; four is where a
// listing page stops being a post and starts being a playlist.
export const VIDEO_MAX = 4;
export const LINK_MAX = 6;

// Where else a clan lives. The kind is a label and an icon, never a host
// check: a Discord-run clan may put its YouTube behind a Linktree, and
// policing that would reject more real links than fake ones.
export const LINK_KINDS = [
  "Website",
  "YouTube",
  "Twitch",
  "TikTok",
  "X",
  "Instagram",
  "Steam",
  "Reddit",
  "Other",
];

export function normalizeLinkKind(value) {
  const raw = String(value || "").trim();
  const match = LINK_KINDS.find((kind) => kind.toLowerCase() === raw.toLowerCase());
  return match || "Other";
}

// Shared by the composer preview and the server so a link that renders in the
// preview is the same one that gets stored. `safeHref` is the http/https-only
// check the post body already runs every anchor through.
export function normalizeLinks(value, safeHref) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const url = safeHref(row?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ kind: normalizeLinkKind(row?.kind), url });
    if (out.length >= LINK_MAX) break;
  }
  return out;
}

export const TIER_CAPS = {
  Ghost: 10,
  Shadow: 30,
  Storm: 100,
  Mountain: 300,
  Moon: 1000,
};
