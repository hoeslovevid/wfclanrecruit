import test from "node:test";
import assert from "node:assert/strict";
import {
  joinPublicUrl,
  keyFromPublicUrl,
  objectKey,
  r2Config,
  r2Enabled,
  r2PartialEnv,
  r2PublicUrl,
} from "./r2.js";

const BASE = "https://media.example.com";

test("R2 stays off until every env var is set", () => {
  const saved = { ...process.env };
  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"]) {
    delete process.env[key];
  }
  assert.equal(r2Enabled(), false);
  assert.equal(r2PublicUrl(), "");
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_BUCKET = "photos";
  assert.deepEqual(r2PartialEnv(), ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_URL"]);
  process.env.R2_ACCESS_KEY_ID = "id";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_PUBLIC_URL = `${BASE}/`;
  assert.equal(r2Enabled(), true);
  assert.equal(r2Config().publicBase, BASE);
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("object keys are listings/<timestamp>-<hex>.ext and nothing else", () => {
  assert.equal(objectKey("1736150400000-aabbccddeeff.webp"), "listings/1736150400000-aabbccddeeff.webp");
  assert.equal(objectKey("/tmp/1736150400000-aabbccddeeff.png"), "listings/1736150400000-aabbccddeeff.png");
  assert.equal(objectKey("listings/../secret.webp"), null);
  assert.equal(objectKey("note.txt"), null);
  assert.equal(objectKey("gallery.webp"), null);
});

test("a public URL only maps back to a key under our host and prefix", () => {
  const url = joinPublicUrl(BASE, "listings/1736150400000-aabbccddeeff.webp");
  assert.equal(url, `${BASE}/listings/1736150400000-aabbccddeeff.webp`);
  assert.equal(keyFromPublicUrl(url, BASE), "listings/1736150400000-aabbccddeeff.webp");
  assert.equal(keyFromPublicUrl(`${BASE}/listings/../passwd`, BASE), null);
  assert.equal(keyFromPublicUrl("https://evil.test/listings/1736150400000-aabbccddeeff.webp", BASE), null);
  assert.equal(keyFromPublicUrl("/uploads/1736150400000-aabbccddeeff.webp", BASE), null);
});
