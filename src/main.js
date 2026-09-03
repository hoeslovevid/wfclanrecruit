import { TIER_CAPS } from "./data.js";
import { api } from "./api.js";
import {
  accountView,
  allianceCard,
  allianceModal,
  alliancePostView,
  alliancesView,
  authView,
  browseView,
  clanCard,
  clanModal,
  emptyState,
  guideView,
  homeView,
  navAccount,
  postView,
  previewAlliance,
  previewClan,
} from "./views.js";

const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modal-root");
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
};

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = hash.split("?");
  const params = Object.fromEntries(new URLSearchParams(query));
  return { path, params };
}

function setActiveNav(path) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    const match = link.dataset.route;
    link.classList.toggle("is-active", match === path || (match === "/post" && path === "/post-alliance"));
  });
}

function closeDrawer() {
  drawer.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("drawer-open");
}

function renderNav() {
  const html = navAccount(state.user);
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
  state.clans = clansRes.clans;
  state.alliances = alliancesRes.alliances;
  renderNav();
}

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
    if (filters.status && clan.status !== filters.status) return false;
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
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return list;
}

function applyAllianceFilters(alliances, filters) {
  const q = filters.q.toLowerCase();
  return alliances.filter((item) => {
    const hay = [item.name, item.tag, item.headline, item.summary, (item.platforms || []).join(" ")]
      .join(" ")
      .toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (filters.platform && !alliancePlatformMatches(item.platforms, filters.platform)) return false;
    if (filters.region && item.region !== filters.region) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
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
    status: String(data.get("status") || ""),
    mr: String(data.get("mr") || "0"),
    sort: String(data.get("sort") || "newest"),
  };
}

function openClan(id) {
  const clan = state.clans.find((item) => item.id === id);
  if (!clan) return;
  modalRoot.innerHTML = clanModal(clan, { admin: Boolean(state.user?.admin) });
  document.body.classList.add("modal-open");
}

function openAlliance(id) {
  const alliance = state.alliances.find((item) => item.id === id);
  if (!alliance) return;
  modalRoot.innerHTML = allianceModal(alliance, { admin: Boolean(state.user?.admin) });
  document.body.classList.add("modal-open");
}

function closeModal() {
  modalRoot.innerHTML = "";
  document.body.classList.remove("modal-open");
}

function bindCards(root = app) {
  root.querySelectorAll("[data-open-clan]").forEach((el) => {
    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-stop]")) return;
      openClan(el.dataset.openClan);
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openClan(el.dataset.openClan);
    });
  });
  root.querySelectorAll("[data-open-alliance]").forEach((el) => {
    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-stop]")) return;
      openAlliance(el.dataset.openAlliance);
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openAlliance(el.dataset.openAlliance);
    });
  });
}

function showNote(el, message) {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
}

function bindImagePreview(form, renderPreview) {
  let imageUrl = null;
  const input = form.image;
  const picker = form.querySelector("[data-file-picker]");
  const label = picker?.querySelector("[data-file-label]");
  const hint = picker?.querySelector("[data-file-hint]");
  const action = picker?.querySelector("[data-file-action]");
  const preview = picker?.querySelector("[data-file-preview]");
  const clear = picker?.querySelector("[data-file-clear]");
  const refresh = () => renderPreview(imageUrl);

  function setFile(file) {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = file ? URL.createObjectURL(file) : null;
    picker?.classList.toggle("has-file", Boolean(file));
    if (label) label.textContent = file ? file.name : "Upload an image";
    if (hint) hint.hidden = Boolean(file);
    if (action) action.textContent = file ? "Replace" : "Choose image";
    if (clear) clear.hidden = !file;
    if (preview) {
      preview.style.backgroundImage = imageUrl ? `url("${imageUrl}")` : "";
    }
    refresh();
  }

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

  form.addEventListener("input", refresh);
}

function packForm(form, listField) {
  const fd = new FormData(form);
  const values = fd.getAll(listField);
  fd.delete(listField);
  fd.set(listField, JSON.stringify(values));
  return fd;
}

