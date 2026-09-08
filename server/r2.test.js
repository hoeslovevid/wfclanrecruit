import test from "node:test";
import assert from "node:assert/strict";
import {
  joinPublicUrl,
  publicBaseUrl,
  splitBucket,
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

test("a plain bucket name is left alone and brings no endpoint with it", () => {
  assert.deepEqual(splitBucket("wfclanrecruit-images"), { bucket: "wfclanrecruit-images", endpoint: "" });
  assert.deepEqual(splitBucket("  spaced-name/  "), { bucket: "spaced-name", endpoint: "" });
  assert.deepEqual(splitBucket(""), { bucket: "", endpoint: "" });
  assert.deepEqual(splitBucket(undefined), { bucket: "", endpoint: "" });
});

test("a bucket pasted as the whole S3 URL yields the name and the endpoint", () => {
  assert.deepEqual(splitBucket("https://abc123.r2.cloudflarestorage.com/wfclanrecruit-images"), {
    bucket: "wfclanrecruit-images",
    endpoint: "https://abc123.r2.cloudflarestorage.com",
  });
  assert.deepEqual(splitBucket("https://abc123.r2.cloudflarestorage.com/wfclanrecruit-images/"), {
    bucket: "wfclanrecruit-images",
    endpoint: "https://abc123.r2.cloudflarestorage.com",
  });
});

test("a URL with no bucket on the end of it stays unconfigured", () => {
  assert.deepEqual(splitBucket("https://abc123.r2.cloudflarestorage.com"), {
    bucket: "",
    endpoint: "https://abc123.r2.cloudflarestorage.com",
  });
});

test("the endpoint follows the bucket URL, and R2_ENDPOINT still wins", () => {
  const saved = { ...process.env };
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "id";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_PUBLIC_URL = BASE;
  delete process.env.R2_ENDPOINT;

  process.env.R2_BUCKET = "photos";
  assert.equal(r2Config().bucket, "photos");
  assert.equal(r2Config().endpoint, "https://acct.r2.cloudflarestorage.com");

  process.env.R2_BUCKET = "https://acct.r2.cloudflarestorage.com/photos";
  assert.equal(r2Config().bucket, "photos");
  assert.equal(r2Config().endpoint, "https://acct.r2.cloudflarestorage.com");

  process.env.R2_ENDPOINT = "https://custom.example.com";
  assert.equal(r2Config().endpoint, "https://custom.example.com");

  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

test("a public host pasted without its scheme gets one", () => {
  assert.equal(publicBaseUrl("media.example.com"), "https://media.example.com");
  assert.equal(publicBaseUrl("media.example.com/"), "https://media.example.com");
  assert.equal(publicBaseUrl(" https://media.example.com "), "https://media.example.com");
  assert.equal(publicBaseUrl("http://media.example.com"), "http://media.example.com");
  assert.equal(publicBaseUrl(""), "");
});

test("a stored URL still maps back to its key when the host was pasted bare", () => {
  const saved = { ...process.env };
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "id";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_BUCKET = "photos";
  process.env.R2_PUBLIC_URL = "media.example.com";
  assert.equal(r2PublicUrl(), "https://media.example.com");
  assert.equal(
    keyFromPublicUrl("https://media.example.com/listings/1700000000000-abcdef123456.webp"),
    "listings/1700000000000-abcdef123456.webp"
  );
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});
