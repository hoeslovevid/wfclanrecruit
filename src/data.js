export const PLATFORMS = ["All Platforms", "PC", "PlayStation", "Xbox", "Nintendo Switch", "Mobile"];
export const TIERS = ["Ghost", "Shadow", "Storm", "Mountain", "Moon"];
export const PLAYSTYLES = [
  "Casual",
  "Hardcore",
  "Steel Path",
  "New Player Friendly",
  "Endgame",
  "Archon",
  "Eidolon",
  "Profit-Taker",
  "The Circuit",
  "EDA",
  "Hunting",
  "Trading",
  "Fashion Frame",
  "Social",
  "Nightwave",
  "Railjack",
  "Voice required",
  "18+",
  "Cross-save",
];
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

export const TIER_CAPS = {
  Ghost: 10,
  Shadow: 30,
  Storm: 100,
  Mountain: 300,
  Moon: 1000,
};
