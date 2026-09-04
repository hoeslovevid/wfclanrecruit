// Leaders bump blind: nothing tells them whether a post is working. These are
// the two signals worth having - someone opened the post, and someone copied a
// whisper to send.
//
// Counting straight into the database would undo the write-path work: a view is
// far more frequent than a bump. Counts accumulate in memory and flush on a
// timer instead, so a busy hour costs one write per listing rather than one per
// visitor. A crash loses at most FLUSH_MS of counts, which is the right trade
// for a vanity metric.

export const FLUSH_MS = 60 * 1000;
export const KEEP_DAYS = 14;

const pendingViews = new Map();
const pendingWhispers = new Map();

// Crawlers would drown the numbers. This is not a security control, just enough
// to keep a leader's view count meaningful.
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|discordbot|preview|curl|wget|headless|lighthouse|monitor/i;

export function looksLikeBot(userAgent) {
  return BOT.test(String(userAgent || "")) || !String(userAgent || "").trim();
}

export function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function countView(id) {
  if (id) pendingViews.set(id, (pendingViews.get(id) || 0) + 1);
}

export function countWhisper(id) {
  if (id) pendingWhispers.set(id, (pendingWhispers.get(id) || 0) + 1);
}

// Distinct listings waiting to be written, which is what a flush costs. A
// listing with both a view and a whisper is still one row.
export function pendingCount() {
  return new Set([...pendingViews.keys(), ...pendingWhispers.keys()]).size;
}

export function drain() {
  const out = new Map();
  for (const [id, views] of pendingViews) out.set(id, { views, whispers: 0 });
  for (const [id, whispers] of pendingWhispers) {
    const entry = out.get(id) || { views: 0, whispers: 0 };
    entry.whispers += whispers;
    out.set(id, entry);
  }
  pendingViews.clear();
  pendingWhispers.clear();
  return out;
}

export function emptyStats() {
  return { views: 0, whispers: 0, days: {} };
}

// Totals plus a rolling window of days, so "this week" stays answerable without
// storing a row per visit.
export function addStats(stats, { views = 0, whispers = 0 }, now = Date.now()) {
  const next = {
    views: (stats?.views || 0) + views,
    whispers: (stats?.whispers || 0) + whispers,
    days: { ...(stats?.days || {}) },
  };
  const key = today(now);
  const day = next.days[key] || { views: 0, whispers: 0 };
  next.days[key] = { views: day.views + views, whispers: day.whispers + whispers };
  const cutoff = today(now - KEEP_DAYS * 24 * 60 * 60 * 1000);
  for (const date of Object.keys(next.days)) {
    if (date < cutoff) delete next.days[date];
  }
  return next;
}

export function recentStats(stats, days = 7, now = Date.now()) {
  const cutoff = today(now - (days - 1) * 24 * 60 * 60 * 1000);
  let views = 0;
  let whispers = 0;
  for (const [date, day] of Object.entries(stats?.days || {})) {
    if (date < cutoff) continue;
    views += day.views || 0;
    whispers += day.whispers || 0;
  }
  return { views, whispers, days };
}
