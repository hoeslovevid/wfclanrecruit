export const PLATFORMS = ["All Platforms", "PC", "PlayStation", "Xbox", "Nintendo Switch", "Mobile"];
export const TIERS = ["Ghost", "Shadow", "Storm", "Mountain", "Moon"];

// One flat list read very differently by three kinds of recruit: how hard the
// clan plays, what it is like to sit in, and which content it actually runs.
// The grouping is presentation only - a listing still stores `playstyles` as a
// flat array of these strings, so nothing has to migrate when this list moves.
export const PLAYSTYLE_GROUPS = [
  {
    id: "playstyle",
    label: "Playstyle",
    hint: "How hard the clan plays",
    tags: ["Casual", "Hardcore", "Endgame", "Steel Path"],
  },
  {
    id: "social",
    label: "Social",
    hint: "What it is like to be in",
    tags: [
      "New Player Friendly",
      "Social",
      "Voice required",
      "18+",
      "Cross-save",
      "Trading",
      "Fashion Frame",
    ],
  },
  {
    id: "content",
    label: "Content",
    hint: "What the clan runs together",
    tags: ["Archon", "Eidolon", "Profit-Taker", "The Circuit", "EDA", "Hunting", "Nightwave", "Railjack"],
  },
];

export const PLAYSTYLES = PLAYSTYLE_GROUPS.flatMap((group) => group.tags);

const PLAYSTYLE_GROUP_BY_TAG = new Map(
  PLAYSTYLE_GROUPS.flatMap((group) => group.tags.map((tag) => [tag, group.id]))
);

// A listing posted before a tag was moved - or before this grouping existed -
// still renders, it just lands in the content bucket.
export function groupOf(tag) {
  return PLAYSTYLE_GROUP_BY_TAG.get(tag) || "content";
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
