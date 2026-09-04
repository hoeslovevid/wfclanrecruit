// #5: fixed-window limiter kept in memory. Single-instance only, and it resets
// on restart, which is fine for slowing credential guessing and upstream abuse.
const buckets = new Map();

const SWEEP_MS = 10 * 60 * 1000;
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_MS);
sweep.unref();

// req.ip is not the caller behind Railway's edge: "trust proxy" is 1, so
// Express resolves it to the edge node, and those rotate per request
// (152.233.40.2 then .1 for two back-to-back calls), which put every request
// in its own bucket and stopped the limiter from ever counting.
//
// Railway overwrites x-real-ip and x-forwarded-for on the way in - a request
// sending its own values gets them discarded - so x-real-ip is the caller's
// true address and is not client-controllable. Fall back to req.ip where the
// header is absent, such as local dev, rather than to a spoofable header.
export function clientIp(req) {
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  if (realIp) return realIp;
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function hit(key, limit, windowMs) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * @param {object} options
 * @param {string} options.name   bucket namespace
 * @param {number} options.limit  requests allowed per window
 * @param {number} options.windowMs
 * @param {(req: import("express").Request) => string} [options.keyOn] extra key part
 * @param {string} [options.message]
 */
export function rateLimit({ name, limit, windowMs, keyOn, message }) {
  return (req, res, next) => {
    const extra = keyOn ? keyOn(req) : "";
    const result = hit(`${name}:${clientIp(req)}:${extra}`, limit, windowMs);
    if (!result.ok) {
      res.setHeader("Retry-After", String(result.retryAfter));
      res.status(429).json({ error: message || "Too many requests. Try again shortly." });
      return;
    }
    next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}
