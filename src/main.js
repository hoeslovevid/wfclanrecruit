import { masteryDisplay } from "./mastery.js";
import { bindFilterUpdates, resetFilterForm } from "./filter-ui.js";
import { LINK_MAX, isDiscordName, normalizeDiscordName } from "./data.js";
import { api } from "./api.js";
import {
  activeFilterCount,
  accountView,
  adminView,
  allianceCard,
  alliancePage,
  alliancePostView,
  allianceResultsHtml,
  alliancesView,
  authView,
  browseView,
  clanCard,
  clanPage,
  clanResultsHtml,
  cropperModal,
  guideView,
  homeView,
  navAccount,
  conversationHtml,
  ignoreListHtml,
  listingSections,
  messageBubble,
  messagePresence,
  messagesView,
  threadListHtml,
  unreadBadge,
  PRESENCE_CLASS,
  PRESENCE_LABELS,
  playerCard,
  playerSections,
  playerPage,
  playerPostView,
  playerResultsHtml,
  playersView,
  postBodyHtml,
  postView,
  previewAlliance,
  previewClan,
  previewPlayer,
  heldUntilNote,
  readLinkRows,
  readRoleRows,
  rosterPanel,
  transferPanel,
} from "./views.js";
import { ROLE_MAX, roleFilterOptions } from "./roles.js";
import { privacyView } from "./privacy.js";
import {
  aboutTooLong,
  isSafeHref,
  plainTextFromHtml,
  sanitizePostHtml,
  sectionTooLong,
  toEditorHtml,
} from "./richtext.js";
import { counterState, fitPlain } from "./limits.js";
import {
  centerOffset,
  clampOffset,
  clampZoom,
  coverScale,
  sourceRect,
  zoomAbout,
} from "./crop.js";
import { parseYouTubeId } from "./video.js";
import { MEDIA_MAX, parseImageUrl, setUploadPublicBase } from "./media.js";
import {
  alertPlan,
  claimAlert,
  loadAlertPrefs,
  notificationAllowed,
  notificationAvailable,
  playPing,
  requestDesktopPermission,
  saveAlertPrefs,
  showMessageNotification,
  unlockAudio,
} from "./alerts.js";
import {
  applyAllianceFilters,
  applyClanFilters,
  applyPlayerFilters,
  filtersFromSearch,
  filtersToSearch,
  paginate,
} from "./browse.js";

const app = document.querySelector("#app");
const nav = document.querySelector("#site-nav");
const drawer = document.querySelector("#mobile-drawer");
const toggle = document.querySelector(".nav-toggle");
const accountSlot = document.querySelector("#nav-account");
const drawerAccount = document.querySelector("#drawer-account");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("wfr-theme", theme);
  document.querySelectorAll("#theme-toggle, .theme-toggle-clone").forEach((el) => {
    el.checked = theme === "light";
  });
}

applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
document.querySelectorAll("#theme-toggle, .theme-toggle-clone").forEach((el) => {
  el.addEventListener("change", () => applyTheme(el.checked ? "light" : "dark"));
});

const state = {
  user: null,
  clans: [],
  alliances: [],
  players: [],
  threads: [],
  unread: 0,
  emojis: [],
  auth: { discord: false, passwordRegister: false, minAgeDays: 7 },
};

function parseRoute() {
  const raw = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = Object.fromEntries(new URLSearchParams(window.location.search));
  return { path: raw, params };
}

function go(path) {
  const next = path.startsWith("/") ? path : `/${path}`;
  if (`${window.location.pathname}${window.location.search}` === next) {
    render().catch(() => {});
    return;
  }
  history.pushState({}, "", next);
  render().catch((error) => {
    app.innerHTML = `<section class="auth-card"><h1>Could not load</h1><p class="muted">${error.message}</p></section>`;
  });
}

function migrateHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash || hash === "/") {
    if (window.location.hash) history.replaceState({}, "", window.location.pathname + window.location.search || "/");
    return;
  }
  const [path, query = ""] = hash.split("?");
  history.replaceState({}, "", `${path.startsWith("/") ? path : `/${path}`}${query ? `?${query}` : ""}`);
}

function setActiveNav(path) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    const match = link.dataset.route;
    const active =
      match === path ||
      (match === "/post" && path === "/post-alliance") ||
      (match === "/browse" && path.startsWith("/clans/")) ||
      (match === "/alliances" && path.startsWith("/alliances/")) ||
      (match === "/players" && (path.startsWith("/players/") || path === "/lfc"));
    link.classList.toggle("is-active", active);
  });
}

function closeDrawer() {
  drawer.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("drawer-open");
}

// The dropdown-style disclosures: they float over the page rather than sit in
// it, so an open one is a thing covering what you are trying to read, not a
// piece of state worth carrying around.
//
// Deliberately NOT every <details> on the site. Filter groups, the report form
// and the password fields are in-flow accordions - part of the page you are
// reading - and dismissing those when you click elsewhere would throw away the
// thing you opened them for. A filter group is even rendered open on purpose
// when it holds an active filter.
const MENUS = ".account-menu, .thread-menu";

function closeMenus(except = null) {
  document.querySelectorAll(`${MENUS}`).forEach((menu) => {
    if (menu !== except && menu.open) menu.open = false;
  });
}

// Clicking away from a dropdown should dismiss it. <details> has no such
// behaviour of its own - it stays open until its summary is clicked again,
// which is why one left open followed you around the site.
function closeEmojiPops() {
  document.querySelectorAll("[data-emoji-pop]").forEach((pop) => {
    pop.hidden = true;
    pop.closest(".emoji-wrap")?.querySelector("[data-emoji-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

document.addEventListener("click", (event) => {
  closeMenus(event.target.closest(MENUS));
  if (!event.target.closest(".emoji-wrap")) closeEmojiPops();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
    closeEmojiPops();
  }
});

function renderNav() {
  const html = navAccount(state.user, {
    messaging: state.auth.messaging !== false,
  });
  if (accountSlot) accountSlot.innerHTML = html;
  if (drawerAccount) drawerAccount.innerHTML = html;
  // The nav is rebuilt wholesale, which blanks the badge slot, so it is filled
  // again from the count already in memory rather than re-fetched.
  paintUnread();
  paintAlertControls();
}

async function refresh() {
  const [me, clansRes, alliancesRes, playersRes] = await Promise.all([
    api.me().catch(() => ({ user: null })),
    api.clans(),
    api.alliances(),
    api.players(),
  ]);
  state.user = me.user;
  state.auth = me.auth || state.auth;
  setUploadPublicBase(state.auth.r2PublicUrl);
  state.clans = clansRes.clans;
  state.alliances = alliancesRes.alliances;
  state.players = playersRes.players;
  if (state.user) {
    try {
      state.emojis = (await api.emojis()).emojis || [];
    } catch {
      state.emojis = state.emojis || [];
    }
  } else {
    state.emojis = [];
  }
  renderNav();
  startHeartbeat();
  startLive();
  await refreshUnread();
}

// Liveness is in-memory on the server (see server/presence.js), so the tab has
// to keep saying it is here. Stop while hidden: a backgrounded tab or a closed
// laptop should read as offline rather than hold the dot on forever.
const HEARTBEAT_MS = 60 * 1000;
let heartbeat = null;

async function sendHeartbeat() {
  if (document.hidden || !state.user) return;
  try {
    await api.presenceBeat();
  } catch {
    // A dropped heartbeat just ages out the dot; nothing to tell the user.
  }
}

function startHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (!state.user) return;
  sendHeartbeat();
  heartbeat = setInterval(sendHeartbeat, HEARTBEAT_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) sendHeartbeat();
});

document.addEventListener("pointerdown", () => unlockAudio(), { once: true });

function paintAlertControls() {
  const prefs = loadAlertPrefs();
  const desktopOn = prefs.desktop && notificationAllowed();
  document.querySelectorAll("[data-alert-sound]").forEach((el) => {
    el.checked = prefs.sound;
  });
  document.querySelectorAll("[data-alert-desktop]").forEach((el) => {
    el.checked = desktopOn;
    el.disabled = !notificationAvailable();
  });
  const denied = notificationAvailable() && globalThis.Notification?.permission === "denied";
  const missing = !notificationAvailable();
  const note = missing
    ? "This browser cannot show desktop alerts."
    : denied
      ? "Your browser blocked desktop alerts for this site."
      : "";
  document.querySelectorAll("[data-alert-note]").forEach((el) => showNote(el, note, "muted"));
}

async function pingIncoming(message, { viewing }) {
  try {
    const visible = document.visibilityState === "visible";
    const prefs = loadAlertPrefs();
    const plan = alertPlan({
      viewing,
      visible,
      prefs,
      canDesktop: notificationAllowed(),
    });
    if (plan.claim) {
      const won = await claimAlert(message.id, { visible: visible || viewing });
      if (!won) return;
    }
    if (plan.sound) playPing();
    if (plan.desktop) {
      showMessageNotification(message, { onOpen: (href) => go(href) });
    }
  } catch {
    /* delivery already happened; a ping is optional */
  }
}

// Repaint the menu in place. Re-rendering the nav would close the open
// <details> the moment the user picked a status - and picking a status is
// exactly when you want to see it take.
function paintPresence(presence) {
  const status = presence.status;
  document.querySelectorAll(".account-menu").forEach((menu) => {
    const label = menu.querySelector("[data-presence-label]");
    // Only the text node, never the whole label: the invisible sizer beside it
    // is what keeps the summary a constant width, and textContent would eat it.
    const text = menu.querySelector("[data-presence-text]");
    if (text) text.textContent = PRESENCE_LABELS[status] || "";
    if (label) label.className = `account-status ${PRESENCE_CLASS[status] || ""}`;
    // Nothing is being broadcast while you are invisible, so there is nothing
    // to hold. The slider stays where you left it rather than resetting - go
    // back to Online and the hold you picked is still the one you get.
    const off = status === "invisible";
    menu.querySelector("[data-keep-block]")?.classList.toggle("is-off", off);
    const slider = menu.querySelector("[data-presence-keep]");
    if (slider) slider.disabled = off;
    menu.querySelectorAll("[data-presence-pick]").forEach((pick) => {
      const on = pick.dataset.presencePick === status;
      pick.classList.toggle("is-active", on);
      pick.setAttribute("aria-pressed", String(on));
    });
    // The hold is part of the state, not just a one-off action: repaint it too,
    // or the menu goes back to claiming "while tab is open" the moment it is
    // redrawn.
    const keep = menu.querySelector("[data-presence-keep]");
    if (keep) {
      const at = keepValuesOf(keep).indexOf(Number(presence.keepMinutes ?? 0));
      if (at >= 0) keep.value = String(at);
    }
  });
}

// The slider's notches are indices; the minutes live on the element that drew
// them, so the client never invents a hold the server did not offer.
function keepValuesOf(input) {
  return String(input.dataset.keepValues || "")
    .split(",")
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

// Both controls submit the whole pair, because the server takes status and
// hold together: changing one must resend the other or it is silently reset.
async function submitPresence(panel, { status, keepIndex } = {}) {
  const keep = panel.querySelector("[data-presence-keep]");
  const values = keep ? keepValuesOf(keep) : [0];
  const at = keepIndex ?? Number(keep?.value || 0);
  const note = panel.querySelector("[data-presence-note]");
  const wanted =
    status || panel.querySelector("[data-presence-pick].is-active")?.dataset.presencePick;
  try {
    const { presence } = await api.setPresence(wanted, values[at] ?? 0);
    if (state.user) state.user.presence = presence;
    paintPresence(presence);
    const held = presence.status !== "invisible" && presence.until && presence.keepMinutes;
    showNote(note, held ? heldUntilNote(presence.until) : "", "muted");
  } catch (error) {
    showNote(note, error.message);
  }
}

document.addEventListener("click", (event) => {
  const pick = event.target.closest("[data-presence-pick]");
  if (!pick) return;
  const panel = pick.closest(".presence-panel");
  if (panel) submitPresence(panel, { status: pick.dataset.presencePick });
});

// `input` rather than `change` would fire on every pixel of the drag.
document.addEventListener("change", (event) => {
  const sound = event.target.closest("[data-alert-sound]");
  if (sound) {
    saveAlertPrefs({ ...loadAlertPrefs(), sound: sound.checked });
    if (sound.checked) {
      unlockAudio();
      playPing();
    }
    paintAlertControls();
    return;
  }
  const desktop = event.target.closest("[data-alert-desktop]");
  if (desktop) {
    const prefs = loadAlertPrefs();
    if (!desktop.checked) {
      saveAlertPrefs({ ...prefs, desktop: false });
      paintAlertControls();
      return;
    }
    requestDesktopPermission().then((ok) => {
      saveAlertPrefs({ ...prefs, desktop: ok });
      paintAlertControls();
    });
    return;
  }
  const keep = event.target.closest("[data-presence-keep]");
  if (!keep) return;
  const panel = keep.closest(".presence-panel");
  if (panel) submitPresence(panel, { keepIndex: Number(keep.value) });
});

// --- Messaging -------------------------------------------------------------
//
// The stream is a tap on the shoulder, not the source of truth: every event it
// carries is already stored, so a browser that never connects - or one whose
// connection drops and never comes back - loses immediacy and nothing else.

let live = null;

function paintUnread() {
  for (const slot of document.querySelectorAll("[data-unread-slot]")) {
    slot.innerHTML = unreadBadge(state.unread);
  }
}

async function refreshUnread() {
  if (!state.user || state.auth.messaging === false) {
    state.unread = 0;
    paintUnread();
    return;
  }
  try {
    const { unread } = await api.unread();
    state.unread = unread;
    paintUnread();
  } catch {
    /* the badge is not worth an error */
  }
}

function startLive() {
  if (!state.user || state.auth.messaging === false) {
    stopLive();
    return;
  }
  if (live) return;
  // EventSource reconnects on its own, so there is deliberately no retry loop
  // here - writing one would fight the browser's.
  live = new EventSource("/api/messages/stream", { withCredentials: true });
  live.addEventListener("message", (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    onIncoming(payload);
  });
  // Presence rides the same stream a message does. Without it the ONLINE label
  // on a thread row is only ever as fresh as the last page load, which for a
  // page you sit on waiting for a reply is not fresh at all.
  live.addEventListener("presence", (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    onPresence(payload);
  });
  // Left to the browser: closing the source here would stop it retrying.
  live.addEventListener("error", () => {});
}

function stopLive() {
  live?.close();
  live = null;
}

// A message arriving while its conversation is open should appear in it.
// Arriving anywhere else, it should only move the badge.
function onIncoming(message) {
  const panel = app.querySelector("[data-conversation]");
  const viewing = Boolean(panel && message.threadId === panel.dataset.threadId && panel.querySelector("[data-bubbles]"));
  pingIncoming(message, { viewing });
  if (viewing) {
    const bubbles = panel.querySelector("[data-bubbles]");
    if (bubbles) {
      bubbles.insertAdjacentHTML("beforeend", messageBubble(message, state.user?.id, state.emojis));
      bubbles.scrollTop = bubbles.scrollHeight;
      api
        .readThread(message.threadId)
        .then(({ unread }) => {
          state.unread = unread;
          paintUnread();
        })
        .catch(() => {});
      loadInbox(message.threadId);
      return;
    }
  }
  state.unread += 1;
  paintUnread();
  if (window.location.pathname === "/messages") loadInbox();
}

// Repaint the dot where that person's name appears, rather than reloading the
// inbox: a status change must not reorder rows or drop the conversation that
// is open. The cached threads are updated too, so the next render agrees with
// the screen.
function onPresence({ userId, status, online }) {
  if (!userId) return;
  for (const thread of state.threads) {
    if (thread.with?.id !== userId) continue;
    thread.with.online = Boolean(online);
    thread.with.presenceStatus = online ? status : "offline";
    const row = app.querySelector(`[data-thread="${CSS.escape(thread.id)}"]`);
    const slot = row?.querySelector("[data-thread-presence]");
    if (slot) slot.innerHTML = messagePresence(thread.with);
  }
  const head = app.querySelector(".conversation-head .thread-presence");
  const open = state.threads.find(
    (thread) => thread.id === app.querySelector("[data-conversation]")?.dataset.threadId
  );
  if (head && open?.with?.id === userId) head.innerHTML = messagePresence(open.with);
}

async function loadInbox(activeId = "") {
  try {
    const { threads } = await api.inbox();
    state.threads = threads;
    const list = app.querySelector("[data-thread-list]");
    if (list) list.innerHTML = threadListHtml(threads, activeId);
  } catch {
    /* leave whatever is already on screen */
  }
}

// The ignore tab. Un-ignoring runs the same block route the conversation menu
// does, only with `blocked` false, so there is one way to change a block and
// one place it is recorded.
async function paintIgnoreList() {
  const pane = app.querySelector("[data-ignore-list]");
  if (!pane) return;
  try {
    const { blocked } = await api.blockedList();
    pane.innerHTML = ignoreListHtml(blocked);
  } catch (error) {
    pane.innerHTML = `<p class="error">${error.message}</p>`;
  }
}

// Painting and binding are separate because the pane repaints itself after
// every un-ignore: binding inside the paint would stack a second listener on
// the same element each time round, and the third un-ignore would fire three
// requests. Delegated once, it survives every repaint.
async function loadIgnoreList() {
  const pane = app.querySelector("[data-ignore-list]");
  if (!pane) return;
  pane.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-block-user]");
    if (!button) return;
    button.disabled = true;
    try {
      await api.blockUser(button.dataset.blockUser, false);
      await paintIgnoreList();
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  });
  await paintIgnoreList();
}

