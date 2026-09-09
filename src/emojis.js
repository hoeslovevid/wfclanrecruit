// A short, opinionated set for the message picker — not the whole Unicode
// table. Faces and a few Warframe-adjacent marks cover what people actually
// tap in a recruit chat.
export const UNICODE_GROUPS = [
  {
    id: "faces",
    label: "Faces",
    chars: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
      "🙂", "😉", "😍", "🥰", "😘", "😜", "🤪", "😎", "🤩", "🥳",
      "😏", "😒", "🙄", "😬", "😔", "😢", "😭", "😤", "😡", "🤯",
      "😳", "🥺", "😱", "🤔", "🤫", "😴", "💀", "🤡",
    ],
  },
  {
    id: "hands",
    label: "Hands",
    chars: [
      "👍", "👎", "👏", "🙌", "👋", "🤝", "✌️", "🤞", "👊", "💪",
      "🙏", "🫡", "🫶", "👀", "🧠",
    ],
  },
  {
    id: "hearts",
    label: "Hearts",
    chars: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "✨", "🔥", "💯"],
  },
  {
    id: "game",
    label: "Game",
    chars: [
      "🎮", "⚔️", "🛡️", "🗡️", "🏹", "🪄", "🌙", "☀️", "⭐", "🌟",
      "💫", "🌌", "🪐", "🧿", "🪷", "🐸", "🐺", "🦊", "🐱", "🚀",
    ],
  },
];

export const EMOJI_NAME_MAX = 24;
export const CUSTOM_EMOJI_MAX = 40;

export function normalizeEmojiName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, EMOJI_NAME_MAX);
}

export function emojiNameError(name) {
  if (!/^[a-z0-9_]{2,24}$/.test(name)) {
    return "Use 2–24 letters, numbers, or underscores. That becomes :name: in chat.";
  }
  return null;
}

export function publicEmoji(item) {
  return {
    id: item.id,
    name: item.name,
    url: item.url,
  };
}

export function addEmojiError(emojis, name) {
  const named = normalizeEmojiName(name);
  const problem = emojiNameError(named);
  if (problem) return problem;
  if ((emojis || []).some((item) => item.name === named)) {
    return "That name is already in use.";
  }
  if ((emojis || []).length >= CUSTOM_EMOJI_MAX) {
    return `The board can hold ${CUSTOM_EMOJI_MAX} custom emojis.`;
  }
  return null;
}

export function findEmoji(emojis, id) {
  return (emojis || []).find((item) => item.id === id) || null;
}
