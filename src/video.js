// Listings used to carry an uploaded MP4. Serving those cost real egress on
// every view - a 25 MB clip on a popular post is measured in gigabytes a week -
// so a post now stores an eleven-character YouTube id and the browser fetches
// the video from Google instead.
//
// The id is the whole of what we trust. Everything a leader pastes is reduced
// to one here or rejected outright, so nothing downstream has to wonder whether
// a stored value is a URL, a scheme, or an attack.

const ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

// /shorts/<id>, /embed/<id>, /v/<id>, /live/<id> - the forms that carry the id
// in the path rather than the query.
const PATH_PREFIXES = ["shorts", "embed", "v", "live"];

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function parseYouTubeId(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  // Already stored, or pasted bare. Editing a listing round-trips this value.
  if (ID.test(raw)) return raw;

  // A javascript: or data: payload must never reach the URL parser's more
  // forgiving corners, and a bare youtube.com/... needs a scheme to parse.
  if (SCHEME.test(raw) && !/^https?:/i.test(raw)) return null;

  let url;
  try {
    url = new URL(SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const candidate =
    url.hostname.toLowerCase().endsWith("youtu.be")
      ? segments[0]
      : segments.length === 2 && PATH_PREFIXES.includes(segments[0])
        ? segments[1]
        : url.searchParams.get("v");

  return ID.test(String(candidate || "")) ? candidate : null;
}

export function youTubeEmbedUrl(id) {
  return ID.test(String(id || "")) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

export { ID as YOUTUBE_ID };

// The upload path is gone, so a stored "/uploads/....mp4" can never play again.
// Clear it wherever it survives and hand back the files so the caller can
// reclaim the volume. Idempotent: a second sweep finds nothing.
export function dropLegacyVideos(listings = []) {
  const files = [];
  for (const item of listings || []) {
    if (typeof item?.video === "string" && item.video.startsWith("/uploads/")) {
      files.push(item.video);
      item.video = null;
    }
  }
  return files;
}