// A thread id is `kind:listingId:userA:userB` (threadId in server/messages.js),
// so a conversation nobody has written in yet can still be addressed by one.
// The user ids are the server's business; what this needs is the subject.
function threadSubject(id) {
  const [kind, listingId] = String(id || "").split(":");
  return kind && listingId ? { kind, listingId } : null;
}

// Two ways in, one function. A thread that exists is read; one that does not is
// a conversation that was opened and never sent - the row is only written by
// the first message - so it is re-derived from the listing instead of 404ing.
async function readConversation(id) {
  try {
    return await api.thread(id);
  } catch (error) {
    const subject = threadSubject(id);
    if (!subject) throw error;
    return api.openThread(subject.kind, subject.listingId);
  }
}

async function openConversation(id) {
  const panel = app.querySelector("[data-conversation]");
  if (!panel) return;
  try {
    const { thread, messages } = await readConversation(id);
    panel.dataset.threadId = thread.id;
    panel.innerHTML = conversationHtml(thread, messages, state.user?.id, state.emojis);
    const bubbles = panel.querySelector("[data-bubbles]");
    if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;
    bindConversation(panel, thread);
    await refreshUnread();
    await loadInbox(thread.id);
  } catch (error) {
    panel.innerHTML = `<div class="conversation-empty"><p class="error">${error.message}</p></div>`;
  }
}

function bindConversation(panel, thread) {
  const form = panel.querySelector("[data-send-form]");
  const note = panel.querySelector("[data-send-note]");
  const shell = form?.querySelector("[data-rich-editor-shell]");
  const box = form?.querySelector("textarea");
  const editor = form?.querySelector("[data-rich-editor]");
  const count = panel.querySelector("[data-count]");
  const max = Number(shell?.dataset.plainLimit || 2000);
  // The budget is readable characters, the same cap the server enforces. HTML
  // tags are free in the count, so a bold word is not more expensive than a
  // plain one.
  const paintCount = () => {
    if (!count) return;
    const used = editor ? plainTextFromHtml(editor.innerHTML).length : box?.value.length || 0;
    count.textContent = `${used}/${max} chars.`;
  };
  if (shell) bindRichTextField(shell, paintCount);
  const submit = async (event) => {
    event?.preventDefault();
    const body = (box?.value || "").trim();
    if (!plainTextFromHtml(body)) return;
    closeEmojiPops();
    // Cleared optimistically so a slow send cannot be submitted twice, but put
    // back if it fails: losing what someone typed is worse than an error.
    if (editor) {
      editor.innerHTML = "";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (box) {
      box.value = "";
    }
    try {
      const { message } = await api.send(thread.id, body);
      const bubbles = panel.querySelector("[data-bubbles]");
      if (bubbles) {
        if (!bubbles.querySelector(".bubble")) bubbles.innerHTML = "";
        bubbles.insertAdjacentHTML("beforeend", messageBubble(message, state.user?.id, state.emojis));
        bubbles.scrollTop = bubbles.scrollHeight;
      }
      showNote(note, "", "muted");
      paintCount();
      await loadInbox(thread.id);
    } catch (error) {
      if (editor) {
        editor.innerHTML = toEditorHtml(body);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (box) {
        box.value = body;
      }
      paintCount();
      showNote(note, error.message);
    }
  };
  form?.addEventListener("submit", submit);
  paintCount();
  // Enter sends, Shift+Enter is a newline. Enter inside a list still makes a
  // new bullet - that is formatting, not a send.
  editor?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const node = window.getSelection()?.anchorNode;
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (el?.closest("li, ul, ol")) return;
    event.preventDefault();
    submit(event);
  });
  // Re-opened rather than overwritten with a sentence. The old version painted
  // "Blocked." straight into the panel, so the block looked like it had come
  // undone the moment the page was reloaded - the state was never on the
  // thread, only on the screen. Now the server reports it and the conversation
  // is drawn again from what it says.
  panel.querySelector("[data-block-user]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const userId = button.dataset.blockUser;
    const blocking = !button.dataset.blocked;
    if (
      blocking &&
      !confirm("Ignore this person? Neither of you will be able to message the other.")
    ) {
      return;
    }
    try {
      await api.blockUser(userId, blocking);
      if (thread.draft && blocking) {
        // Nothing was ever written, and the open route now refuses this pair.
        // There is no conversation to redraw - only an inbox to go back to.
        panel.innerHTML = conversationHtml(null, [], state.user?.id, state.emojis);
        delete panel.dataset.threadId;
        await loadInbox();
        return;
      }
      await openConversation(thread.id);
    } catch (error) {
      alert(error.message);
    }
  });

  // One-sided: the other person keeps their copy, and a reply brings this one
  // back holding only what is new. Worth saying, or Delete reads as "erase the
  // conversation" and gets pressed for the wrong reason.
  panel.querySelector("[data-delete-thread]")?.addEventListener("click", async (event) => {
    if (
      !confirm(
        "Leave this chat? It leaves your inbox. The other person keeps their copy, and if they write again the conversation comes back with just the new messages."
      )
    ) {
      return;
    }
    try {
      await api.deleteThread(event.currentTarget.dataset.deleteThread);
      panel.innerHTML = conversationHtml(null, [], state.user?.id, state.emojis);
      delete panel.dataset.threadId;
      await refreshUnread();
      await loadInbox();
    } catch (error) {
      alert(error.message);
    }
  });
  const report = panel.querySelector(".report-form");
  report?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reportNote = report.querySelector("[data-report-note]");
    try {
      await api.reportThread(thread.id, {
        reason: report.reason.value,
        details: report.details.value.trim(),
      });
      showNote(reportNote, "Report sent. Thanks.", "muted");
      report.querySelector("button[type='submit']").disabled = true;
    } catch (error) {
      showNote(reportNote, error.message);
    }
  });
}

// Where to land after a post is removed. From its public page the directory is
// the only sensible place; from the composer or the account list it is the
// account page, where the rest of their posts still are.
function afterDelete(directory) {
  if (window.location.pathname.startsWith(directory)) {
    go(directory === "/clans" ? "/browse" : directory);
    return;
  }
  if (state.user) go("/account");
  else go(directory === "/clans" ? "/browse" : directory);
}

function readFilters(form) {
  const data = new FormData(form);
  return {
    q: String(data.get("q") || "").trim(),
    platform: String(data.get("platform") || ""),
    tier: String(data.get("tier") || ""),
    playstyles: data.getAll("playstyle"),
    role: String(data.get("role") || ""),
    region: String(data.get("region") || ""),
    language: String(data.get("language") || ""),
    status: String(data.get("status") || ""),
    online: data.get("online") === "1",
    recruiting: data.get("recruiting") === "1",
    mr: String(data.get("mr") || "0"),
    hours: String(data.get("hours") || ""),
    sort: String(data.get("sort") || "newest"),
  };
}