async function render() {
  const { path, params } = parseRoute();
  closeDrawer();
  closeModal();
  setActiveNav(path);
  window.scrollTo({ top: 0, behavior: "instant" });

  if (path === "/browse") {
    const filters = {
      q: params.q || "",
      platform: params.platform || "",
      tier: "",
      playstyle: "",
      region: "",
      status: "",
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
    const filters = { q: "", platform: "", region: "", status: "" };
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
    app.innerHTML = postView({ user: state.user, alliances: state.alliances });
    const form = app.querySelector("#post-form");
    if (!form) return;
    const preview = app.querySelector("#live-preview");
    const note = app.querySelector("#form-note");
    const mr = app.querySelector("#post-mr");
    bindImagePreview(form, (url) => {
      if (mr) mr.textContent = form.mrRequired.value;
      if (form.tag) form.tag.value = form.tag.value.toUpperCase();
      preview.innerHTML = clanCard(previewClan(form, url || null));
    });
    preview.innerHTML = clanCard(previewClan(form));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        showNote(note, "Fill every required field.");
        form.reportValidity();
        return;
      }
      if (form.image.files?.[0] && form.image.files[0].size > 2 * 1024 * 1024) {
        showNote(note, "Image must be 2 MB or smaller.");
        return;
      }
      try {
        const created = await api.createClan(packForm(form, "playstyles"));
        await refresh();
        window.location.hash = "#/browse";
        window.setTimeout(() => openClan(created.clan.id), 80);
      } catch (error) {
        showNote(note, error.message);
      }
    });
    return;
  }

  if (path === "/post-alliance") {
    app.innerHTML = alliancePostView({ user: state.user });
    const form = app.querySelector("#alliance-form");
    if (!form) return;
    const preview = app.querySelector("#live-preview");
    const note = app.querySelector("#form-note");
    bindImagePreview(form, (url) => {
      if (form.tag) form.tag.value = form.tag.value.toUpperCase();
      preview.innerHTML = allianceCard(previewAlliance(form, url || null));
    });
    preview.innerHTML = allianceCard(previewAlliance(form));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        showNote(note, "Fill every required field.");
        form.reportValidity();
        return;
      }
      try {
        const created = await api.createAlliance(packForm(form, "platforms"));
        await refresh();
        window.location.hash = "#/alliances";
        window.setTimeout(() => openAlliance(created.alliance.id), 80);
      } catch (error) {
        showNote(note, error.message);
      }
    });
    return;
  }

  if (path === "/login" || path === "/register") {
    const next = params.next || "/account";
    app.innerHTML = authView(path.slice(1), next);
    const form = app.querySelector("#auth-form");
    const note = app.querySelector("#form-note");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = form.username.value.trim();
      const password = form.password.value;
      try {
        if (path === "/login") await api.login(username, password);
        else await api.register(username, password);
        await refresh();
        window.location.hash = `#${next}`;
      } catch (error) {
        showNote(note, error.message);
      }
    });
    return;
  }

  if (path === "/account") {
    if (!state.user) {
      window.location.hash = "#/login?next=/account";
      return;
    }
    const mineClans = state.user.admin
      ? state.clans
      : state.clans.filter((item) => item.ownerId === state.user.id);
    const mineAlliances = state.user.admin
      ? state.alliances
      : state.alliances.filter((item) => item.ownerId === state.user.id);
    app.innerHTML = accountView({ user: state.user, clans: mineClans, alliances: mineAlliances });
    return;
  }

  if (path === "/guide") {
    app.innerHTML = guideView();
    return;
  }

  app.innerHTML = homeView(state);
  app.querySelector("[data-hero-search]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q");
    window.location.hash = `#/browse?q=${encodeURIComponent(String(q || ""))}`;
  });
  bindCards();
}

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-link]")) closeDrawer();
  const nestedClan = event.target.closest(".modal [data-open-clan]");
  if (nestedClan) {
    event.stopPropagation();
    openClan(nestedClan.dataset.openClan);
    return;
  }
  if (event.target.classList.contains("backdrop") || event.target.closest("[data-close-modal]")) {
    closeModal();
  }
  if (event.target.closest("[data-logout]")) {
    await api.logout();
    await refresh();
    window.location.hash = "#/";
    render();
    return;
  }
  const deleteClan = event.target.closest("[data-delete-clan]");
  if (deleteClan) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Remove this clan post for everyone?")) return;
    await api.deleteClan(deleteClan.dataset.deleteClan);
    closeModal();
    await refresh();
    render();
    return;
  }
  const deleteAlliance = event.target.closest("[data-delete-alliance]");
  if (deleteAlliance) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Remove this alliance post for everyone?")) return;
    await api.deleteAlliance(deleteAlliance.dataset.deleteAlliance);
    closeModal();
    await refresh();
    render();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

toggle.addEventListener("click", () => {
  const open = drawer.hidden;
  drawer.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("drawer-open", open);
});

window.addEventListener("hashchange", () => {
  render().catch((error) => {
    app.innerHTML = `<section class="auth-card"><h1>Could not load</h1><p class="muted">${error.message}</p></section>`;
  });
});

nav.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", () => {
  nav.classList.toggle("is-scrolled", window.scrollY > 8);
});

refresh()
  .then(() => {
    if (!window.location.hash) window.location.hash = "#/";
    else return render();
  })
  .catch((error) => {
    app.innerHTML = `<section class="auth-card"><h1>Server offline</h1><p class="muted">Start the app with <code>npm run dev</code>. ${error.message}</p></section>`;
  });
