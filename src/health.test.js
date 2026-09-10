import test from "node:test";
import assert from "node:assert/strict";
import { listingIssues, msUntilStale, needsBumpSoon, STALE_WARN_MS } from "./health.js";
import { STALE_AFTER_MS } from "../server/listing.js";

const DAY = 24 * 60 * 60 * 1000;

test("a listing inside the warn window needs a bump soon", () => {
  const now = Date.parse("2026-09-09T00:00:00.000Z");
  const item = { bumpedAt: new Date(now - (STALE_AFTER_MS - STALE_WARN_MS / 2)).toISOString() };
  assert.equal(needsBumpSoon(item, now), true);
  assert.ok(msUntilStale(item, now) <= STALE_WARN_MS);
});

test("listingIssues names a dead invite, a missing image, and a coming stale date", () => {
  const now = Date.parse("2026-09-09T00:00:00.000Z");
  const item = {
    inviteOk: false,
    image: "",
    recruiting: true,
    roles: [],
    bumpedAt: new Date(now - (STALE_AFTER_MS - DAY)).toISOString(),
  };
  const issues = listingIssues(item, "clan", now);
  assert.ok(issues.some((line) => /invite failed/i.test(line)));
  assert.ok(issues.some((line) => /no listing image/i.test(line)));
  assert.ok(issues.some((line) => /goes stale in 1 day/i.test(line)));
});
