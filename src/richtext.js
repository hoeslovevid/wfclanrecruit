const ABOUT_MAX = 4000;
const PLAIN_MAX = 1500;
const VOID = new Set(["br"]);
const SKIP = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "svg"]);
const ALLOWED = {
  p: new Set(),
  div: new Set(),
  br: new Set(),
  strong: new Set(),
  b: new Set(),
  em: new Set(),
  i: new Set(),
  u: new Set(),
  ul: new Set(),
  ol: new Set(),
  li: new Set(),
  a: new Set(["href"]),
  span: new Set(["data-video"]),
};

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isSafeHref(value) {
  const href = String(value || "").trim();
  if (!href) return null;
  const lower = href.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return null;
  }
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseAttrs(raw, allowed) {
  const out = [];
  const re = /([:@a-zA-Z0-9_-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|(\S+)))?/g;
  let match;
  while ((match = re.exec(raw || ""))) {
    const name = match[1].toLowerCase();
    if (name.startsWith("on") || name.startsWith("xmlns") || !allowed.has(name)) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (name === "href") {
      const safe = isSafeHref(value);
      if (safe) {
        out.push(["href", safe], ["target", "_blank"], ["rel", "noopener noreferrer"]);
      }
      continue;
    }
    if (name === "data-video") out.push(["data-video", ""]);
  }
  return out;
}

function formatAttrs(attrs) {
  if (!attrs.length) return "";
  return ` ${attrs
    .map(([name, value]) => (value === "" ? name : `${name}="${escapeHtml(value)}"`))
    .join(" ")}`;
}

export function sanitizePostHtml(input) {
  const source = String(input || "");
  let i = 0;
  let out = "";
  const stack = [];
  let videoSeen = false;

  while (i < source.length) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i);
      const text = source.slice(i, next === -1 ? source.length : next);
      out += escapeHtml(decodeEntities(text));
      i = next === -1 ? source.length : next;
      continue;
    }

    const end = source.indexOf(">", i);
    if (end === -1) {
      out += escapeHtml(source.slice(i));
      break;
    }

    const token = source.slice(i + 1, end).trim();
    i = end + 1;
    if (!token || token.startsWith("!") || token.startsWith("?")) continue;

    const isClose = token.startsWith("/");
    const nameMatch = token.match(/^\/?([a-z0-9]+)/i);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();

    if (SKIP.has(tag)) {
      if (!isClose && !token.endsWith("/")) {
        const close = source.toLowerCase().indexOf(`</${tag}`, i);
        i = close === -1 ? source.length : source.indexOf(">", close) + 1;
      }
      continue;
    }

    if (!ALLOWED[tag]) continue;

    if (isClose) {
      const idx = stack.lastIndexOf(tag);
      if (idx === -1) continue;
      while (stack.length > idx) {
        const open = stack.pop();
        if (!VOID.has(open)) out += `</${open}>`;
      }
      continue;
    }

    const selfClosing = token.endsWith("/") || VOID.has(tag);
    const attrRaw = token.slice(nameMatch[0].length).replace(/\/$/, "");
    let attrs = parseAttrs(attrRaw, ALLOWED[tag]);

    if (tag === "a" && !attrs.some(([name]) => name === "href")) continue;
    if (tag === "span") {
      if (!attrs.some(([name]) => name === "data-video") || videoSeen) continue;
      videoSeen = true;
      attrs = [["data-video", ""]];
    }

    out += `<${tag}${formatAttrs(attrs)}${VOID.has(tag) ? "" : ""}>`;
    if (selfClosing) continue;
    stack.push(tag);
  }

  while (stack.length) {
    const open = stack.pop();
    if (!VOID.has(open)) out += `</${open}>`;
  }

  return out.slice(0, ABOUT_MAX);
}

export function toEditorHtml(value) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  if (/<(p|br|strong|b|em|i|u|ul|ol|li|a|span|div)\b/i.test(raw)) {
    return sanitizePostHtml(raw.replace(/\[video\]/gi, '<span data-video></span>'));
  }
  return sanitizePostHtml(
    escapeHtml(raw)
      .replace(/\[video\]/gi, '<span data-video></span>')
      .replace(/\r\n|\n|\r/g, "<br>")
  );
}

export function plainTextFromHtml(html) {
  return String(html || "")
    .replace(/<span\b[^>]*\bdata-video\b[^>]*>[\s\S]*?<\/span>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeAbout(value) {
  const html = toEditorHtml(value);
  if (html.length > ABOUT_MAX) return html.slice(0, ABOUT_MAX);
  return html;
}

export function aboutTooLong(html) {
  if (String(html || "").length > ABOUT_MAX) return "The full post is too long.";
  if (plainTextFromHtml(html).length > PLAIN_MAX) return "The full post is too long.";
  return null;
}

const VIDEO_MARK = /<span\b[^>]*\bdata-video\b[^>]*>([\s\S]*?)<\/span>/i;

export function splitVideoHtml(html) {
  const source = String(html || "");
  const match = source.match(VIDEO_MARK);
  if (!match) return { before: source, after: "", hasMarker: false };
  const index = match.index ?? 0;
  return {
    before: source.slice(0, index),
    after: source.slice(index + match[0].length),
    hasMarker: true,
  };
}

export { ABOUT_MAX, PLAIN_MAX };
