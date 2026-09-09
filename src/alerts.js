import { plainTextFromHtml } from "./richtext.js";

export const ALERTS_KEY = "wfr-alerts";
const DEFAULTS = { sound: true, desktop: false };

let audioCtx = null;

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

export function loadAlertPrefs(storage) {
  try {
    const raw = storageOf(storage)?.getItem?.(ALERTS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      sound: parsed.sound !== false,
      desktop: parsed.desktop === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAlertPrefs(prefs, storage) {
  const next = {
    sound: Boolean(prefs?.sound),
    desktop: Boolean(prefs?.desktop),
  };
  try {
    storageOf(storage)?.setItem?.(ALERTS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

export function notificationAllowed(notify = globalThis.Notification) {
  return Boolean(notify) && notify.permission === "granted";
}

export function notificationAvailable(notify = globalThis.Notification) {
  return typeof notify === "function";
}

// What to do with one incoming message in this tab. Claiming the alert is
// separate: a tab that already has the thread open and visible eats the lock
// so a background copy of the site does not also ping.
export function alertPlan({ viewing = false, visible = false, prefs = DEFAULTS, canDesktop = false } = {}) {
  if (viewing) {
    return { claim: Boolean(visible), sound: false, desktop: false };
  }
  const desktop = !visible && Boolean(prefs.desktop) && Boolean(canDesktop);
  return {
    claim: true,
    sound: desktop ? false : Boolean(prefs.sound),
    desktop,
  };
}

export function notificationBody(message, max = 80) {
  const text = plainTextFromHtml(
    String(message?.body || "").replace(/<img\b[^>]*\bdata-emoji\b[^>]*>/gi, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Sent a message.";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function messageAlertHref(message) {
  const id = String(message?.threadId || "");
  return id ? `/messages?thread=${encodeURIComponent(id)}` : "/messages";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function claimAlert(id, { visible = false, delayHidden = 50, locks } = {}) {
  const key = `wfr-alert-${id || "msg"}`;
  if (!visible) await wait(delayHidden);
  const api = locks || globalThis.navigator?.locks;
  if (api?.request) {
    return new Promise((resolve) => {
      api.request(key, { ifAvailable: true }, (lock) => {
        resolve(Boolean(lock));
        if (lock) return wait(1500);
      });
    });
  }
  try {
    const store = globalThis.localStorage;
    if (store.getItem(key)) return false;
    store.setItem(key, "1");
    setTimeout(() => store.removeItem(key), 8000);
    return true;
  } catch {
    return true;
  }
}

export function getAudioContext() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

export function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Two short tones, quiet on purpose. A file would have to download; this is
// the same idea as a system ping without shipping an asset.
export function playPing() {
  const ctx = unlockAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  gain.connect(ctx.destination);
  for (const [start, freq] of [
    [0, 880],
    [0.08, 1320],
  ]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + start);
    osc.connect(gain);
    osc.start(now + start);
    osc.stop(now + start + 0.12);
  }
}

export function showMessageNotification(message, { onOpen, notify = globalThis.Notification } = {}) {
  if (!notificationAllowed(notify)) return null;
  const who = message?.from?.name || "Someone";
  const href = messageAlertHref(message);
  const n = new notify(`${who} sent a message`, {
    body: notificationBody(message),
    icon: "/favicon.png",
    tag: `wfr-thread-${message?.threadId || message?.id || "inbox"}`,
    data: { href },
  });
  n.onclick = () => {
    try {
      globalThis.focus?.();
    } catch {
      /* ignore */
    }
    onOpen?.(href);
    n.close();
  };
  return n;
}

export async function requestDesktopPermission(notify = globalThis.Notification) {
  if (!notificationAvailable(notify)) return false;
  if (notify.permission === "granted") return true;
  if (notify.permission === "denied") return false;
  try {
    const result = await notify.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}
