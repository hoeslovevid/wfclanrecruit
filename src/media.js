// A listing's media strip used to be YouTube ids and nothing else. It now
// carries images too, so everything downstream reads one ordered list of
// entries rather than a video array: { kind: "video", id } or
// { kind: "image", url }.
//
// Images arrive two ways. An upload is resized to a ~100 KB WebP and stored
// either on this host at /uploads/ or, when R2 is configured, on Cloudflare R2
// at the public media URL. A pasted link is somebody else's file on somebody
// else's host, so it is allowlisted rather than trusted - see IMAGE_HOSTS below.

import { YOUTUBE_ID, parseYouTubeId } from "./video.js";

// The upload cap, shared so the composer refuses a file the server would
// only reject after the wait.
export const IMAGE_MAX = 2 * 1024 * 1024;

export const MEDIA_MAX = 8;
export const VIDEO_MAX = 4;

// Pasting an image from someone else's host is switched off. Uploading is the
// only way an image joins a strip, so every image on the board is one we
// resized, one we can moderate, and one that cannot expire, get swapped after
// approval, or leak a visitor's IP to a third party.
//
// The allowlist below is kept, not deleted: turning pasting back on is this
// flag, and hosts a leader asks for go in the set. Videos are unaffected -
// those are YouTube links by nature and always were.
export const ALLOW_PASTED_IMAGES = false;

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
// clan leader's first instinct is to paste one, so it keeps its own message
// even while pasting is off - "upload it instead" is the same advice either
// way, but knowing why saves a support round trip.
const EXPIRING_HOSTS = new Map([
  ["cdn.discordapp.com", "Discord"],
  ["media.discordapp.net", "Discord"],
]);

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;

// The browser copy of this module cannot read R2 secrets. The server tells it
// the public media origin on /api/auth/me; tests and Node call this directly.
let uploadPublicBase = "";

export function setUploadPublicBase(url) {
  uploadPublicBase = String(url || "").replace(/\/$/, "");
}

export function getUploadPublicBase() {
  return uploadPublicBase;
}

function hostOf(raw) {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isUploadedImage(url) {
  if (typeof url !== "string" || !url) return false;
  if (url.startsWith("/uploads/")) return true;
  if (!uploadPublicBase) return false;
  try {
    const href = new URL(url);
    const base = new URL(uploadPublicBase);
    if (href.origin !== base.origin) return false;
    const prefix = base.pathname === "/" ? "/listings/" : `${base.pathname.replace(/\/$/, "")}/`;
    return href.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

// Our own uploads are trusted because we wrote them. Everything else has to
// clear the allowlist and look like an image.
export function parseImageUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { error: "Upload an image file." };
  if (isUploadedImage(raw)) return { url: raw };

  if (!ALLOW_PASTED_IMAGES) {
    const host = hostOf(raw);
    const expiring = host && EXPIRING_HOSTS.get(host);
    if (expiring) {
      return { error: `${expiring} links expire after about a day. Use Upload an image instead.` };
    }
    return { error: "Use Upload an image for pictures. Links are for YouTube videos." };
  }

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
// ones that fell out, so removing an image from the strip reclaims storage.
export function uploadedUrls(media) {
  return media.filter((entry) => entry.kind === "image" && isUploadedImage(entry.url)).map((e) => e.url);
}
