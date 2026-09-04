import { TIER_CAPS } from "./data.js";
import { api } from "./api.js";
import {
  accountView,
  allianceCard,
  alliancePage,
  alliancePostView,
  alliancesView,
  authView,
  browseView,
  clanCard,
  clanPage,
  emptyState,
  guideView,
  homeView,
  navAccount,
  postBodyHtml,
  postView,
  previewAlliance,
  previewClan,
  presenceSummary,
} from "./views.js";
import { privacyView } from "./privacy.js";
import { aboutTooLong, isSafeHref, plainTextFromHtml, sanitizePostHtml, toEditorHtml } from "./richtext.js";

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
      (match === "/alliances" && path.startsWith("/alliances/"));
    link.classList.toggle("is-active", active);
  });
}

function closeDrawer() {
  drawer.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("drawer-open");
}

function renderNav() {
  const html = navAccount(state.user, { discord: Boolean(state.auth.discord) });
  if (accountSlot) accountSlot.innerHTML = html;
  if (drawerAccount) drawerAccount.innerHTML = html;
}

async function refresh() {
  const [me, clansRes, alliancesRes] = await Promise.all([
    api.me().catch(() => ({ user: null })),
    api.clans(),
    api.alliances(),
  ]);
  state.user = me.user;
  state.auth = me.auth || state.auth;
  state.clans = clansRes.clans;
  state.alliances = alliancesRes.alliances;
  renderNav();
  startHeartbeat();
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

// Repaint the menu in place. Re-rendering the nav would close the open
// <details> the moment the user picked a status.
function paintPresence(presence) {
  document.querySelectorAll(".presence-menu").forEach((menu) => {
    const summary = menu.querySelector("summary");
    if (summary) summary.innerHTML = presenceSummary(presence.status);
    const select = menu.querySelector("[data-presence-status]");
    if (select) select.value = presence.status;
  });
}

document.addEventListener("change", async (event) => {
  const panel = event.target.closest(".presence-panel");
  if (!panel) return;
  const status = panel.querySelector("[data-presence-status]")?.value;
  const keep = Number(panel.querySelector("[data-presence-keep]")?.value || 0);
  const note = panel.querySelector("[data-presence-note]");
  try {
    const { presence } = await api.setPresence(status, keep);
    if (state.user) state.user.presence = presence;
    paintPresence(presence);
    showNote(
      note,
      presence.until
        ? `Held until ${new Date(presence.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
        : "",
      "muted"
    );
  } catch (error) {
    showNote(note, error.message);
  }
});

function platformMatches(value, filter) {
  return value === filter || value === "All Platforms";
}

function alliancePlatformMatches(platforms, filter) {
  const list = platforms || [];
  return list.includes(filter) || list.includes("All Platforms");
}

function applyClanFilters(clans, filters) {
  const q = filters.q.toLowerCase();
  const mr = Number(filters.mr || 0);
  let list = clans.filter((clan) => {
    const hay = [clan.name, clan.tag, clan.headline, clan.summary, clan.playstyles.join(" "), clan.allianceName || ""]
      .join(" ")
      .toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (filters.platform && !platformMatches(clan.platform, filters.platform)) return false;
    if (filters.tier && clan.tier !== filters.tier) return false;
    if (filters.playstyle && !clan.playstyles.includes(filters.playstyle)) return false;
    if (filters.region && clan.region !== filters.region) return false;
    if (filters.language && clan.language !== filters.language) return false;
    if (filters.status && clan.status !== filters.status) return false;
    if (filters.online && !clan.online) return false;
    if (mr > 0 && clan.mrRequired > mr) return false;
    return true;
  });
  if (filters.sort === "open") {
    const rank = { Open: 0, Selective: 1, "Trial Required": 2 };
    list.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  } else if (filters.sort === "space") {
    list.sort((a, b) => TIER_CAPS[b.tier] - b.members - (TIER_CAPS[a.tier] - a.members));
  } else if (filters.sort === "mr") {
    list.sort((a, b) => a.mrRequired - b.mrRequired);
  } else {
    list.sort((a, b) => {
      if (a.recruiting !== b.recruiting) return a.recruiting ? -1 : 1;
      return new Date(b.bumpedAt || b.createdAt) - new Date(a.bumpedAt || a.createdAt);
    });
  }
  return list;
}

function applyAllianceFilters(alliances, filters) {
  const q = filters.q.toLowerCase();
  return alliances
    .filter((item) => {
      const hay = [item.name, item.tag, item.headline, item.summary, (item.platforms || []).join(" ")]
        .join(" ")
        .toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (filters.platform && !alliancePlatformMatches(item.platforms, filters.platform)) return false;
      if (filters.region && item.region !== filters.region) return false;
      if (filters.language && item.language !== filters.language) return false;
      if (filters.status && item.status !== filters.status) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.recruiting !== b.recruiting) return a.recruiting ? -1 : 1;
      return new Date(b.bumpedAt || b.createdAt) - new Date(a.bumpedAt || a.createdAt);
    });
}

function readFilters(form) {
  const data = new FormData(form);
  return {
    q: String(data.get("q") || "").trim(),
    platform: String(data.get("platform") || ""),
    tier: String(data.get("tier") || ""),
    playstyle: String(data.get("playstyle") || ""),
    region: String(data.get("region") || ""),
    language: String(data.get("language") || ""),
    status: String(data.get("status") || ""),
    online: data.get("online") === "1",
    mr: String(data.get("mr") || "0"),
    sort: String(data.get("sort") || "newest"),
  };
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
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => {
        button.textContent = label;
      }, 2000);
    });
  });
}

function bindListingPage() {
  bindCopyText();
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
      else await api.reportClan(id, payload);
      showNote(note, "Report sent. Thanks.", "muted");
      form.querySelector("button[type='submit']").disabled = true;
    } catch (error) {
      showNote(note, error.message);
    }
  });
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

function showNote(el, message, kind = "error") {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
  el.classList.toggle("error", Boolean(message) && kind !== "muted");
  el.classList.toggle("muted", kind === "muted");
}

const IMAGE_MAX = 2 * 1024 * 1024;
const VIDEO_MAX = 25 * 1024 * 1024;

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

  clear?.addEventListener("click", () => {
    if (input) input.value = "";
    setFile(null);
  });
  input?.addEventListener("change", () => setFile(input.files?.[0] || null));

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
    const file = event.dataTransfer?.files?.[0];
    if (!file || !input) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    setFile(file);
  });
}

function bindVideoPicker(form, initialUrl, onUrl) {
  let videoUrl = initialUrl;
  const input = form.video;
  const picker = form.querySelector('[data-file-picker="video"]');
  const removeField = form.removeVideo;
  const label = picker?.querySelector("[data-file-label]");
  const hint = picker?.querySelector("[data-file-hint]");
  const action = picker?.querySelector("[data-file-action]");
  const preview = picker?.querySelector("[data-file-preview]");
  const clear = picker?.querySelector("[data-file-clear]");

  function setPreviewThumb(url) {
    if (!preview) return;
    preview.querySelector("video")?.remove();
    preview.style.backgroundImage = "";
    if (!url) return;
    const thumb = document.createElement("video");
    thumb.src = url;
    thumb.muted = true;
    thumb.playsInline = true;
    thumb.preload = "metadata";
    preview.appendChild(thumb);
  }

  function setFile(file, { keepExisting = false } = {}) {
    if (videoUrl && videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    if (file) {
      videoUrl = URL.createObjectURL(file);
      if (removeField) removeField.value = "";
    } else if (keepExisting) {
      videoUrl = initialUrl;
      if (removeField) removeField.value = "";
    } else {
      videoUrl = null;
      if (removeField) removeField.value = initialUrl ? "1" : "";
    }
    picker?.classList.toggle("has-file", Boolean(videoUrl));
    if (label) label.textContent = file ? file.name : videoUrl ? "Current video" : "Upload a video";
    if (hint) hint.hidden = Boolean(videoUrl);
    if (action) action.textContent = videoUrl ? "Replace" : "Choose video";
    if (clear) clear.hidden = !videoUrl;
    setPreviewThumb(videoUrl);
    onUrl(videoUrl);
  }

  if (initialUrl) setFile(null, { keepExisting: true });

  clear?.addEventListener("click", () => {
    if (input) input.value = "";
    setFile(null);
  });
  input?.addEventListener("change", () => {
    const file = input.files?.[0] || null;
    setFile(file);
    if (file) ensureVideoMarker(form.querySelector("[data-rich-editor]"));
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
    const file = event.dataTransfer?.files?.[0];
    if (!file || !input) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    setFile(file);
    ensureVideoMarker(form.querySelector("[data-rich-editor]"));
  });
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

function ensureVideoMarker(editor) {
  if (!editor || editor.querySelector("[data-video]")) return;
  insertVideoAtEditor(editor);
  decorateVideoMarks(editor);
  const textarea = editor.closest("form")?.about;
  if (textarea) {
    textarea.value = sanitizePostHtml(editor.innerHTML);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function bindRichText(form, onChange) {
  const editor = form.querySelector("[data-rich-editor]");
  const toolbar = form.querySelector(".richtext-toolbar");
  const textarea = form.about;
  if (!editor || !textarea) return;

  function sync() {
    decorateVideoMarks(editor);
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
    onChange?.();
  }

  editor.innerHTML = toEditorHtml(textarea.value);
  decorateVideoMarks(editor);
  textarea.value = sanitizePostHtml(editor.innerHTML);

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
    if (cmd === "link") {
      const current = window.getSelection()?.toString() || "";
      const url = window.prompt("Link URL", current.startsWith("http") ? current : "https://");
      const safe = isSafeHref(url);
      if (!safe) return;
      document.execCommand("createLink", false, safe);
    }
    sync();
  });

  editor.addEventListener("input", sync);
  editor.addEventListener("click", (event) => {
    if (event.target.closest("a")) event.preventDefault();
  });
  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html");
    const text = event.clipboardData?.getData("text/plain") || "";
    const clean = html
      ? sanitizePostHtml(html)
      : sanitizePostHtml(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"));
    document.execCommand("insertHTML", false, clean || text);
    sync();
  });
}

function bindListingComposer(form, { imageUrl = null, videoUrl = null, onChange }) {
  const media = { image: imageUrl, video: videoUrl };
  const refresh = () => onChange(media);
  bindRichText(form, refresh);
  bindImagePicker(form, imageUrl, (url) => {
    media.image = url;
    refresh();
  });
  bindVideoPicker(form, videoUrl, (url) => {
    media.video = url;
    refresh();
  });
  form.addEventListener("input", refresh);
  refresh();
}

function aboutError(form) {
  if (!plainTextFromHtml(form.about?.value || "")) return "Write the full post.";
  return aboutTooLong(form.about.value);
}

function mediaTooLarge(form) {
  if (form.image?.files?.[0] && form.image.files[0].size > IMAGE_MAX) {
    return "Image must be 2 MB or smaller.";
  }
  if (form.video?.files?.[0] && form.video.files[0].size > VIDEO_MAX) {
    return "Video must be 25 MB or smaller.";
  }
  return null;
}

function packForm(form, ...listFields) {
  const fd = new FormData(form);
  for (const listField of listFields) {
    const values = fd.getAll(listField);
    fd.delete(listField);
    fd.set(listField, JSON.stringify(values));
  }
  return fd;
}

async function render() {
  const { path, params } = parseRoute();
  closeDrawer();
  setActiveNav(path);
  window.scrollTo({ top: 0, behavior: "instant" });
  const clanMatch = path.match(/^\/clans\/([^/]+)$/);
  const allianceMatch = path.match(/^\/alliances\/([^/]+)$/);
  document.title =
    path === "/privacy"
      ? "Privacy Policy — WF Clan Recruit"
      : path === "/guide"
        ? "How it works — WF Clan Recruit"
        : path === "/register"
          ? "Create an account — WF Clan Recruit"
          : path === "/login"
            ? "Sign in — WF Clan Recruit"
            : "WF Clan Recruit — Warframe Clans & Alliances";

  if (path === "/browse") {
    const filters = {
      q: params.q || "",
      platform: params.platform || "",
      tier: "",
      playstyle: params.playstyle || "",
      region: params.region || "",
      language: params.language || "",
      status: params.status || "",
      online: params.online === "1",
      mr: "0",
      sort: "newest",
    };
    const filtered = applyClanFilters(state.clans, filters);
    app.innerHTML = browseView(filtered, filters);
    const form = app.querySelector("#filter-form");
    const refreshList = () => {
      const next = readFilters(form);
      const list = applyClanFilters(state.clans, next);
      const mr = app.querySelector("#mr-readout");
      if (mr) mr.textContent = next.mr;
      const count = app.querySelector("#result-count");
      if (count) count.textContent = list.length === 1 ? "1 clan" : `${list.length} clans`;
      const results = app.querySelector("#results");
      results.innerHTML = list.length
        ? `<div class="grid">${list.map((clan) => clanCard(clan)).join("")}</div>`
        : emptyState();
      bindCards(results);
    };
    app.querySelector(".browse")?.addEventListener("input", refreshList);
    app.querySelector(".browse")?.addEventListener("change", refreshList);
    app.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
      form.reset();
      form.mr.value = "0";
      refreshList();
    });
    bindCards();
    return;
  }

  if (path === "/alliances") {
    const filters = {
      q: params.q || "",
      platform: params.platform || "",
      region: params.region || "",
      language: params.language || "",
      status: params.status || "",
    };
    app.innerHTML = alliancesView(applyAllianceFilters(state.alliances, filters), filters);
    const form = app.querySelector("#filter-form");
    const refreshList = () => {
      const next = readFilters(form);
      const list = applyAllianceFilters(state.alliances, next);
      const host = app.querySelector(".browse > div:last-child");
      host.innerHTML = `<p class="muted">${list.length === 1 ? "1 alliance" : `${list.length} alliances`}</p>${
        list.length
          ? `<div class="grid two">${list.map((item) => allianceCard(item)).join("")}</div>`
          : emptyState()
      }`;
      bindCards(host);
    };
    app.querySelector(".browse")?.addEventListener("input", refreshList);
    app.querySelector(".browse")?.addEventListener("change", refreshList);
    app.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
      form.reset();
      refreshList();
    });
    bindCards();
    return;
  }

  if (path === "/post") {
    const draft = params.id ? state.clans.find((item) => item.id === params.id) : null;
    if (params.id && !draft) {
      app.innerHTML = `<section class="auth-card"><h1>Listing not found</h1><p class="muted">That clan post is gone or the link is wrong.</p></section>`;
      return;
    }
    if (draft && state.user && draft.ownerId !== state.user.id && !state.user.admin) {
      app.innerHTML = `<section class="auth-card"><h1>Not allowed</h1><p class="muted">You can only edit your own posts.</p></section>`;
      return;
    }
    app.innerHTML = postView({ user: state.user, alliances: state.alliances, draft: draft || {}, auth: state.auth });
    const form = app.querySelector("#post-form");
    if (!form) {
      bindForumForm();
      return;
    }
    const preview = app.querySelector("#live-preview");
    const note = app.querySelector("#form-note");
    const mr = app.querySelector("#post-mr");
    bindListingComposer(form, {
      imageUrl: draft?.image || null,
      videoUrl: draft?.video || null,
      onChange: (media) => {
        if (mr) mr.textContent = form.mrRequired.value;
        if (form.tag) form.tag.value = form.tag.value.toUpperCase();
        preview.innerHTML = `${clanCard(previewClan(form, media.image, media.video))}<div class="preview-about"><p class="kicker">Post body</p>${postBodyHtml(form.about.value, media.video, { placeholder: true })}</div>`;
      },
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        showNote(note, "Fill every required field.");
        form.reportValidity();
        return;
      }
      const tooBig = mediaTooLarge(form) || aboutError(form);
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
    const draft = params.id ? state.alliances.find((item) => item.id === params.id) : null;
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
      videoUrl: draft?.video || null,
      onChange: (media) => {
        if (form.tag) form.tag.value = form.tag.value.toUpperCase();
        preview.innerHTML = `${allianceCard(previewAlliance(form, media.image, media.video))}<div class="preview-about"><p class="kicker">Post body</p>${postBodyHtml(form.about.value, media.video, { placeholder: true })}</div>`;
      },
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        showNote(note, "Fill every required field.");
        form.reportValidity();
        return;
      }
      const tooBig = mediaTooLarge(form) || aboutError(form);
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
    let reports = [];
    if (state.user.admin) {
      try {
        reports = (await api.reports()).reports || [];
      } catch {
        reports = [];
      }
    }
    app.innerHTML = accountView({ user: state.user, clans: mineClans, alliances: mineAlliances, reports });
    bindForumForm();
    return;
  }

  if (clanMatch) {
    let clan = state.clans.find((item) => item.id === clanMatch[1]);
    if (!clan) {
      try {
        clan = (await api.clan(clanMatch[1])).clan;
      } catch {
        app.innerHTML = `<section class="auth-card"><h1>Listing not found</h1><p class="muted">That clan post is gone or the link is wrong.</p></section>`;
        return;
      }
    }
    document.title = `${clan.name} — WF Clan Recruit`;
    app.innerHTML = clanPage(clan, { admin: Boolean(state.user?.admin) });
    bindListingPage();
    return;
  }

  if (allianceMatch) {
    let alliance = state.alliances.find((item) => item.id === allianceMatch[1]);
    if (!alliance) {
      try {
        alliance = (await api.alliance(allianceMatch[1])).alliance;
      } catch {
        app.innerHTML = `<section class="auth-card"><h1>Listing not found</h1><p class="muted">That alliance post is gone or the link is wrong.</p></section>`;
        return;
      }
    }
    document.title = `${alliance.name} — WF Clan Recruit`;
    app.innerHTML = alliancePage(alliance, { admin: Boolean(state.user?.admin) });
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
    const q = new FormData(event.currentTarget).get("q");
    go(`/browse?q=${encodeURIComponent(String(q || ""))}`);
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
  const deleteClan = event.target.closest("[data-delete-clan]");
  if (deleteClan) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Remove this clan post for everyone?")) return;
    await api.deleteClan(deleteClan.dataset.deleteClan);
    await refresh();
    if (window.location.pathname.startsWith("/clans/")) go("/browse");
    else render();
    return;
  }
  const deleteAlliance = event.target.closest("[data-delete-alliance]");
  if (deleteAlliance) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Remove this alliance post for everyone?")) return;
    await api.deleteAlliance(deleteAlliance.dataset.deleteAlliance);
    await refresh();
    if (window.location.pathname.startsWith("/alliances/")) go("/alliances");
    else render();
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
