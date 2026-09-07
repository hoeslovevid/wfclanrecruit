import fs from "node:fs/promises";
import path from "node:path";

const KEY_OK = /^[0-9]+-[a-f0-9]+\.(webp|png|jpe?g|gif)$/i;
const PREFIX = "listings/";

let clientLoader = null;

export function r2Config() {
  const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(process.env.R2_BUCKET || "").trim();
  const publicBase = String(process.env.R2_PUBLIC_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBase };
}

export function r2Enabled() {
  return Boolean(r2Config());
}

export function r2PublicUrl() {
  return r2Config()?.publicBase || "";
}

export function r2PartialEnv() {
  const keys = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"];
  const present = keys.filter((key) => String(process.env[key] || "").trim());
  if (!present.length || present.length === keys.length) return [];
  return keys.filter((key) => !String(process.env[key] || "").trim());
}

export function joinPublicUrl(base, key) {
  return `${String(base || "").replace(/\/$/, "")}/${String(key || "").replace(/^\//, "")}`;
}

export function objectKey(filename) {
  const base = path.basename(String(filename || ""));
  if (!KEY_OK.test(base)) return null;
  return `${PREFIX}${base}`;
}

export function keyFromPublicUrl(url, base = r2PublicUrl()) {
  if (!base || typeof url !== "string") return null;
  const prefix = `${base.replace(/\/$/, "")}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  if (!key.startsWith(PREFIX) || key.includes("..") || key.includes("\\")) return null;
  const name = key.slice(PREFIX.length);
  if (!KEY_OK.test(name) || name.includes("/")) return null;
  return key;
}

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "image/webp";
}

async function loadClient() {
  const cfg = r2Config();
  if (!cfg) return null;
  if (!clientLoader) {
    clientLoader = import("@aws-sdk/client-s3")
      .then(({ S3Client }) => {
        const endpoint =
          String(process.env.R2_ENDPOINT || "").trim() || `https://${cfg.accountId}.r2.cloudflarestorage.com`;
        return new S3Client({
          region: "auto",
          endpoint,
          forcePathStyle: true,
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
          credentials: {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
          },
        });
      })
      .catch((error) => {
        console.warn("Cloudflare R2 client failed to load:", error.message);
        return null;
      });
  }
  return clientLoader;
}

export async function putR2Object(filename, body) {
  const cfg = r2Config();
  const key = objectKey(filename);
  if (!cfg || !key) return null;
  const client = await loadClient();
  if (!client) return null;
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(filename),
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return joinPublicUrl(cfg.publicBase, key);
}

export async function deleteR2Object(url) {
  const cfg = r2Config();
  const key = keyFromPublicUrl(url, cfg?.publicBase);
  if (!cfg || !key) return false;
  const client = await loadClient();
  if (!client) return false;
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  return true;
}

export async function readLocalFile(filePath) {
  return fs.readFile(filePath);
}
