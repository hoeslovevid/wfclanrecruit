import test from "node:test";
import assert from "node:assert/strict";
import {
  KEEP_DAYS,
  addStats,
  countView,
  countWhisper,
  drain,
  emptyStats,
  looksLikeBot,
  pendingCount,
  recentStats,
  today,
} from "./stats.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-04T12:00:00Z");

test("counts accumulate in memory and drain once", () => {
  countView("a");
  countView("a");
  countWhisper("a");
  countView("b");
  assert.equal(pendingCount(), 2, "two listings pending");
  const drained = drain();
  assert.deepEqual(drained.get("a"), { views: 2, whispers: 1 });
  assert.deepEqual(drained.get("b"), { views: 1, whispers: 0 });
  assert.equal(pendingCount(), 0, "draining clears the buffer");
  assert.equal(drain().size, 0);
});

test("a listing with only whispers still drains", () => {
  countWhisper("c");
  assert.deepEqual(drain().get("c"), { views: 0, whispers: 1 });
});

test("totals and daily buckets both add up", () => {
  let stats = addStats(emptyStats(), { views: 3, whispers: 1 }, NOW);
  stats = addStats(stats, { views: 2 }, NOW);
  assert.equal(stats.views, 5);
  assert.equal(stats.whispers, 1);
  assert.deepEqual(stats.days[today(NOW)], { views: 5, whispers: 1 });
});

test("buckets older than the window are dropped", () => {
  let stats = addStats(emptyStats(), { views: 1 }, NOW - (KEEP_DAYS + 3) * DAY);
  stats = addStats(stats, { views: 1 }, NOW);
  assert.deepEqual(Object.keys(stats.days), [today(NOW)], "the stale day is gone");
  assert.equal(stats.views, 2, "totals still count it");
});

test("the rolling window only counts recent days", () => {
  let stats = addStats(emptyStats(), { views: 10, whispers: 5 }, NOW - 10 * DAY);
  stats = addStats(stats, { views: 2, whispers: 1 }, NOW - 2 * DAY);
  stats = addStats(stats, { views: 1 }, NOW);
  const week = recentStats(stats, 7, NOW);
  assert.deepEqual({ views: week.views, whispers: week.whispers }, { views: 3, whispers: 1 });
  assert.equal(stats.views, 13, "all-time keeps everything");
});

test("addStats never mutates what it was given", () => {
  const before = addStats(emptyStats(), { views: 1 }, NOW);
  const snapshot = JSON.stringify(before);
  addStats(before, { views: 99 }, NOW);
  assert.equal(JSON.stringify(before), snapshot);
});

test("crawlers and blank agents do not count", () => {
  assert.ok(looksLikeBot("Mozilla/5.0 (compatible; Googlebot/2.1)"));
  assert.ok(looksLikeBot("Discordbot/2.0"));
  assert.ok(looksLikeBot("curl/8.4.0"));
  assert.ok(looksLikeBot(""), "no user agent is not a person");
  assert.ok(looksLikeBot(undefined));
  assert.ok(!looksLikeBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0 Safari/537.36"));
});
