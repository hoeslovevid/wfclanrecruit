import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERTS_KEY,
  alertPlan,
  loadAlertPrefs,
  messageAlertHref,
  notificationBody,
  saveAlertPrefs,
} from "./alerts.js";

function memoryStore(start = {}) {
  const data = { ...start };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

test("alert prefs default to a sound ping and no desktop alert", () => {
  assert.deepEqual(loadAlertPrefs(memoryStore()), { sound: true, desktop: false });
});

test("alert prefs round-trip through local storage", () => {
  const store = memoryStore();
  saveAlertPrefs({ sound: false, desktop: true }, store);
  assert.equal(JSON.parse(store.getItem(ALERTS_KEY)).desktop, true);
  assert.deepEqual(loadAlertPrefs(store), { sound: false, desktop: true });
});

test("a visible open thread claims the ping so another tab stays quiet", () => {
  assert.deepEqual(
    alertPlan({ viewing: true, visible: true, prefs: { sound: true, desktop: true }, canDesktop: true }),
    { claim: true, sound: false, desktop: false }
  );
});

test("a hidden open thread leaves the ping for a tab the person can see", () => {
  assert.deepEqual(
    alertPlan({ viewing: true, visible: false, prefs: { sound: true, desktop: true }, canDesktop: true }),
    { claim: false, sound: false, desktop: false }
  );
});

test("a visible tab that is not in the thread plays the sound", () => {
  assert.deepEqual(
    alertPlan({ viewing: false, visible: true, prefs: { sound: true, desktop: true }, canDesktop: true }),
    { claim: true, sound: true, desktop: false }
  );
});

test("a hidden tab uses a desktop alert when that is allowed", () => {
  assert.deepEqual(
    alertPlan({ viewing: false, visible: false, prefs: { sound: true, desktop: true }, canDesktop: true }),
    { claim: true, sound: false, desktop: true }
  );
});

test("a hidden tab with no desktop permission still plays the sound", () => {
  assert.deepEqual(
    alertPlan({ viewing: false, visible: false, prefs: { sound: true, desktop: true }, canDesktop: false }),
    { claim: true, sound: true, desktop: false }
  );
});

test("notification copy is readable text, not markup", () => {
  assert.equal(notificationBody({ body: "<strong>hello</strong> there" }), "hello there");
  assert.equal(notificationBody({ body: `<img data-emoji="emoji-1">` }), "Sent a message.");
  assert.equal(messageAlertHref({ threadId: "clan:steel:a:b" }), "/messages?thread=clan%3Asteel%3Aa%3Ab");
});