// On a phone the filter panel is taller than the screen, so the board opens
// behind a wall of controls. Collapsed by default there, and left alone on
// desktop where the sidebar has its own column.
function bindFiltersToggle() {
  const panel = app.querySelector("[data-filters]");
  const toggle = panel?.querySelector("[data-filters-toggle]");
  if (!panel || !toggle) return;
  toggle.addEventListener("click", () => {
    const open = panel.classList.toggle("is-collapsed") === false;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function bindCards(root = app) {
  root.querySelectorAll("[data-href]").forEach((el) => {
    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-stop], a, button")) return;
      go(el.dataset.href);
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") go(el.dataset.href);
    });
  });
  bindCopyText(root);
}

// Copy buttons carry their payload in the attribute, so the same handler
// serves the whisper on a listing page and the one on every card.
function bindCopyText(root = app) {
  root.querySelectorAll("[data-copy-text]").forEach((button) => {
    button.addEventListener("click", async () => {
      const label = button.textContent;
      try {
        await navigator.clipboard.writeText(button.dataset.copyText);
        button.textContent = "Copied";
        // Tell the leader someone acted on their post. Best effort only.
        if (button.dataset.copyListing) api.countWhisper(button.dataset.copyListing).catch(() => {});
        if (button.dataset.copyPlayer) api.countPlayerWhisper(button.dataset.copyPlayer).catch(() => {});
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => {
        button.textContent = label;
      }, 2000);
    });
  });
}

// The strip swaps what the stage shows rather than mounting a player per item,
// so a listing with eight things still loads one iframe.
function bindMediaGallery() {
  const gallery = app.querySelector("[data-media-gallery]");
  const frame = app.querySelector("[data-media-frame]");
  const image = app.querySelector("[data-media-image]");
  if (!gallery || !frame || !image) return;
  gallery.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-media-pick], [data-media-src]");
    if (!pick) return;
    const isVideo = pick.dataset.mediaKind === "video";
    if (isVideo) {
      frame.src = pick.dataset.mediaSrc;
    } else {
      // Stop whatever was playing; leaving the iframe loaded keeps the audio on.
      frame.removeAttribute("src");
      image.src = pick.dataset.mediaSrc;
    }
    frame.hidden = !isVideo;
    image.hidden = isVideo;
    gallery.querySelectorAll("[data-media-src]").forEach((button) => {
      const active = button === pick;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  });
}

function bindListingPage() {
  bindCopyText();
  bindMediaGallery();
  app.querySelector("[data-copy-url]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(window.location.href);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
  });
  const form = app.querySelector(".report-form");
  if (!form) return;
  const note = form.querySelector("[data-report-note]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = form.dataset.reportKind;
    const id = form.dataset.reportId;
    const payload = {
      reason: form.reason.value,
      details: form.details.value.trim(),
    };
    try {
      if (kind === "alliance") await api.reportAlliance(id, payload);
      else if (kind === "player") await api.reportPlayer(id, payload);
      else await api.reportClan(id, payload);
      showNote(note, "Report sent. Thanks.", "muted");
      form.querySelector("button[type='submit']").disabled = true;
    } catch (error) {
      showNote(note, error.message);
    }
  });
}

// Rosters carry pending invites, so they are owner-only and fetched when the
// owner actually opens the section rather than shipped with every listing.
// List responses drop the post body, so anything that needs the whole record -
// the detail page, the edit form - asks for it and caches what comes back.
const LISTING_LISTS = { clan: "clans", alliance: "alliances", player: "players" };

async function fullListing(kind, id) {
  const list = state[LISTING_LISTS[kind]];
  const cached = list.find((item) => item.id === id && item.about !== undefined);
  if (cached) return cached;
  try {
    const res =
      kind === "clan" ? await api.clan(id) : kind === "player" ? await api.player(id) : await api.alliance(id);
    const item = res[kind];
    const at = list.findIndex((entry) => entry.id === id);
    if (at >= 0) list[at] = item;
    else list.push(item);
    return item;
  } catch {
    return null;
  }
}

// The composer's Owner box. It reads from the same owner-only roster route the
// recruiter panel does, so the offer arrives with the roster rather than in a
// second round trip.
function bindTransfer() {
  const box = app.querySelector("[data-transfer-for]");
  if (!box) return;
  const id = box.dataset.transferFor;
  const slot = box.querySelector("[data-transfer-slot]");
  const paint = (transfer) => {
    slot.innerHTML = transferPanel(transfer);
    const note = () => slot.querySelector("[data-transfer-note]");
    const input = slot.querySelector("[data-transfer-username]");
    slot.querySelector("[data-transfer-offer]")?.addEventListener("click", async () => {
      const username = input.value.trim();
      if (!username) return;
      // The one control here that gives away the ability to delete the post, so
      // it asks first and names what is being handed over.
      if (
        !confirm(
          `Offer this listing to ${username}? If they accept, the post becomes theirs — you keep edit access, but you will no longer be able to delete it.`
        )
      ) {
        return;
      }
      try {
        const { transfer } = await api.offerTransfer(id, username);
        paint(transfer);
        showNote(
          slot.querySelector("[data-transfer-note]"),
          "Offer sent. Nothing moves until they accept.",
          "muted"
        );
      } catch (error) {
        showNote(note(), error.message);
      }
    });
    slot.querySelector("[data-transfer-cancel]")?.addEventListener("click", async () => {
      try {
        await api.cancelTransfer(id);
        paint(null);
      } catch (error) {
        showNote(note(), error.message);
      }
    });
  };
  api
    .roster(id)
    .then(({ transfer }) => paint(transfer || null))
    .catch((error) => {
      slot.innerHTML = `<p class="muted">${error.message}</p>`;
    });
}

function bindRecruiters() {
  app.querySelectorAll("[data-roster-for]").forEach((box) => {
    const id = box.dataset.rosterFor;
    const slot = box.querySelector("[data-roster-slot]");
    // An editor may read the roster but not change it, so the panel it gets has
    // no invite row, no Remove, and role pickers it cannot move.
    const owner = box.dataset.rosterOwner !== "false";
    const paint = (roster, max) => {
      slot.innerHTML = rosterPanel(roster, max, { owner });
      const input = slot.querySelector("[data-roster-username]");
      const invite = async () => {
        const username = input.value.trim();
        if (!username) return;
        const note = slot.querySelector("[data-roster-note]");
        const role = slot.querySelector("[data-roster-new-role]")?.value;
        const label = slot.querySelector("[data-roster-new-label]")?.value;
        try {
          const { roster: next } = await api.inviteRecruiter(id, username, role, label);
          paint(next, max);
          showNote(
            slot.querySelector("[data-roster-note]"),
            "Invite sent. They have to accept before their name shows.",
            "muted"
          );
        } catch (error) {
          showNote(note, error.message);
        }
      };
      slot.querySelector("[data-roster-invite]")?.addEventListener("click", invite);

      // Suggestions arrive as the owner types. A <datalist> would have been a
      // line of markup, but the browser draws it in its own chrome - system
      // font, square corners, and painted over whatever error is underneath -
      // so this is a listbox we own and can style like the rest of the page.
      const suggestions = slot.querySelector("[data-roster-suggestions]");
      let lookupTimer;
      let lookupSeq = 0;
      let options = [];
      let active = -1;

      function closeList() {
        suggestions.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        active = -1;
      }

      function highlight(next) {
        active = next;
        options.forEach((option, index) => {
          option.classList.toggle("is-active", index === active);
          option.setAttribute("aria-selected", index === active ? "true" : "false");
        });
        if (active >= 0) {
          input.setAttribute("aria-activedescendant", options[active].id);
          options[active].scrollIntoView({ block: "nearest" });
        } else {
          input.removeAttribute("aria-activedescendant");
        }
      }

      function choose(name) {
        input.value = name;
        closeList();
        input.focus();
      }

      function showList(names) {
        // Built as nodes rather than markup: a Warframe name is someone else's
        // text, and it never becomes HTML on the way in.
        options = names.map((name, index) => {
          const option = document.createElement("li");
          option.className = "combo-option";
          option.id = `roster-option-${index}`;
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false");
          option.textContent = name;
          // mousedown, not click: the input blurs first and would close the
          // list out from under the pointer.
          option.addEventListener("mousedown", (event) => {
            event.preventDefault();
            choose(name);
          });
          return option;
        });
        suggestions.replaceChildren(...options);
        suggestions.hidden = !options.length;
        input.setAttribute("aria-expanded", options.length ? "true" : "false");
        highlight(-1);
      }

      input?.addEventListener("input", () => {
        // A stale "no such player" under a box that is being retyped is just
        // noise, so it goes as soon as the owner touches the field.
        const note = slot.querySelector("[data-roster-note]");
        if (note) note.hidden = true;
        const q = input.value.trim();
        clearTimeout(lookupTimer);
        if (q.length < 2) {
          showList([]);
          return;
        }
        const seq = ++lookupSeq;
        lookupTimer = setTimeout(async () => {
          try {
            const { names } = await api.searchRecruiters(id, q);
            // Dropped if a newer query has already gone out, so the list never
            // shows results for something already typed past.
            if (seq !== lookupSeq) return;
            showList(names);
          } catch {
            // A failed lookup just means no suggestions; the owner can still
            // type the name in full.
            if (seq === lookupSeq) showList([]);
          }
        }, 180);
      });

      input?.addEventListener("keydown", (event) => {
        const open = !suggestions.hidden && options.length;
        if (event.key === "ArrowDown" && open) {
          event.preventDefault();
          highlight((active + 1) % options.length);
          return;
        }
        if (event.key === "ArrowUp" && open) {
          event.preventDefault();
          highlight(active <= 0 ? options.length - 1 : active - 1);
          return;
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          closeList();
          return;
        }
        if (event.key === "Tab") {
          closeList();
          return;
        }
        if (event.key !== "Enter") return;
        // Enter in the field would otherwise submit the post editor around us.
        event.preventDefault();
        if (open && active >= 0) {
          choose(options[active].textContent);
          return;
        }
        invite();
      });

      input?.addEventListener("blur", closeList);
      slot.querySelectorAll("[data-roster-remove]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            const { roster: next } = await api.removeRecruiter(id, button.dataset.rosterRemove);
            paint(next, max);
          } catch (error) {
            showNote(slot.querySelector("[data-roster-note]"), error.message);
          }
        });
      });

      slot.querySelectorAll("[data-roster-role]").forEach((select) => {
        // Repainting would steal focus mid-change, so the row is left as it is
        // and only the note speaks. The select already shows the new value.
        const previous = select.value;
        select.addEventListener("change", async () => {
          try {
            await api.setRecruiterRole(id, select.dataset.rosterRole, { role: select.value });
            showNote(
              slot.querySelector("[data-roster-note]"),
              select.value === "editor"
                ? "They can edit this post now."
                : "They answer whispers only now.",
              "muted"
            );
          } catch (error) {
            select.value = previous;
            showNote(slot.querySelector("[data-roster-note]"), error.message);
          }
        });
      });

      // A title, not access - so it saves the same quiet way the role does, on
      // blur rather than per keystroke, and never repaints the row underneath
      // the person still typing in it.
      slot.querySelectorAll("[data-roster-label]").forEach((input) => {
        let previous = input.value;
        input.addEventListener("change", async () => {
          const label = input.value.trim();
          try {
            await api.setRecruiterRole(id, input.dataset.rosterLabel, { label });
            previous = label;
            showNote(
              slot.querySelector("[data-roster-note]"),
              label ? `The post calls them "${label}" now.` : "Back to the default label.",
              "muted"
            );
          } catch (error) {
            input.value = previous;
            showNote(slot.querySelector("[data-roster-note]"), error.message);
          }
        });
      });
    };
    api
      .roster(id)
      .then(({ roster, max }) => paint(roster, max))
      .catch((error) => {
        slot.innerHTML = `<p class="muted">${error.message}</p>`;
      });
  });

  bindTransfer();

  const note = app.querySelector("[data-invite-note]");
  const respond = async (id, accept) => {
    try {
      await api.respondToInvite(id, accept);
      await refresh();
      await render();
    } catch (error) {
      showNote(note, error.message);
    }
  };
  app.querySelectorAll("[data-invite-accept]").forEach((button) =>
    button.addEventListener("click", () => respond(button.dataset.inviteAccept, true))
  );
  app.querySelectorAll("[data-invite-decline]").forEach((button) =>
    button.addEventListener("click", () => respond(button.dataset.inviteDecline, false))
  );
  const transferNote = app.querySelector("[data-transfer-invite-note]");
  const answerTransfer = async (id, accept) => {
    if (
      accept &&
      !confirm(
        "Take ownership of this listing? It becomes yours to edit, bump and delete, and recruits will whisper your verified Warframe name."
      )
    ) {
      return;
    }
    try {
      await api.respondToTransfer(id, accept);
      await refresh();
      await render();
    } catch (error) {
      showNote(transferNote, error.message);
    }
  };
  app.querySelectorAll("[data-transfer-accept]").forEach((button) =>
    button.addEventListener("click", () => answerTransfer(button.dataset.transferAccept, true))
  );
  app.querySelectorAll("[data-transfer-decline]").forEach((button) =>
    button.addEventListener("click", () => answerTransfer(button.dataset.transferDecline, false))
  );

  app.querySelectorAll("[data-recruiter-leave]").forEach((button) =>
    button.addEventListener("click", async () => {
      try {
        await api.removeRecruiter(button.dataset.recruiterLeave, state.user.id);
        await refresh();
        await render();
      } catch (error) {
        showNote(note, error.message);
      }
    })
  );
}

