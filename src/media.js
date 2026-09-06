// A listing's media strip used to be YouTube ids and nothing else. It now
// carries images too, so everything downstream reads one ordered list of
// entries rather than a video array: { kind: "video", id } or
// { kind: "image", url }.
//
// Images arrive two ways. An upload lands on our own volume, gets resized to a
// ~100 KB WebP, and is ours to moderate and delete. A pasted link is somebody
// else's file on somebody else's host, so it is allowlisted rather than
// trusted - see IMAGE_HOSTS below.

import { YOUTUBE_ID, parseYouTubeId } from "./video.js";

export const MEDIA_MAX = 8;
export const VIDEO_MAX = 4;

// Hosts that serve images to third parties and are stable about it. An
// unlisted host is refused with its name, so a leader knows to rehost rather
// than wondering why nothing appeared.
export const IMAGE_HOSTS = new Set([
  "i.imgur.com",
  "imgur.com",
  "i.ibb.co",
  "ibb.co",
  "i.postimg.cc",
  "postimg.cc",
  "i.redd.it",
  "preview.redd.it",
  "steamuserimages-a.akamaihd.net",
  "i.ytimg.com",
  "pbs.twimg.com",
  "media.tenor.com",
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
]);

// Discord signs its attachment URLs and expires them within about a day. A
// clan leader's first instinct is to paste one, and the gallery would look
// fine right up until it silently emptied, so this is refused by name.
const EXPIRING_HOSTS = new Map([
  ["cdn.discordapp.com", "Discord"],
  ["media.discordapp.net", "Discord"],
]);

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;

export function isUploadedImage(url) {
  return typeof url === "string" && url.startsWith("/uploads/");
}

// Our own uploads are trusted because we wrote them. Everything else has to
// clear the allowlist and look like an image.
export function parseImageUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { error: "Paste an image link, or upload a file." };
  if (isUploadedImage(raw)) return { url: raw };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "That is not a link." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Image links must start with http:// or https://." };
  }

  const host = url.hostname.toLowerCase();
  const expiring = EXPIRING_HOSTS.get(host);
  if (expiring) {
    return {
      error: `${expiring} links expire after about a day, so the image would vanish. Upload the file here instead.`,
    };
  }
  if (!IMAGE_HOSTS.has(host)) {
    return { error: `${host} is not on the image host list. Upload the file here instead.` };
  }
  if (!IMAGE_EXT.test(url.pathname)) {
    return { error: "That link does not point at an image file." };
  }
  return { url: url.href };
}

function entryKey(entry) {
  return entry.kind === "video" ? `v:${entry.id}` : `i:${entry.url}`;
}

// The single gate every stored media list goes through. Order is the leader's;
// duplicates, unknown kinds and anything past the caps fall out.
export function normalizeMedia(rows) {
  const out = [];
  const seen = new Set();
  let videos = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (out.length >= MEDIA_MAX) break;
    let entry = null;
    if (row?.kind === "video") {
      if (videos >= VIDEO_MAX) continue;
      const id = parseYouTubeId(row.id);
      if (!id) continue;
      entry = { kind: "video", id };
    } else if (row?.kind === "image") {
      const parsed = parseImageUrl(row.url);
      if (parsed.error) continue;
      entry = { kind: "image", url: parsed.url };
    }
    if (!entry) continue;
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.kind === "video") videos += 1;
    out.push(entry);
  }
  return out;
}

// Listings written before the strip took images hold `videos` (or a single
// legacy `video`). They read back as a video-only media list, so nothing has to
// migrate - the same trick videoList() plays for the field it replaced.
export function mediaList(item) {
  if (Array.isArray(item?.media) && item.media.length) return normalizeMedia(item.media);
  const legacy = Array.isArray(item?.videos) && item.videos.length ? item.videos : [item?.video];
  return legacy
    .filter((id) => YOUTUBE_ID.test(String(id || "")))
    .slice(0, VIDEO_MAX)
    .map((id) => ({ kind: "video", id }));
}

export function videoIdsOf(media) {
  return media.filter((entry) => entry.kind === "video").map((entry) => entry.id);
}

// Every uploaded file a listing still points at. Updating a listing deletes the
// ones that fell out, so removing an image from the strip reclaims the volume.
export function uploadedUrls(media) {
  return media.filter((entry) => entry.kind === "image" && isUploadedImage(entry.url)).map((e) => e.url);
}