function bindForumForm() {
  const form = app.querySelector("#forum-form");
  if (!form) return;
  const note = app.querySelector("#forum-note");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api.forumStart(form.profileUrl.value.trim());
      state.user = result.user;
      renderNav();
      await render();
    } catch (error) {
      showNote(note, error.message);
    }
  });
  app.querySelector("[data-forum='check']")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    showNote(note, "Reading your About Me tab…", "muted");
    try {
      const result = await api.forumCheck(form.profileUrl.value.trim());
      state.user = result.user;
      renderNav();
      await render();
    } catch (error) {
      showNote(note, error.message);
      button.disabled = false;
    }
  });
}

function bindStaffForm() {
  const form = app.querySelector("[data-staff-form]");
  if (!form) return;
  const note = app.querySelector("[data-staff-note]");
  const input = form.querySelector("[data-staff-query]");
  const picked = form.querySelector("[data-staff-user-id]");
  const suggestions = form.querySelector("[data-staff-suggestions]");
  let lookupTimer;
  let lookupSeq = 0;
  let options = [];
  let active = -1;

  function closeList() {
    if (!suggestions) return;
    suggestions.hidden = true;
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function highlight(next) {
    active = next;
    options.forEach((option, index) => {
      option.classList.toggle("is-active", index === active);
      option.setAttribute("aria-selected", index === active ? "true" : "false");
    });
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function choose(person) {
    input.value = person.label;
    if (picked) picked.value = person.id;
    closeList();
    input.focus();
  }

  function showList(people) {
    options = people.map((person, index) => {
      const option = document.createElement("li");
      option.className = "combo-option";
      option.id = `staff-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent =
        person.matched && person.matched !== person.label
          ? `${person.label} (${person.matched})`
          : person.label;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        choose(person);
      });
      return option;
    });
    suggestions.replaceChildren(...options);
    suggestions.hidden = !options.length;
    input.setAttribute("aria-expanded", options.length ? "true" : "false");
    highlight(-1);
  }

  input?.addEventListener("input", () => {
    if (picked) picked.value = "";
    if (note) note.hidden = true;
    const q = input.value.trim();
    clearTimeout(lookupTimer);
    if (q.length < 2) {
      showList([]);
      return;
    }
    const seq = ++lookupSeq;
    lookupTimer = setTimeout(async () => {
      try {
        const { people } = await api.searchStaff(q);
        if (seq !== lookupSeq) return;
        showList(people || []);
      } catch {
        if (seq === lookupSeq) showList([]);
      }
    }, 180);
  });

  input?.addEventListener("keydown", (event) => {
    const open = suggestions && !suggestions.hidden && options.length;
    if (event.key === "ArrowDown" && open) {
      event.preventDefault();
      highlight((active + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      highlight(active <= 0 ? options.length - 1 : active - 1);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeList();
    }
  });

  input?.addEventListener("blur", closeList);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    const data = new FormData(form);
    const userId = String(data.get("userId") || "").trim();
    const query = String(data.get("query") || "").trim();
    try {
      await api.grantAdmin(userId ? { userId } : { query });
      await render();
    } catch (error) {
      showNote(note, error.message);
      if (button) button.disabled = false;
    }
  });
}

function bindEmojiForm() {
  const form = app.querySelector("[data-emoji-form]");
  if (!form) return;
  const note = app.querySelector("[data-emoji-note]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    try {
      const { emojis } = await api.addEmoji(new FormData(form));
      state.emojis = emojis || [];
      await render();
    } catch (error) {
      showNote(note, error.message);
      if (button) button.disabled = false;
    }
  });
}

function showNote(el, message, kind = "error") {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
  el.classList.toggle("error", Boolean(message) && kind !== "muted");
  el.classList.toggle("muted", kind === "muted");
}

const IMAGE_MAX = 2 * 1024 * 1024;

// What the cropper writes back. 512 is the largest the emblem is ever drawn -
// the post header at 72 on a 3x screen - and a square of it re-encodes small
// enough that the 2 MB cap stops being something a leader can hit.
const EMBLEM_SIZE = 512;
// The stage is square and fixed for the life of one crop - the drag maths is
// written against it - so it is sized once, to whatever the screen allows.
function stageSize() {
  return Math.max(200, Math.min(320, window.innerWidth - 80));
}

function canvasFile(canvas, name) {
  return new Promise((resolve) => {
    // WebP everywhere it is offered; PNG is the fallback that keeps the
    // transparency an emblem usually has.
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const ext = blob.type === "image/webp" ? "webp" : "png";
        resolve(new File([blob], `${name}.${ext}`, { type: blob.type }));
      },
      "image/webp",
      0.9
    );
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be opened. Try a PNG or JPG."));
    image.src = url;
  });
}

// Resolves with the cropped File, or null if the leader backed out. The picker
// only replaces what it has once something comes back, so cancelling leaves the
// previous emblem exactly where it was.
async function openCropper(file, root) {
  const url = URL.createObjectURL(file);
  let image;
  try {
    image = await loadImage(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  root.innerHTML = cropperModal(file.name);
  document.body.classList.add("modal-open");
  const backdrop = root.querySelector("[data-cropper]");
  const canvas = root.querySelector("[data-crop-canvas]");
  const zoom = root.querySelector("[data-crop-zoom]");
  const previews = [...root.querySelectorAll("[data-crop-preview]")];
  const STAGE = stageSize();
  const stage = root.querySelector("[data-crop-stage]");
  stage.style.width = `${STAGE}px`;
  stage.style.height = `${STAGE}px`;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = STAGE * ratio;
  canvas.height = STAGE * ratio;
  canvas.style.width = `${STAGE}px`;
  canvas.style.height = `${STAGE}px`;
  const ctx = canvas.getContext("2d");

  const base = coverScale(image.naturalWidth, image.naturalHeight, STAGE);
  const bounds = { width: image.naturalWidth, height: image.naturalHeight, frame: STAGE };
  let scale = base;
  let offset = centerOffset({ ...bounds, scale });

  function paint() {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, STAGE, STAGE);
    ctx.drawImage(image, offset.x, offset.y, image.naturalWidth * scale, image.naturalHeight * scale);
    const box = sourceRect({ ...offset, frame: STAGE, scale });
    for (const preview of previews) {
      // Each preview is the same crop, scaled to the size it will be shown at.
      const size = preview.clientWidth || 40;
      preview.style.backgroundImage = `url("${url}")`;
      preview.style.backgroundSize = `${(image.naturalWidth / box.size) * size}px ${
        (image.naturalHeight / box.size) * size
      }px`;
      preview.style.backgroundPosition = `${(-box.sx / box.size) * size}px ${
        (-box.sy / box.size) * size
      }px`;
    }
  }

  function setScale(next) {
    const wanted = clampZoom(next) * base;
    offset = zoomAbout({ ...offset, ...bounds, scale, nextScale: wanted });
    scale = wanted;
    paint();
  }

  paint();

  zoom.addEventListener("input", () => setScale(Number(zoom.value)));

  let dragging = null;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    offset = clampOffset({
      ...bounds,
      scale,
      x: event.clientX - dragging.x,
      y: event.clientY - dragging.y,
    });
    paint();
  });
  const endDrag = () => {
    dragging = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  return new Promise((resolve) => {
    function close(result) {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
      root.innerHTML = "";
      URL.revokeObjectURL(url);
      resolve(result);
    }
    function onKey(event) {
      if (event.key === "Escape") close(null);
    }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(null);
    });
    root.querySelectorAll("[data-crop-cancel]").forEach((button) => {
      button.addEventListener("click", () => close(null));
    });
    root.querySelector("[data-crop-save]").addEventListener("click", async () => {
      const box = sourceRect({ ...offset, frame: STAGE, scale });
      const out = document.createElement("canvas");
      out.width = EMBLEM_SIZE;
      out.height = EMBLEM_SIZE;
      out
        .getContext("2d")
        .drawImage(image, box.sx, box.sy, box.size, box.size, 0, 0, EMBLEM_SIZE, EMBLEM_SIZE);
      const cropped = await canvasFile(out, "emblem");
      close(cropped);
    });
  });
}

function bindImagePicker(form, initialUrl, onUrl) {
  let imageUrl = initialUrl;
  const input = form.image;
  const picker = form.querySelector('[data-file-picker="image"]');
  const label = picker?.querySelector("[data-file-label]");
  const hint = picker?.querySelector("[data-file-hint]");
  const action = picker?.querySelector("[data-file-action]");
  const preview = picker?.querySelector("[data-file-preview]");
  const clear = picker?.querySelector("[data-file-clear]");

  function setFile(file) {
    if (imageUrl && imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    imageUrl = file ? URL.createObjectURL(file) : initialUrl;
    picker?.classList.toggle("has-file", Boolean(imageUrl));
    if (label) label.textContent = file ? file.name : imageUrl ? "Current image" : "Upload an image";
    if (hint) hint.hidden = Boolean(imageUrl);
    if (action) action.textContent = imageUrl ? "Replace" : "Choose image";
    if (clear) clear.hidden = !file;
    if (preview) {
      preview.style.backgroundImage = imageUrl ? `url("${imageUrl}")` : "";
    }
    onUrl(imageUrl);
  }

  if (initialUrl) setFile(null);

  // Everything the leader picks goes through the cropper, so what the form
  // finally uploads is always a square the canvas re-encoded - never the raw
  // file, whatever its extension or size.
  // Writing to input.files fires another change event. Without this the
  // cropper would reopen on its own output, forever.
  let writingBack = false;
  // The last crop the picker accepted, so cancelling can put it back.
  let kept = null;

  async function take(file) {
    if (!file || !input) return;
    const error = picker?.querySelector("[data-file-error]");
    if (error) {
      error.textContent = "";
      error.hidden = true;
    }
    let cropped = null;
    try {
      cropped = await openCropper(file, document.getElementById("modal-root"));
    } catch (failure) {
      if (error) {
        error.textContent = failure.message;
        error.hidden = false;
      }
      input.value = "";
      return;
    }
    if (!cropped) {
      // Cancelled: put back whatever the picker already held, so backing out
      // of a second choice does not throw away the first one.
      const transfer = new DataTransfer();
      if (kept) transfer.items.add(kept);
      writingBack = true;
      input.files = transfer.files;
      writingBack = false;
      setFile(kept);
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(cropped);
    writingBack = true;
    input.files = transfer.files;
    writingBack = false;
    kept = cropped;
    setFile(cropped);
  }

  clear?.addEventListener("click", () => {
    if (input) input.value = "";
    kept = null;
    setFile(null);
  });
  input?.addEventListener("change", () => {
    if (writingBack) return;
    take(input.files?.[0] || null);
  });

  ["dragenter", "dragover"].forEach((type) => {
    picker?.addEventListener(type, (event) => {
      event.preventDefault();
      picker.classList.add("is-dragover");
    });
  });
  picker?.addEventListener("dragleave", () => picker.classList.remove("is-dragover"));
  picker?.addEventListener("drop", (event) => {
    event.preventDefault();
    picker.classList.remove("is-dragover");
    take(event.dataTransfer?.files?.[0] || null);
  });
}

// Videos, links, and the plain-text lists are all "a stack of rows you can add
// to and remove from". One binding drives all three: clone the last row to add,
// never drop below one row for the lists that need a starting point, and hand
// the caller a callback whenever the set changes.
function bindRowList(list, { max = Infinity, min = 0, onChange, onRowAdded } = {}) {
  if (!list) return;
  const items = list.querySelector("[data-row-items]");
  const add = list.querySelector("[data-row-add]");
  const empty = list.querySelector("[data-row-empty]");
  const template = list.querySelector("[data-row-template]");
  const extraTemplate = list.querySelector("[data-row-template-extra]");

  function blankRow(which = template) {
    return which?.content.firstElementChild?.cloneNode(true) || null;
  }

  function sync() {
    const count = items?.children.length || 0;
    if (add) add.hidden = count >= max;
    if (empty) empty.hidden = count > 0;
    list.querySelectorAll("[data-row-remove]").forEach((button) => {
      button.hidden = count <= min;
    });
    onChange?.();
  }

  function appendRow(which) {
    if ((items?.children.length || 0) >= max) return;
    const row = blankRow(which);
    if (!row) return;
    items.append(row);
    // A row cloned from the template is inert markup: anything inside it that
    // needs wiring - a rich-text editor, say - gets it here, or the row looks
    // right and does nothing.
    onRowAdded?.(row);
    sync();
    return row;
  }

  add?.addEventListener("click", () => {
    appendRow(template)?.querySelector("input")?.focus();
  });

  // The upload button adds its row and opens the file picker in the same
  // gesture - two clicks to attach one image is one too many.
  list.querySelector("[data-row-add-extra]")?.addEventListener("click", () => {
    appendRow(extraTemplate)?.querySelector("input[type='file']")?.click();
  });

  list.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-row-remove]");
    if (!remove || !list.contains(remove)) return;
    const row = remove.closest("[data-row]");
    if (!row) return;
    if ((items?.children.length || 0) <= min) {
      row.querySelectorAll("input").forEach((input) => {
        input.value = "";
      });
    } else {
      row.remove();
    }
    sync();
  });

  bindRowDrag(list, items, sync);
  sync();
}

// The order of the media rows decides which item plays inside the post and how
// the strip reads, so it has to be changeable without deleting and retyping.
// Dragging is the obvious gesture; the arrow keys are here because a drag-only
// control is unusable without a mouse.
function bindRowDrag(list, items, onReorder) {
  if (!items) return;
  let dragging = null;

  // The row carries `draggable`, not the handle, so the drag image is the whole
  // row - but only once the pointer is on the handle, or selecting text inside
  // an input would start a drag instead.
  items.addEventListener("pointerdown", (event) => {
    const row = event.target.closest("[data-row-handle]")?.closest("[data-row]");
    if (row) row.draggable = true;
  });
  const release = () => {
    items.querySelectorAll("[data-row]").forEach((row) => {
      row.draggable = false;
    });
  };
  items.addEventListener("pointerup", release);

  items.addEventListener("dragstart", (event) => {
    dragging = event.target.closest("[data-row]");
    if (!dragging) return;
    dragging.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag with nothing on the transfer.
    event.dataTransfer.setData("text/plain", "");
  });

  items.addEventListener("dragover", (event) => {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const after = rowAfterPoint(items, event.clientY, dragging);
    if (after === dragging) return;
    if (after) items.insertBefore(dragging, after);
    else items.append(dragging);
  });

  items.addEventListener("drop", (event) => event.preventDefault());

  items.addEventListener("dragend", () => {
    dragging?.classList.remove("is-dragging");
    dragging = null;
    release();
    onReorder?.();
  });

  items.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-row-handle]");
    const row = handle?.closest("[data-row]");
    const up = event.key === "ArrowUp";
    const down = event.key === "ArrowDown";
    if (!row || (!up && !down)) return;
    event.preventDefault();
    if (up && row.previousElementSibling) items.insertBefore(row, row.previousElementSibling);
    if (down && row.nextElementSibling) items.insertBefore(row.nextElementSibling, row);
    handle.focus();
    onReorder?.();
  });
}

// The row the pointer sits above, by midpoint: the one the dragged row should
// be inserted before.
function rowAfterPoint(items, y, dragging) {
  for (const row of items.querySelectorAll("[data-row]")) {
    if (row === dragging) continue;
    const box = row.getBoundingClientRect();
    if (y < box.top + box.height / 2) return row;
  }
  return null;
}

// The video is a YouTube id now, not a file, so this binds text boxes rather
// than a picker: parse on every keystroke, show the poster frame as proof the
// link resolved, and place the [video] marker the moment the first one does.
// Each row resolves to one media entry. A link row decides for itself whether
// what was pasted is a YouTube video or an image, so the leader never picks a
// type; an upload row carries a File until submit, when its position in the
// `mediaImage` list is what tells the server where it belongs.
// The media payload addresses uploads by their position in `mediaImage`, so
// that list has to be rebuilt deliberately at submit: a FormData taken straight
// off the form would also carry every empty file picker and shift every slot.
const mediaFilesByForm = new WeakMap();

function bindMediaRows(form, onMedia) {
  const list = form.querySelector("[data-row-list='media']");
  const payload = form.elements.media;
  // One object URL per File, so a re-render does not leak a new blob each keystroke.
  const fileUrls = new WeakMap();
  let seenFirst = false;

  function readRow(row) {
    const badge = row.querySelector("[data-media-badge]");
    const thumb = row.querySelector("[data-media-thumb]");
    const image = row.querySelector("[data-media-thumb-img]");
    const error = row.querySelector("[data-media-error]");
    let entry = null;
    let message = "";

    if (row.dataset.mediaRow === "upload") {
      const saved = row.dataset.mediaUrlValue || "";
      const file = row.querySelector("input[type='file']")?.files?.[0] || null;
      if (file) {
        if (file.size > IMAGE_MAX) {
          message = "Each image must be 2 MB or smaller.";
        } else {
          entry = { kind: "image", file };
          if (image && image.dataset.objectUrl !== file.name) {
            image.src = URL.createObjectURL(file);
            image.dataset.objectUrl = file.name;
          }
        }
      } else if (saved) {
        entry = { kind: "image", url: saved };
      }
      const name = row.querySelector("[data-media-name]");
      if (name) name.textContent = file ? file.name : saved ? "Uploaded image" : "";
      if (badge) badge.textContent = "🖼";
    } else {
      const raw = String(row.querySelector("[data-media-url]")?.value || "").trim();
      if (raw) {
        const id = parseYouTubeId(raw);
        if (id) {
          entry = { kind: "video", id };
          if (image) image.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
          if (badge) badge.textContent = "▶";
        } else {
          const parsed = parseImageUrl(raw);
          if (parsed.url) {
            entry = { kind: "image", url: parsed.url };
            if (image) image.src = parsed.url;
            if (badge) badge.textContent = "🖼";
          } else {
            message = parsed.error;
            if (badge) badge.textContent = "🔗";
          }
        }
      } else if (badge) {
        badge.textContent = "🔗";
      }
    }

    if (thumb) thumb.hidden = !entry;
    if (error) {
      error.hidden = !message;
      error.textContent = message;
    }
    row.classList.toggle("has-media", Boolean(entry));
    row.classList.toggle("has-error", Boolean(message));
    return entry;
  }

  function sync() {
    const entries = [];
    const files = [];
    for (const row of list?.querySelectorAll("[data-row]") || []) {
      const entry = readRow(row);
      if (!entry) continue;
      if (entry.file) {
        const row = entry.file;
        if (!fileUrls.has(row)) fileUrls.set(row, URL.createObjectURL(row));
        entries.push({ kind: "image", upload: files.length, url: fileUrls.get(row) });
        files.push(row);
      } else {
        entries.push(entry);
      }
      if (entries.length >= MEDIA_MAX) break;
    }
    // Only the first item is placed in the post body; the rest ride in the
    // strip beneath it, so adding a second must not move the marker.
    if (entries.length && !seenFirst) {
      seenFirst = true;
      ensureVideoMarker(aboutEditor(form));
    }
    if (!entries.length) seenFirst = false;
    if (payload) {
      payload.value = JSON.stringify(
        entries.map((entry) =>
          entry.upload === undefined ? entry : { kind: "image", upload: entry.upload }
        )
      );
    }
    mediaFilesByForm.set(form, files);
    onMedia(entries);
  }

  bindRowList(list, { max: MEDIA_MAX, min: 1, onChange: sync });
  list?.addEventListener("input", sync);
  list?.addEventListener("change", sync);
  seenFirst = (list?.querySelectorAll("[data-row].has-media").length || 0) > 0;
  sync();
  return sync;
}

function bindRoleRows(form, onChange) {
  const list = form.querySelector("[data-row-list='role']");
  const payload = form.elements.roles;
  const sync = () => {
    if (payload) {
      payload.value = JSON.stringify(readRoleRows(form).filter((role) => role.name.trim()));
    }
    onChange?.();
  };
  bindRowList(list, {
    max: ROLE_MAX,
    min: 0,
    onChange: sync,
    onRowAdded: (row) => bindRowEditors(row, sync),
  });
  list?.querySelectorAll("[data-row]").forEach((row) => bindRowEditors(row, sync));
  list?.addEventListener("input", sync);
  list?.addEventListener("change", sync);
  sync();
}

function bindLinkRows(form, onChange) {
  const list = form.querySelector("[data-row-list='link']");
  bindRowList(list, { max: LINK_MAX, min: 0, onChange });
  list?.addEventListener("input", onChange);
  list?.addEventListener("change", onChange);
}

// The form holds four editors now, and only the post body can take a clip.
// Name it rather than trusting it to be the first one in the markup.
function aboutEditor(form) {
  return form.querySelector('[data-rich-field="about"] [data-rich-editor]');
}

function insertVideoAtEditor(editor) {
  if (!editor) return;
  editor.querySelectorAll("[data-video]").forEach((el) => el.remove());
  const mark = document.createElement("span");
  mark.setAttribute("data-video", "");
  mark.className = "rt-video-mark";
  mark.contentEditable = "false";
  const sel = window.getSelection();
  const inEditor = sel?.anchorNode && editor.contains(sel.anchorNode);
  if (sel?.rangeCount && inEditor) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(mark);
    range.setStartAfter(mark);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(mark);
  }
}

function decorateVideoMarks(editor) {
  const marks = [...editor.querySelectorAll("[data-video]")];
  marks.forEach((el, index) => {
    if (index > 0) {
      el.remove();
      return;
    }
    el.className = "rt-video-mark";
    el.contentEditable = "false";
  });
}

function decorateCustomEmojis(editor) {
  editor.querySelectorAll("img[data-emoji]").forEach((img) => {
    const item = (state.emojis || []).find((entry) => entry.id === img.dataset.emoji);
    if (!item) {
      img.remove();
      return;
    }
    img.className = "msg-emoji";
    img.src = item.url;
    img.alt = `:${item.name}:`;
    img.contentEditable = "false";
    img.draggable = false;
  });
}

function ensureVideoMarker(editor) {
  if (!editor || editor.querySelector("[data-video]")) return;
  insertVideoAtEditor(editor);
  decorateVideoMarks(editor);
  const textarea = editor.closest("[data-rich-field]")?.querySelector("textarea");
  if (textarea) {
    textarea.value = sanitizePostHtml(editor.innerHTML);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// The composer now carries four of these - the post body and the three
// optional boxes - so this binds one editor rather than reaching for the form's
// single `about` field. The video marker only exists in the post body, which is
// the one field whose editor has a Video button.
function bindRichTextField(field, onChange) {
  const editor = field.querySelector("[data-rich-editor]");
  const toolbar = field.querySelector(".richtext-toolbar");
  const textarea = field.querySelector("textarea");
  if (!editor || !textarea) return;
  const hasVideo = Boolean(toolbar?.querySelector("[data-insert-video]"));
  const shell = field.matches("[data-plain-limit]") ? field : field.querySelector("[data-plain-limit]");
  const limit = Number(shell?.dataset.plainLimit || 0);

  function roomLeft() {
    return limit - plainTextFromHtml(editor.innerHTML).length;
  }

  function paintPlaceholder() {
    editor.classList.toggle("is-empty", !plainTextFromHtml(editor.innerHTML).trim());
  }

  function sync() {
    if (hasVideo) decorateVideoMarks(editor);
    decorateCustomEmojis(editor);
    editor.querySelectorAll("a").forEach((link) => {
      const safe = isSafeHref(link.getAttribute("href"));
      if (!safe) {
        link.replaceWith(...link.childNodes);
        return;
      }
      link.setAttribute("href", safe);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });
    textarea.value = sanitizePostHtml(editor.innerHTML);
    paintPlaceholder();
    onChange?.();
  }

  editor.innerHTML = toEditorHtml(textarea.value);
  if (hasVideo) decorateVideoMarks(editor);
  decorateCustomEmojis(editor);
  textarea.value = sanitizePostHtml(editor.innerHTML);
  paintPlaceholder();

  toolbar?.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });

  toolbar?.addEventListener("click", (event) => {
    const insert = event.target.closest("[data-insert-video]");
    if (insert) {
      editor.focus();
      insertVideoAtEditor(editor);
      sync();
      return;
    }
    const btn = event.target.closest("[data-rt]");
    if (!btn) return;
    editor.focus();
    const cmd = btn.dataset.rt;
    if (cmd === "bold") document.execCommand("bold");
    if (cmd === "italic") document.execCommand("italic");
    if (cmd === "underline") document.execCommand("underline");
    if (cmd === "ulist") document.execCommand("insertUnorderedList");
    if (cmd === "olist") document.execCommand("insertOrderedList");
    if (cmd === "link") {
      const current = window.getSelection()?.toString() || "";
      const url = window.prompt("Link URL", current.startsWith("http") ? current : "https://");
      const safe = isSafeHref(url);
      if (!safe) return;
      document.execCommand("createLink", false, safe);
    }
    sync();
  });

  const emojiPop = field.querySelector("[data-emoji-pop]");
  const emojiToggle = field.querySelector("[data-emoji-toggle]");
  emojiToggle?.addEventListener("click", () => {
    const willOpen = emojiPop?.hidden;
    closeEmojiPops();
    if (willOpen && emojiPop) {
      emojiPop.hidden = false;
      emojiToggle.setAttribute("aria-expanded", "true");
    }
  });
  emojiPop?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-emoji-tab]");
    if (tab) {
      const which = tab.dataset.emojiTab;
      emojiPop.querySelectorAll("[data-emoji-tab]").forEach((btn) => {
        const on = btn === tab;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      emojiPop.querySelectorAll("[data-emoji-pane]").forEach((pane) => {
        pane.hidden = pane.dataset.emojiPane !== which;
      });
      return;
    }
    const unicode = event.target.closest("[data-insert-emoji]");
    if (unicode) {
      const char = unicode.dataset.insertEmoji || "";
      if (limit && roomLeft() < char.length) return;
      editor.focus();
      document.execCommand("insertText", false, char);
      sync();
      return;
    }
    const custom = event.target.closest("[data-insert-custom]");
    if (custom) {
      const item = (state.emojis || []).find((entry) => entry.id === custom.dataset.insertCustom);
      if (!item) return;
      if (limit && roomLeft() < 2) return;
      editor.focus();
      document.execCommand("insertHTML", false, `<img data-emoji="${item.id}">`);
      sync();
    }
  });

  // The budget has to bite while typing, or the leader writes a paragraph the
  // server will quietly cut. Deleting and replacing a selection always pass -
  // both of those are how you get back under the limit.
  if (limit) {
    editor.addEventListener("beforeinput", (event) => {
      if (!event.inputType?.startsWith("insert")) return;
      if (!window.getSelection()?.isCollapsed) return;
      if (roomLeft() > 0) return;
      event.preventDefault();
    });
  }

  editor.addEventListener("input", sync);
  editor.addEventListener("blur", paintPlaceholder);
  editor.addEventListener("click", (event) => {
    if (event.target.closest("a")) event.preventDefault();
  });
  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html");
    const text = event.clipboardData?.getData("text/plain") || "";
    // Paste is the one way past the keystroke cap, so what lands is trimmed to
    // what is left. Formatting goes with it - a clip that has to be cut is
    // pasted as the plain text that fits.
    const room = limit ? roomLeft() : Infinity;
    if (limit && room <= 0) return;
    const fits = !limit || plainTextFromHtml(html || text).length <= room;
    const source = fits ? html : "";
    const plain = fits ? text : fitPlain(text, room);
    const clean = source
      ? sanitizePostHtml(source)
      : sanitizePostHtml(plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"));
    document.execCommand("insertHTML", false, clean || plain);
    sync();
  });
}

function bindRichText(form, onChange) {
  form.querySelectorAll("[data-rich-field]").forEach((field) => bindRichTextField(field, onChange));
}

// Every editor inside one row, wired the same way the form-level ones are.
function bindRowEditors(row, onChange) {
  row.querySelectorAll("[data-rich-editor-shell]").forEach((shell) => bindRichTextField(shell, onChange));
}

// The preview is the published page in miniature, so it renders through the
// same listingSections() the listing page uses. Anything that only lived here
// would drift from what actually gets published - which is exactly what the
// three boxes did while the preview showed the post body and nothing else.
function previewHtml(cardHtml, form, media, sectionsFor = listingSections) {
  const sections = sectionsFor({
    offering: form.elements.offering?.value,
    requirements: form.elements.requirements?.value,
    howToJoin: form.elements.howToJoin?.value,
  });
  return `${cardHtml}<div class="preview-about"><p class="kicker">Post body</p>${postBodyHtml(
    form.about.value,
    media.entries,
    { placeholder: true }
  )}${sections}</div>`;
}

// A field's budget is only useful while it is being spent, so the count is
// repainted on the same pass that repaints the preview. The control it belongs
// to is whichever one shares its box - a rich editor if there is one, the
// input or textarea otherwise.
function usedChars(box) {
  const editor = box.querySelector("[data-rich-editor]");
  if (editor) return plainTextFromHtml(editor.innerHTML).length;
  return (box.querySelector("input, textarea")?.value || "").length;
}

function paintCharCounts(root) {
  root.querySelectorAll("[data-char-count]").forEach((count) => {
    const box = count.closest("fieldset, .role-body") || root;
    const state = counterState(usedChars(box), Number(count.dataset.max));
    count.textContent = `${state.used} / ${state.max}`;
    count.classList.toggle("is-near", state.near);
    count.classList.toggle("is-over", state.over);
  });
}

function bindListingComposer(form, { imageUrl = null, onChange }) {
  const media = { image: imageUrl, entries: [] };
  const refresh = () => {
    paintCharCounts(form);
    onChange(media);
  };
  bindRichText(form, refresh);
  bindImagePicker(form, imageUrl, (url) => {
    media.image = url;
    refresh();
  });
  bindMediaRows(form, (entries) => {
    media.entries = entries;
    refresh();
  });
  bindLinkRows(form, refresh);
  bindRoleRows(form, refresh);
  form.addEventListener("input", refresh);
  refresh();
}

// The list fields sync into hidden textareas, and a hidden `required` control
// makes reportValidity throw rather than point at anything, so they are checked
// by hand. "How to join" is genuinely optional and so is left out.
// Offer, requirements and how-to-join are optional: an empty one is a section
// the listing does not show. Length is the only thing left that can fail, and
// it names the box so the leader knows which one to cut.
const SECTION_LABELS = {
  offering: "What you offer",
  requirements: "Requirements",
  howToJoin: "How to join",
};

function sectionError(form) {
  for (const [name, label] of Object.entries(SECTION_LABELS)) {
    const value = form.elements[name]?.value;
    if (value === undefined) continue;
    const tooLong = sectionTooLong(value, `"${label}"`);
    if (tooLong) return tooLong;
  }
  return null;
}

function aboutError(form) {
  if (!plainTextFromHtml(form.about?.value || "")) return "Write the full post.";
  return aboutTooLong(form.about.value);
}

function mediaTooLarge(form) {
  if (form.image?.files?.[0] && form.image.files[0].size > IMAGE_MAX) {
    return "Image must be 2 MB or smaller.";
  }
  const rows = [...form.querySelectorAll("[data-row-list='media'] [data-row]")];
  for (const [index, row] of rows.entries()) {
    const file = row.querySelector("input[type='file']")?.files?.[0];
    if (file && file.size > IMAGE_MAX) return "Each image must be 2 MB or smaller.";
    const raw = String(row.querySelector("[data-media-url]")?.value || "").trim();
    if (!raw) continue;
    if (parseYouTubeId(raw)) continue;
    const parsed = parseImageUrl(raw);
    if (parsed.error) return `Item ${index + 1}: ${parsed.error}`;
  }
  for (const input of form.querySelectorAll("[data-link-url]")) {
    const raw = String(input.value || "").trim();
    if (raw && !isSafeHref(raw)) return "Links must start with http:// or https://.";
  }
  return null;
}

// Says the same thing the server does, but before a round trip, so a leader
// who cleared the invite finds out here rather than on submit.
function contactRouteMissing(form, user, { whisper = true } = {}) {
  const contact = form.contact?.value || "both";
  const discord = String(form.discord?.value || "").trim();
  if (discord && contact !== "whisper") return null;
  if (whisper && contact !== "discord" && user?.forumName) return null;
  if (readLinkRows(form).some((link) => isSafeHref(link.url))) return null;
  return whisper
    ? "Give recruits at least one way to reach you: a Discord invite, a verified forum name, or a link."
    : "Give recruits at least one way to reach you: a Discord invite or a link.";
}

function playerRouteMissing(form, user) {
  const contact = form.contact?.value || "both";
  const name = normalizeDiscordName(form.discordName?.value);
  if (name && contact !== "whisper") return null;
  if (contact !== "discord" && user?.forumName) return null;
  if (readLinkRows(form).some((link) => isSafeHref(link.url))) return null;
  return "Give clans at least one way to reach you: a Discord username, a verified forum name, or a link.";
}

function packForm(form, ...listFields) {
  const fd = new FormData(form);
  for (const listField of listFields) {
    const values = fd.getAll(listField);
    fd.delete(listField);
    fd.set(listField, JSON.stringify(values));
  }
  // The link rows are unnamed inputs, so they never reach FormData on their
  // own; the hidden `links` field carries them as one JSON payload.
  fd.set("links", JSON.stringify(readLinkRows(form).filter((link) => link.url.trim())));
  // Replace the browser's version of the file inputs - which includes the empty
  // ones - with exactly the files the media payload counted, in that order.
  fd.delete("mediaImage");
  for (const file of mediaFilesByForm.get(form) || []) fd.append("mediaImage", file, file.name);
  return fd;
}

async function render() {
  const { path, params } = parseRoute();
  closeDrawer();
  // Leaving a page closes its menus. Page content is rebuilt below, so this is
  // really about the nav: the account menu lives outside #app and would
  // otherwise still be hanging open on the page you just navigated to.
  closeMenus();
  setActiveNav(path);
  window.scrollTo({ top: 0, behavior: "instant" });
  const messagesMatch = path === "/messages";
  const clanMatch = path.match(/^\/clans\/([^/]+)$/);
  const allianceMatch = path.match(/^\/alliances\/([^/]+)$/);
  const playerMatch = path.match(/^\/players\/([^/]+)$/);
  document.title =
    path === "/privacy"
      ? "Privacy Policy — WF Clan Recruit"
      : path === "/guide"
        ? "How it works — WF Clan Recruit"
        : path === "/register"
          ? "Create an account — WF Clan Recruit"
          : path === "/login"
            ? "Sign in — WF Clan Recruit"
            : path === "/admin"
              ? "Staff — WF Clan Recruit"
              : "WF Clan Recruit — Warframe Clans & Alliances";

  if (path === "/browse") {
    const { filters: initial, page: startPage } = filtersFromSearch(window.location.search);
    let page = startPage;
    const windowed = paginate(applyClanFilters(state.clans, initial), page);
    page = windowed.page;
    app.innerHTML = browseView(windowed.items, initial, windowed, roleFilterOptions(state.clans));
    const form = app.querySelector("#filter-form");
    const paint = (nextPage = 1) => {
      const next = readFilters(form);
      const badge = app.querySelector("[data-filter-count]");
      const activeCount = activeFilterCount(next);
      if (badge) { badge.textContent = String(activeCount); badge.hidden = activeCount === 0; }
      const list = applyClanFilters(state.clans, next);
      const windowedNext = paginate(list, nextPage);
      page = windowedNext.page;
      const mr = app.querySelector("#mr-readout");
      if (mr) mr.innerHTML = masteryDisplay(next.mr, false);
      const count = app.querySelector("#result-count");
      if (count) count.textContent = windowedNext.total === 1 ? "1 clan" : `${windowedNext.total} clans`;
      const results = app.querySelector("#results");
      results.innerHTML = clanResultsHtml(windowedNext.items, next, windowedNext);
      bindCards(results);
      const qs = filtersToSearch(next, page);
      const nextUrl = `/browse${qs}`;
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        history.replaceState({}, "", nextUrl);
      }
    };
    bindFilterUpdates(app.querySelector(".browse"), paint);
    bindFiltersToggle();
    app.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
      resetFilterForm(form);
      paint(1);
    });
    app.querySelector("#results")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button || button.disabled) return;
      paint(Number(button.dataset.page));
      app.querySelector("#results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    bindCards();
    return;
  }

  if (path === "/alliances") {
    const { filters: initial, page: startPage } = filtersFromSearch(window.location.search);
    let page = startPage;
    const windowed = paginate(applyAllianceFilters(state.alliances, initial), page);
    page = windowed.page;
    app.innerHTML = alliancesView(windowed.items, initial, windowed);
    const form = app.querySelector("#filter-form");
    const paint = (nextPage = 1) => {
      const next = readFilters(form);
      const badge = app.querySelector("[data-filter-count]");
      const activeCount = activeFilterCount(next);
      if (badge) { badge.textContent = String(activeCount); badge.hidden = activeCount === 0; }
      const list = applyAllianceFilters(state.alliances, next);
      const windowedNext = paginate(list, nextPage);
      page = windowedNext.page;
      const count = app.querySelector("#result-count");
      if (count) count.textContent = windowedNext.total === 1 ? "1 alliance" : `${windowedNext.total} alliances`;
      const results = app.querySelector("#results");
      results.innerHTML = allianceResultsHtml(windowedNext.items, next, windowedNext);
      bindCards(results);
      const qs = filtersToSearch(next, page);
      const nextUrl = `/alliances${qs}`;
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        history.replaceState({}, "", nextUrl);
      }
    };
    bindFilterUpdates(app.querySelector(".browse"), paint);
    bindFiltersToggle();
    app.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
      resetFilterForm(form);
      paint(1);
    });
    app.querySelector("#results")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button || button.disabled) return;
      paint(Number(button.dataset.page));
      app.querySelector("#results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    bindCards();
    return;
  }

  if (messagesMatch) {
    document.title = "Messages — WF Clan Recruit";
    if (!state.user) {
      app.innerHTML = messagesView({ user: null, threads: [] });
      return;
    }
    // The ignore list is its own tab rather than its own page: it is the same
    // inbox seen from the other side, and the only place a block can be lifted
    // once you have stopped opening the conversation it was made in.
    if (params.tab === "ignore") {
      app.innerHTML = messagesView({ user: state.user, threads: [], tab: "ignore" });
      await loadIgnoreList();
      return;
    }
    try {
      state.threads = (await api.inbox()).threads;
    } catch {
      state.threads = [];
    }
    app.innerHTML = messagesView({ user: state.user, threads: state.threads });
    // An empty inbox renders no thread list and no conversation panel, so there
    // is nothing below this to bind.
    if (!state.threads.length) return;
    // ?thread= is what the Message button on a listing redirects to, so a
    // conversation opened from a post lands on that conversation.
    if (params.thread) await openConversation(params.thread);
    app.querySelector("[data-thread-list]")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-thread]");
      if (!row) return;
      openConversation(row.dataset.thread);
    });
    return;
  }

  if (path === "/players") {
    const { filters: initial, page: startPage } = filtersFromSearch(window.location.search);
    let page = startPage;
    const windowed = paginate(applyPlayerFilters(state.players, initial), page);
    page = windowed.page;
    app.innerHTML = playersView(windowed.items, initial, windowed);
    const form = app.querySelector("#filter-form");
    const paint = (nextPage = 1) => {
      const next = readFilters(form);
      const badge = app.querySelector("[data-filter-count]");
      const activeCount = activeFilterCount(next);
      if (badge) { badge.textContent = String(activeCount); badge.hidden = activeCount === 0; }
      const list = applyPlayerFilters(state.players, next);
      const windowedNext = paginate(list, nextPage);
      page = windowedNext.page;
      const mr = app.querySelector("#mr-readout");
      if (mr) mr.innerHTML = masteryDisplay(next.mr, false);
      const count = app.querySelector("#result-count");
      if (count) count.textContent = windowedNext.total === 1 ? "1 player" : `${windowedNext.total} players`;
      const results = app.querySelector("#results");
      results.innerHTML = playerResultsHtml(windowedNext.items, next, windowedNext);
      bindCards(results);
      const qs = filtersToSearch(next, page);
      const nextUrl = `/players${qs}`;
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        history.replaceState({}, "", nextUrl);
      }
    };
    bindFilterUpdates(app.querySelector(".browse"), paint);
    bindFiltersToggle();
    app.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
      resetFilterForm(form);
      paint(1);
    });
    app.querySelector("#results")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button || button.disabled) return;
      paint(Number(button.dataset.page));
      app.querySelector("#results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    bindCards();
    return;
  }

  if (path === "/post") {
    // The edit form must never prefill from a trimmed list entry: submitting it
    // would save an empty post body over the real one. Always load the full
    // record before filling the form.
    const draft = params.id ? await fullListing("clan", params.id) : null;
    if (params.id && !draft) {
      app.innerHTML = `<section class="auth-card"><h1>Listing not found</h1><p class="muted">That clan post is gone or the link is wrong.</p></section>`;
      return;
    }
    // An editor on the listing gets the same form; the server is the authority,
    // and this only decides whether to bother rendering it.
    const editorHere = (state.user?.recruitingOn || []).some(
      (item) => item.id === draft?.id && item.role === "editor"
    );
    if (draft && state.user && draft.ownerId !== state.user.id && !state.user.admin && !editorHere) {
      app.innerHTML = `<section class="auth-card"><h1>Not allowed</h1><p class="muted">You do not have edit access to that post.</p></section>`;
      return;
    }
    app.innerHTML = postView({ user: state.user, alliances: state.alliances, draft: draft || {}, auth: state.auth });
    bindRecruiters();
    const form = app.querySelector("#post-form");
    // The invite is optional everywhere now, so this only relabels the box: a
    // whisper-only listing does not publish one at all.
    const contact = form?.querySelector("[data-contact]");
    const syncContact = () => {
      const hint = form.querySelector("[data-discord-hint]");
      const used = contact.value !== "whisper";
      if (hint) {
        hint.textContent = used
          ? "optional, permanent invite — we check it"
          : "not shown on this listing";
      }
    };
    contact?.addEventListener("change", syncContact);
    if (contact) syncContact();
    if (!form) {
      bindForumForm();
      return;
    }
    const preview = app.querySelector("#live-preview");
    const note = app.querySelector("#form-note");
    const mr = app.querySelector("#post-mr");
    bindListingComposer(form, {
      imageUrl: draft?.image || null,
      onChange: (media) => {
        if (mr) mr.innerHTML = masteryDisplay(form.mrRequired.value, false);
        if (form.tag) form.tag.value = form.tag.value.toUpperCase();
        preview.innerHTML = previewHtml(clanCard(previewClan(form, media.image, media.entries)), form, media);
      },
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        showNote(note, "Fill every required field.");
        form.reportValidity();
        return;
      }
      const tooBig =
        mediaTooLarge(form) || aboutError(form) || contactRouteMissing(form, state.user) || sectionError(form);
      if (tooBig) {
        showNote(note, tooBig);
        return;
      }
      try {
        const payload = packForm(form, "playstyles");
        const result = draft
          ? await api.updateClan(draft.id, payload)
          : await api.createClan(payload);
        await refresh();
        go(`/clans/${result.clan.id}`);
      } catch (error) {
        showNote(note, error.message);
      }
    });
    return;
  }

  if (path === "/post-alliance") {
    const draft = params.id ? await fullListing("alliance", params.id) : null;
    if (params.id && !draft) {
      app.innerHTML = `<section class="auth-card"><h1>Listing not found</h1><p class="muted">That alliance post is gone or the link is wrong.</p></section>`;
      return;
    }
    if (draft && state.user && draft.ownerId !== state.user.id && !state.user.admin) {
      app.innerHTML = `<section class="auth-card"><h1>Not allowed</h1><p class="muted">You can only edit your own posts.</p></section>`;
      return;
    }
    app.innerHTML = alliancePostView({
      user: state.user,
      draft: draft || {},
      auth: state.auth,
      clans: state.clans,
    });
    const form = app.querySelector("#alliance-form");
    if (!form) {
      bindForumForm();
      return;
    }
    const preview = app.querySelector("#live-preview");
    const note = app.querySelector("#form-note");
    bindListingComposer(form, {
      imageUrl: draft?.image || null,
      onChange: (media) => {
        if (form.tag) form.tag.value = form.tag.value.toUpperCase();
        preview.innerHTML = previewHtml(allianceCard(previewAlliance(form, media.image, media.entries)), form, media);
      },
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        showNote(note, "Fill every required field.");
        form.reportValidity();
        return;
      }
      const tooBig =
        mediaTooLarge(form) ||
        aboutError(form) ||
        contactRouteMissing(form, state.user, { whisper: false }) ||
        sectionError(form);
      if (tooBig) {
        showNote(note, tooBig);
        return;
      }
      try {
        const payload = packForm(form, "platforms", "rosterIds");
        const result = draft
          ? await api.updateAlliance(draft.id, payload)
          : await api.createAlliance(payload);
        await refresh();
        go(`/alliances/${result.alliance.id}`);
      } catch (error) {
        showNote(note, error.message);
      }
    });
    return;
  }

  // One profile per account, so this route is an upsert rather than a "new
  // post" page: it finds yours if you have one and edits it in place.
  if (path === "/lfc") {
    const own = state.user ? state.players.find((item) => item.ownerId === state.user.id) : null;
    const draft = own ? await fullListing("player", own.id) : null;
    app.innerHTML = playerPostView({ user: state.user, draft: draft || {}, auth: state.auth });
    const form = app.querySelector("#player-form");
    if (!form) return;
    const contact = form.querySelector("[data-contact]");
    const syncContact = () => {
      const hint = form.querySelector("[data-discord-hint]");
      if (hint) {
        hint.textContent =
          contact.value !== "whisper"
            ? "optional, the name clans type into Add Friend"
            : "not shown on this profile";
      }
    };
    contact?.addEventListener("change", syncContact);
    if (contact) syncContact();
    const preview = app.querySelector("#live-preview");
    const note = app.querySelector("#form-note");
    const mr = app.querySelector("#player-mr");
    const avatar = state.user?.discordAvatarUrl || null;
    bindListingComposer(form, {
      imageUrl: avatar,
      onChange: (media) => {
        if (mr) mr.innerHTML = masteryDisplay(form.mr.value, false);
        preview.innerHTML = previewHtml(
          playerCard(previewPlayer(form, avatar, media.entries)),
          form,
          media,
          playerSections
        );
      },
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        showNote(note, "Fill every required field.");
        form.reportValidity();
        return;
      }
      const name = normalizeDiscordName(form.discordName.value);
      if (name && !isDiscordName(name)) {
        showNote(note, "That is not a Discord username. Use the name you would type into Add Friend.");
        return;
      }
      const blocked =
        mediaTooLarge(form) || aboutError(form) || playerRouteMissing(form, state.user) || sectionError(form);
      if (blocked) {
        showNote(note, blocked);
        return;
      }
      // The server checks this too - it is the one claim on a profile that
      // needs proof - but saying it here saves a round trip and points at the
      // control that caused it.
      if (form.contact.value !== "discord" && !state.user?.forumName) {
        showNote(note, "Verify your Warframe Forum account before you publish an in-game name.");
        return;
      }
      try {
        const payload = packForm(form, "playstyles", "wantsTiers");
        const result = draft
          ? await api.updatePlayer(draft.id, payload)
          : await api.createPlayer(payload);
        await refresh();
        go(`/players/${result.player.id}`);
      } catch (error) {
        showNote(note, error.message);
      }
    });
    return;
  }

  if (path === "/login" || path === "/register") {
    const next = params.next || "/account";
    app.innerHTML = authView(path.slice(1), next, {
      error: params.error || "",
      discord: Boolean(state.auth.discord),
      passwordRegister: Boolean(state.auth.passwordRegister),
    });
    const form = app.querySelector("#auth-form");
    const note = app.querySelector("#form-note");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = form.username.value.trim();
      const password = form.password.value;
      try {
        if (path === "/login") await api.login(username, password);
        else await api.register(username, password);
        await refresh();
        go(next.startsWith("/") ? next : `/${next}`);
      } catch (error) {
        showNote(note, error.message);
      }
    });
    return;
  }

  if (path === "/account") {
    if (!state.user) {
      go("/login?next=/account");
      return;
    }
    const mineClans = state.user.admin
      ? state.clans
      : state.clans.filter((item) => item.ownerId === state.user.id);
    const mineAlliances = state.user.admin
      ? state.alliances
      : state.alliances.filter((item) => item.ownerId === state.user.id);
    const minePlayers = state.user.admin
      ? state.players
      : state.players.filter((item) => item.ownerId === state.user.id);
    let reports = [];
    if (state.user.admin) {
      try {
        reports = (await api.reports()).reports || [];
      } catch {
        reports = [];
      }
    }
    app.innerHTML = accountView({
      user: state.user,
      clans: mineClans,
      alliances: mineAlliances,
      players: minePlayers,
      reports,
    });
    bindForumForm();
    bindRecruiters();
    return;
  }

  if (path === "/admin") {
    if (!state.user) {
      go("/login?next=/admin");
      return;
    }
    if (!state.user.admin) {
      app.innerHTML = `<section class="auth-card"><h1>Staff only</h1><p class="muted">This page is for people who already run the board.</p><p><a href="/account" data-link>Back to your account</a></p></section>`;
      return;
    }
    let staff = { admins: [], pending: [] };
    let reports = [];
    try {
      staff = await api.staff();
    } catch {
      app.innerHTML = `<section class="auth-card"><h1>Could not load staff</h1><p class="muted">Try again in a moment.</p></section>`;
      return;
    }
    try {
      reports = (await api.reports()).reports || [];
    } catch {
      reports = [];
    }
    app.innerHTML = adminView({ user: state.user, staff, reports, emojis: state.emojis });
    bindStaffForm();
    bindEmojiForm();
    return;
  }

  if (clanMatch) {
    const clan = await fullListing("clan", clanMatch[1]);
    if (!clan) {
      app.innerHTML = `<section class="auth-card"><h1>Listing not found</h1><p class="muted">That clan post is gone or the link is wrong.</p></section>`;
      return;
    }
    document.title = `${clan.name} — WF Clan Recruit`;
    app.innerHTML = clanPage(clan, {
      admin: Boolean(state.user?.admin),
      user: state.auth.messaging === false ? null : state.user,
    });
    bindListingPage();
    return;
  }

  if (allianceMatch) {
    const alliance = await fullListing("alliance", allianceMatch[1]);
    if (!alliance) {
      app.innerHTML = `<section class="auth-card"><h1>Listing not found</h1><p class="muted">That alliance post is gone or the link is wrong.</p></section>`;
      return;
    }
    document.title = `${alliance.name} — WF Clan Recruit`;
    app.innerHTML = alliancePage(alliance, {
      admin: Boolean(state.user?.admin),
      user: state.auth.messaging === false ? null : state.user,
    });
    bindListingPage();
    return;
  }

  if (playerMatch) {
    const player = await fullListing("player", playerMatch[1]);
    if (!player) {
      app.innerHTML = `<section class="auth-card"><h1>Profile not found</h1><p class="muted">That player profile is gone or the link is wrong.</p></section>`;
      return;
    }
    document.title = `${player.name} — WF Clan Recruit`;
    app.innerHTML = playerPage(player, {
      admin: Boolean(state.user?.admin),
      mine: Boolean(state.user && player.ownerId === state.user.id),
      user: state.auth.messaging === false ? null : state.user,
    });
    bindListingPage();
    return;
  }

  if (path === "/guide") {
    app.innerHTML = guideView();
    return;
  }

  if (path === "/privacy") {
    app.innerHTML = privacyView();
    return;
  }

  app.innerHTML = homeView(state);
  app.querySelector("[data-hero-search]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const destination = data.get("kind") === "alliances" ? "/alliances" : "/browse";
    go(`${destination}?q=${encodeURIComponent(String(data.get("q") || ""))}`);
  });
  bindCards();
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest("a[data-link]");
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    const url = new URL(link.href, window.location.origin);
    if (url.origin === window.location.origin) {
      event.preventDefault();
      closeDrawer();
      go(`${url.pathname}${url.search}`);
      return;
    }
  }
  if (event.target.closest("[data-link]")) closeDrawer();
  const jump = event.target.closest("[data-jump]");
  if (jump) {
    event.preventDefault();
    document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (event.target.closest("[data-logout]")) {
    stopLive();
    await api.logout();
    await refresh();
    go("/");
    return;
  }
  if (event.target.closest("[data-export-account]")) {
    event.preventDefault();
    try {
      const data = await api.exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const linkEl = document.createElement("a");
      linkEl.href = url;
      linkEl.download = "wf-clan-recruit-data.json";
      linkEl.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  if (event.target.closest("[data-delete-account]")) {
    event.preventDefault();
    if (!confirm("Delete your account, listings, and uploads from this site? This cannot be undone.")) return;
    try {
      await api.deleteAccount();
      await refresh();
      go("/");
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const pauseClan = event.target.closest("[data-pause-clan]");
  if (pauseClan) {
    event.preventDefault();
    try {
      await api.pauseClan(pauseClan.dataset.pauseClan, pauseClan.dataset.paused === "1");
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const pauseAlliance = event.target.closest("[data-pause-alliance]");
  if (pauseAlliance) {
    event.preventDefault();
    try {
      await api.pauseAlliance(pauseAlliance.dataset.pauseAlliance, pauseAlliance.dataset.paused === "1");
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const hideClan = event.target.closest("[data-hide-clan]");
  if (hideClan) {
    event.preventDefault();
    const hide = hideClan.dataset.hidden === "1";
    if (hide && !confirm("Hide this listing from the board? The owner keeps it, and you can unhide it later.")) return;
    try {
      await api.hideClan(hideClan.dataset.hideClan, hide);
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const hideAlliance = event.target.closest("[data-hide-alliance]");
  if (hideAlliance) {
    event.preventDefault();
    const hide = hideAlliance.dataset.hidden === "1";
    if (hide && !confirm("Hide this listing from the board? The owner keeps it, and you can unhide it later.")) return;
    try {
      await api.hideAlliance(hideAlliance.dataset.hideAlliance, hide);
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const pausePlayer = event.target.closest("[data-pause-player]");
  if (pausePlayer) {
    event.preventDefault();
    try {
      await api.pausePlayer(pausePlayer.dataset.pausePlayer, pausePlayer.dataset.paused === "1");
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const hidePlayer = event.target.closest("[data-hide-player]");
  if (hidePlayer) {
    event.preventDefault();
    const hide = hidePlayer.dataset.hidden === "1";
    if (hide && !confirm("Hide this profile from the board? The owner keeps it, and you can unhide it later.")) return;
    try {
      await api.hidePlayer(hidePlayer.dataset.hidePlayer, hide);
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const messageButton = event.target.closest("[data-message-listing]");
  if (messageButton) {
    event.preventDefault();
    event.stopPropagation();
    if (state.auth.messaging === false) {
      alert("Messaging is temporarily unavailable. Use the Discord or whisper details on the post.");
      return;
    }
    if (!state.user) {
      go(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    try {
      const { thread } = await api.openThread(
        messageButton.dataset.messageKind,
        messageButton.dataset.messageListing
      );
      go(`/messages?thread=${encodeURIComponent(thread.id)}`);
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const resolveReport = event.target.closest("[data-resolve-report]");
  if (resolveReport) {
    event.preventDefault();
    try {
      await api.resolveReport(resolveReport.dataset.resolveReport, resolveReport.dataset.status);
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const revokeAdmin = event.target.closest("[data-revoke-admin]");
  if (revokeAdmin) {
    event.preventDefault();
    if (!confirm("Remove admin access for this account?")) return;
    try {
      await api.revokeAdmin(revokeAdmin.dataset.revokeAdmin);
      await render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const revokePending = event.target.closest("[data-revoke-pending]");
  if (revokePending) {
    event.preventDefault();
    if (!confirm("Cancel this waiting grant?")) return;
    try {
      await api.revokeAdmin(revokePending.dataset.revokePending);
      await render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const deleteEmoji = event.target.closest("[data-delete-emoji]");
  if (deleteEmoji) {
    event.preventDefault();
    if (!confirm("Remove this emoji from the picker for everyone?")) return;
    try {
      const { emojis } = await api.deleteEmoji(deleteEmoji.dataset.deleteEmoji);
      state.emojis = emojis || [];
      await render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const deleteClan = event.target.closest("[data-delete-clan]");
  if (deleteClan) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Remove this clan post for everyone? This cannot be undone.")) return;
    try {
      await api.deleteClan(deleteClan.dataset.deleteClan);
    } catch (error) {
      alert(error.message);
      return;
    }
    await refresh();
    afterDelete("/clans");
    return;
  }
  const deleteAlliance = event.target.closest("[data-delete-alliance]");
  if (deleteAlliance) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Remove this alliance post for everyone? This cannot be undone.")) return;
    try {
      await api.deleteAlliance(deleteAlliance.dataset.deleteAlliance);
    } catch (error) {
      alert(error.message);
      return;
    }
    await refresh();
    afterDelete("/alliances");
    return;
  }
  const deletePlayer = event.target.closest("[data-delete-player]");
  if (deletePlayer) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Remove this player profile for everyone? This cannot be undone.")) return;
    try {
      await api.deletePlayer(deletePlayer.dataset.deletePlayer);
    } catch (error) {
      alert(error.message);
      return;
    }
    await refresh();
    afterDelete("/players");
    return;
  }
  const bumpPlayer = event.target.closest("[data-bump-player]");
  if (bumpPlayer && !bumpPlayer.disabled) {
    event.preventDefault();
    try {
      await api.bumpPlayer(bumpPlayer.dataset.bumpPlayer);
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const bumpClan = event.target.closest("[data-bump-clan]");
  if (bumpClan && !bumpClan.disabled) {
    event.preventDefault();
    try {
      await api.bumpClan(bumpClan.dataset.bumpClan);
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const bumpAlliance = event.target.closest("[data-bump-alliance]");
  if (bumpAlliance && !bumpAlliance.disabled) {
    event.preventDefault();
    try {
      await api.bumpAlliance(bumpAlliance.dataset.bumpAlliance);
      await refresh();
      render();
    } catch (error) {
      alert(error.message);
    }
  }
});

toggle.addEventListener("click", () => {
  const open = drawer.hidden;
  drawer.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("drawer-open", open);
});

window.addEventListener("popstate", () => {
  render().catch((error) => {
    app.innerHTML = `<section class="auth-card"><h1>Could not load</h1><p class="muted">${error.message}</p></section>`;
  });
});

nav.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", () => {
  nav.classList.toggle("is-scrolled", window.scrollY > 8);
});

migrateHash();
refresh()
  .then(() => render())
  .catch((error) => {
    app.innerHTML = `<section class="auth-card"><h1>Server offline</h1><p class="muted">Start the app with <code>npm run dev</code>. ${error.message}</p></section>`;
  });
