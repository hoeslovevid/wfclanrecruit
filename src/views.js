import {
  LANGUAGES,
  PLAYSTYLES,
  PLATFORMS,
  REGIONS,
  STATUSES,
  TIER_CAPS,
  TIERS,
} from "./data.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function capacity(clan) {
  return TIER_CAPS[clan.tier] ?? 1000;
}

export function fillPercent(clan) {
  return Math.min(100, Math.round((clan.members / capacity(clan)) * 100));
}

export function timeAgo(iso) {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(delta / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function statusClass(status) {
  if (status === "Open") return "is-open";
  if (status === "Selective") return "is-selective";
  return "is-trial";
}

function chipList(items = []) {
  return items.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("");
}

function hueFrom(seed) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash << 5) - hash + char.charCodeAt(0);
  return Math.abs(hash) % 360;
}

export function photo(item, size = 56) {
  if (item.image) {
    return `<img class="photo" src="${escapeHtml(item.image)}" alt="" width="${size}" height="${size}" />`;
  }
  const initials = String(item.tag || item.name || "?").slice(0, 2).toUpperCase();
  return `<div class="photo fallback" style="--hue:${hueFrom(item.id || item.name)}">${escapeHtml(initials)}</div>`;
}

export function clanCard(clan) {
  const fill = fillPercent(clan);
  return `
    <article class="card" data-open-clan="${escapeHtml(clan.id)}" tabindex="0">
      <header class="card-head">
        ${photo(clan)}
        <div>
          <p class="kicker">[${escapeHtml(clan.tag)}]${clan.allianceName ? ` · ${escapeHtml(clan.allianceName)}` : ""}</p>
          <h3>${escapeHtml(clan.name)}</h3>
          <p class="muted">${escapeHtml(clan.platform)} · ${escapeHtml(clan.tier)} · ${escapeHtml(clan.region)}</p>
        </div>
        <span class="pill ${statusClass(clan.status)}">${escapeHtml(clan.status)}</span>
      </header>
      <p class="headline">${escapeHtml(clan.headline)}</p>
      <p class="muted">${escapeHtml(clan.summary)}</p>
      <div class="chips">${chipList(clan.playstyles.slice(0, 3))}</div>
      <div class="stats">
        <div>
          <span>Roster</span>
          <strong>${clan.members}<small>/${capacity(clan)}</small></strong>
          <div class="meter"><i style="width:${fill}%"></i></div>
        </div>
        <div>
          <span>MR</span>
          <strong>${clan.mrRequired === 0 ? "Any" : `${clan.mrRequired}+`}</strong>
        </div>
        <div>
          <span>Posted</span>
          <strong>${timeAgo(clan.createdAt)}</strong>
        </div>
      </div>
      <footer class="card-foot">
        <button class="btn btn-ghost" type="button">View post</button>
        <a class="btn btn-discord" href="${escapeHtml(clan.discord)}" target="_blank" rel="noopener noreferrer" data-stop>Join Discord</a>
      </footer>
    </article>
  `;
}

export function allianceCard(alliance) {
  const clans = alliance.memberClans || [];
  return `
    <article class="card" data-open-alliance="${escapeHtml(alliance.id)}" tabindex="0">
      <header class="card-head">
        ${photo(alliance)}
        <div>
          <p class="kicker">[${escapeHtml(alliance.tag)}] · Alliance</p>
          <h3>${escapeHtml(alliance.name)}</h3>
          <p class="muted">${escapeHtml((alliance.platforms || []).join(" / "))} · ${escapeHtml(alliance.region)}</p>
        </div>
        <span class="pill ${statusClass(alliance.status)}">${escapeHtml(alliance.status)}</span>
      </header>
      <p class="headline">${escapeHtml(alliance.headline)}</p>
      <p class="muted">${escapeHtml(alliance.summary)}</p>
      <div class="stats">
        <div><span>Clans</span><strong>${alliance.clanCount}</strong></div>
        <div><span>Players</span><strong>${alliance.members}</strong></div>
        <div><span>Posted</span><strong>${timeAgo(alliance.createdAt)}</strong></div>
      </div>
      ${
        clans.length
          ? `<div class="mini-clans">${clans
              .slice(0, 4)
              .map((clan) => `<span class="mini-clan">${photo(clan, 28)} ${escapeHtml(clan.tag)}</span>`)
              .join("")}</div>`
          : ""
      }
      <footer class="card-foot">
        <button class="btn btn-ghost" type="button">View alliance</button>
        <a class="btn btn-discord" href="${escapeHtml(alliance.discord)}" target="_blank" rel="noopener noreferrer" data-stop>Join Discord</a>
      </footer>
    </article>
  `;
}

export function homeView({ clans, alliances, user }) {
  const featuredClans = clans.filter((item) => item.featured).slice(0, 3);
  const featuredAlliances = alliances.filter((item) => item.featured).slice(0, 2);
  const homeAlliances = (featuredAlliances.length ? featuredAlliances : alliances).slice(0, 2);
  const recent = clans.slice(0, 6);
  const openCount = clans.filter((item) => item.status === "Open").length;

  return `
    <section class="hero">
      <h1>Find a clan.<br /><em>Or post yours.</em></h1>
      <p class="lead">Browse open clans and alliances, read the post, then join their Discord. Leaders publish once — everyone sees the same board.</p>
      <form class="search" data-hero-search>
        <label class="sr-only" for="hero-q">Search listings</label>
        <input id="hero-q" name="q" type="search" placeholder="Search clans, tags, playstyles…" autocomplete="off" />
        <button class="btn btn-primary" type="submit">Search</button>
      </form>
      <dl class="hero-stats">
        <div><dt>Clan posts</dt><dd>${clans.length}</dd></div>
        <div><dt>Open now</dt><dd>${openCount}</dd></div>
        <div><dt>Alliances</dt><dd>${alliances.length}</dd></div>
      </dl>
    </section>

    ${
      !clans.length && !alliances.length
        ? `<section class="section">${emptyState()}</section>`
        : ""
    }

    ${
      featuredClans.length
        ? `<section class="section">
      <div class="section-head">
        <div>
          <p class="eyebrow">Featured clans</p>
          <h2>Worth opening first</h2>
        </div>
        <a class="text-link" href="#/browse" data-link>Browse all clans</a>
      </div>
      <div class="grid">${featuredClans.map((clan) => clanCard(clan)).join("")}</div>
    </section>`
        : ""
    }

    ${
      homeAlliances.length
        ? `<section class="section">
      <div class="section-head">
        <div>
          <p class="eyebrow">Alliances</p>
          <h2>If you want more than one clan</h2>
        </div>
        <a class="text-link" href="#/alliances" data-link>Browse alliances</a>
      </div>
      <div class="grid two">${homeAlliances.map((item) => allianceCard(item)).join("")}</div>
    </section>`
        : ""
    }

    <section class="section split">
      <div class="panel">
        <p class="eyebrow">For players</p>
        <h2>Filter, read, join Discord.</h2>
        <ol>
          <li>Filter by platform, MR, and how you play.</li>
          <li>Open the Discord from the post.</li>
          <li>Wait for the in-game invite.</li>
        </ol>
        <a class="btn btn-primary" href="#/browse" data-link>Browse clans</a>
      </div>
      <div class="panel">
        <p class="eyebrow">For leaders</p>
        <h2>Post once. Keep it current.</h2>
        <p class="muted">Create an account, upload a clan image, and publish. Everyone who visits this site sees the same board.</p>
        <a class="btn btn-ghost" href="${user ? "#/post" : "#/register"}" data-link>${user ? "Post a listing" : "Create an account"}</a>
      </div>
    </section>

    ${
      recent.length
        ? `<section class="section">
      <div class="section-head">
        <div>
          <p class="eyebrow">Latest</p>
          <h2>New clan posts</h2>
        </div>
      </div>
      <div class="grid">${recent.map((clan) => clanCard(clan)).join("")}</div>
    </section>`
        : ""
    }
  `;
}

function optionList(values, selected = "") {
  return values
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`
    )
    .join("");
}

export function browseView(clans, filters) {
  const label = clans.length === 1 ? "1 clan" : `${clans.length} clans`;
  return `
    <section class="page-hero">
      <p class="eyebrow">Clans</p>
      <h1>Browse recruitment posts</h1>
      <p class="lead">Every listing is written by a clan leader. Filter it down, then join the Discord.</p>
    </section>
    <section class="browse">
      <aside class="filters">
        <div class="row-between">
          <h2>Filters</h2>
          <button class="text-link" type="button" data-clear-filters>Reset</button>
        </div>
        <form id="filter-form">
          <label class="field"><span>Keyword</span><input type="search" name="q" value="${escapeHtml(filters.q)}" placeholder="Name, tag, playstyle…" /></label>
          <label class="field"><span>Platform</span><select name="platform"><option value="">Any</option>${optionList(PLATFORMS, filters.platform)}</select></label>
          <label class="field"><span>Tier</span><select name="tier"><option value="">Any</option>${optionList(TIERS, filters.tier)}</select></label>
          <label class="field"><span>Playstyle</span><select name="playstyle"><option value="">Any</option>${optionList(PLAYSTYLES, filters.playstyle)}</select></label>
          <label class="field"><span>Region</span><select name="region"><option value="">Any</option>${optionList(REGIONS, filters.region)}</select></label>
          <label class="field"><span>Status</span><select name="status"><option value="">Any</option>${optionList(STATUSES, filters.status)}</select></label>
          <label class="field"><span>Your MR <em id="mr-readout">${filters.mr || 0}</em></span><input type="range" name="mr" min="0" max="36" value="${escapeHtml(filters.mr || "0")}" /></label>
        </form>
      </aside>
      <div class="browse-main">
        <div class="row-between">
          <p class="muted" id="result-count">${label}</p>
          <label class="field inline"><span>Sort</span>
            <select name="sort" form="filter-form">
              <option value="newest" ${filters.sort === "newest" ? "selected" : ""}>Newest</option>
              <option value="open" ${filters.sort === "open" ? "selected" : ""}>Open first</option>
              <option value="space" ${filters.sort === "space" ? "selected" : ""}>Most space</option>
              <option value="mr" ${filters.sort === "mr" ? "selected" : ""}>Lowest MR</option>
            </select>
          </label>
        </div>
        <div id="results">${clans.length ? `<div class="grid">${clans.map((clan) => clanCard(clan)).join("")}</div>` : emptyState()}</div>
      </div>
    </section>
  `;
}

export function alliancesView(alliances, filters) {
  const label = alliances.length === 1 ? "1 alliance" : `${alliances.length} alliances`;
  return `
    <section class="page-hero">
      <p class="eyebrow">Alliances</p>
      <h1>Browse alliance listings</h1>
      <p class="lead">Alliances group multiple clans. Join the shared Discord if you want a wider roster.</p>
    </section>
    <section class="browse">
      <aside class="filters">
        <div class="row-between">
          <h2>Filters</h2>
          <button class="text-link" type="button" data-clear-filters>Reset</button>
        </div>
        <form id="filter-form">
          <label class="field"><span>Keyword</span><input type="search" name="q" value="${escapeHtml(filters.q)}" /></label>
          <label class="field"><span>Platform</span><select name="platform"><option value="">Any</option>${optionList(PLATFORMS, filters.platform)}</select></label>
          <label class="field"><span>Region</span><select name="region"><option value="">Any</option>${optionList(REGIONS, filters.region)}</select></label>
          <label class="field"><span>Status</span><select name="status"><option value="">Any</option>${optionList(STATUSES, filters.status)}</select></label>
        </form>
      </aside>
      <div>
        <p class="muted">${label}</p>
        ${alliances.length ? `<div class="grid two">${alliances.map((item) => allianceCard(item)).join("")}</div>` : emptyState()}
      </div>
    </section>
  `;
}

export function emptyState(title = "Nothing to see here", detail = "Check back later, or post a listing.") {
  return `<div class="empty"><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(detail)}</p></div>`;
}

function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean);
}

function checks(name, values, selected = []) {
  return values
    .map((value) => {
      const id = `${name}-${value.toLowerCase().replace(/\s+/g, "-")}`;
      return `<label class="check" for="${id}"><input id="${id}" type="checkbox" name="${name}" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""} /><span>${escapeHtml(value)}</span></label>`;
    })
    .join("");
}

function imagePicker(label) {
  return `
    <div class="field">
      <span>${escapeHtml(label)}</span>
      <div class="file-picker" data-file-picker>
        <div class="file-picker-target">
          <input class="file-picker-input" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" />
          <div class="file-picker-ui">
            <span class="file-picker-preview" data-file-preview aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2.75" y="4.75" width="14.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="7.25" cy="8.5" r="1.25" fill="currentColor"/>
                <path d="M4.5 13.5 8 10.25l2.5 2.5 2-2 3 2.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="file-picker-copy">
              <strong data-file-label>Upload an image</strong>
              <small data-file-hint>PNG, JPG, WEBP, GIF, or SVG. Max 2 MB.</small>
            </span>
            <span class="file-picker-action" data-file-action>Choose image</span>
          </div>
        </div>
        <button class="file-picker-clear" type="button" data-file-clear hidden>Remove image</button>
      </div>
    </div>
  `;
}

function demoLoginHint() {
  if (!import.meta.env.DEV) return "";
  return `<p class="muted">Demo account: <code>leader</code> / <code>recruit1</code></p>`;
}

function authGate(nextHash) {
  return `
    <section class="auth-card">
      <p class="eyebrow">Account required</p>
      <h1>Sign in to publish</h1>
      <p class="lead">Listings are stored on the server so every visitor sees the same board. Create a free account to post a clan or alliance.</p>
      <div class="row">
        <a class="btn btn-primary" href="#/login?next=${encodeURIComponent(nextHash)}" data-link>Sign in</a>
        <a class="btn btn-ghost" href="#/register?next=${encodeURIComponent(nextHash)}" data-link>Create account</a>
      </div>
      ${demoLoginHint()}
    </section>
  `;
}

export function postView({ user, alliances = [], draft = {} }) {
  if (!user) return authGate("/post");
  return `
    <section class="page-hero">
      <p class="eyebrow">Leaders</p>
      <h1>Post a listing</h1>
      <p class="lead">Upload an image, write the post once, and send recruits to Discord.</p>
      <div class="tabs" role="tablist" aria-label="Listing type">
        <a class="tab is-active" href="#/post" data-link>Clan</a>
        <a class="tab" href="#/post-alliance" data-link>Alliance</a>
      </div>
    </section>
    <section class="composer">
      <form id="post-form" class="stack" novalidate>
        <div class="form-block">
          <h2>Identity</h2>
          <div class="two-col">
            <label class="field"><span>Clan name</span><input name="name" required maxlength="48" value="${escapeHtml(draft.name || "")}" /></label>
            <label class="field"><span>Tag</span><input name="tag" required maxlength="5" value="${escapeHtml(draft.tag || "")}" /></label>
            <label class="field"><span>In-game leader</span><input name="leader" required maxlength="32" value="${escapeHtml(draft.leader || user.username)}" /></label>
            <label class="field"><span>Founded</span><input name="founded" maxlength="8" value="${escapeHtml(draft.founded || "")}" placeholder="2019" /></label>
          </div>
          ${imagePicker("Clan image")}
        </div>
        <div class="form-block">
          <h2>Details</h2>
          <div class="two-col">
            <label class="field"><span>Platform</span><select name="platform" required>${optionList(PLATFORMS, draft.platform)}</select></label>
            <label class="field"><span>Tier</span><select name="tier" required>${optionList(TIERS, draft.tier)}</select></label>
            <label class="field"><span>Region</span><select name="region" required>${optionList(REGIONS, draft.region || "Global")}</select></label>
            <label class="field"><span>Language</span><select name="language" required>${optionList(LANGUAGES, draft.language)}</select></label>
            <label class="field"><span>Status</span><select name="status" required>${optionList(STATUSES, draft.status)}</select></label>
            <label class="field"><span>Members</span><input name="members" type="number" min="1" max="1000" required value="${escapeHtml(draft.members || "")}" /></label>
            <label class="field"><span>Minimum MR <em id="post-mr">${draft.mrRequired ?? 0}</em></span><input type="range" name="mrRequired" min="0" max="36" value="${escapeHtml(draft.mrRequired ?? 0)}" /></label>
            <label class="field"><span>Discord invite</span><input name="discord" type="url" required placeholder="https://discord.gg/yourclan" value="${escapeHtml(draft.discord || "")}" /></label>
            <label class="field">
              <span>Alliance</span>
              <select name="allianceId">
                <option value="">None</option>
                ${alliances.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </label>
          </div>
          <fieldset class="fieldset"><legend>Playstyles</legend><div class="checks">${checks("playstyles", PLAYSTYLES, draft.playstyles || [])}</div></fieldset>
        </div>
        <div class="form-block">
          <h2>The post</h2>
          <label class="field"><span>Headline</span><input name="headline" required maxlength="90" /></label>
          <label class="field"><span>Short summary</span><textarea name="summary" required maxlength="220" rows="3"></textarea></label>
          <label class="field"><span>Full post</span><textarea name="about" required maxlength="1200" rows="7"></textarea><small>Line breaks are preserved.</small></label>
          <div class="two-col">
            <label class="field"><span>What you offer <small>one per line</small></span><textarea name="offering" required rows="5" placeholder="Fully researched Moon clan"></textarea></label>
            <label class="field"><span>Requirements <small>one per line</small></span><textarea name="requirements" required rows="5" placeholder="MR 10+"></textarea></label>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Publish clan</button>
          <p class="error" id="form-note" hidden></p>
        </div>
      </form>
      <aside class="preview-panel">
        <h2>Preview</h2>
        <div class="live-preview" id="live-preview"></div>
      </aside>
    </section>
  `;
}

export function alliancePostView({ user }) {
  if (!user) return authGate("/post-alliance");
  return `
    <section class="page-hero">
      <p class="eyebrow">Leaders</p>
      <h1>Post a listing</h1>
      <p class="lead">For groups of clans that share a Discord and want one public listing.</p>
      <div class="tabs" role="tablist" aria-label="Listing type">
        <a class="tab" href="#/post" data-link>Clan</a>
        <a class="tab is-active" href="#/post-alliance" data-link>Alliance</a>
      </div>
    </section>
    <section class="composer">
      <form id="alliance-form" class="stack" novalidate>
        <div class="form-block">
          <h2>Identity</h2>
          <div class="two-col">
            <label class="field"><span>Alliance name</span><input name="name" required maxlength="48" /></label>
            <label class="field"><span>Tag</span><input name="tag" required maxlength="5" /></label>
            <label class="field"><span>Clans in alliance</span><input name="clanCount" type="number" min="1" required /></label>
            <label class="field"><span>Approx. players</span><input name="members" type="number" min="1" required /></label>
          </div>
          ${imagePicker("Alliance image")}
        </div>
        <div class="form-block">
          <h2>Details</h2>
          <div class="two-col">
            <label class="field"><span>Region</span><select name="region" required>${optionList(REGIONS, "Global")}</select></label>
            <label class="field"><span>Language</span><select name="language" required>${optionList(LANGUAGES)}</select></label>
            <label class="field"><span>Status</span><select name="status" required>${optionList(STATUSES)}</select></label>
            <label class="field"><span>Discord invite</span><input name="discord" type="url" required placeholder="https://discord.gg/youralliance" /></label>
          </div>
          <fieldset class="fieldset"><legend>Platforms</legend><div class="checks">${checks("platforms", PLATFORMS)}</div></fieldset>
        </div>
        <div class="form-block">
          <h2>The post</h2>
          <label class="field"><span>Headline</span><input name="headline" required maxlength="90" /></label>
          <label class="field"><span>Short summary</span><textarea name="summary" required maxlength="220" rows="3"></textarea></label>
          <label class="field"><span>Full post</span><textarea name="about" required maxlength="1200" rows="7"></textarea><small>Line breaks are preserved.</small></label>
          <div class="two-col">
            <label class="field"><span>What you offer</span><textarea name="offering" required rows="5"></textarea></label>
            <label class="field"><span>Requirements</span><textarea name="requirements" required rows="5"></textarea></label>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Publish alliance</button>
          <p class="error" id="form-note" hidden></p>
        </div>
      </form>
      <aside class="preview-panel">
        <h2>Preview</h2>
        <div class="live-preview" id="live-preview"></div>
      </aside>
    </section>
  `;
}

export function authView(mode, next = "/") {
  const isLogin = mode === "login";
  return `
    <section class="auth-card">
      <p class="eyebrow">${isLogin ? "Welcome back" : "New account"}</p>
      <h1>${isLogin ? "Sign in" : "Create an account"}</h1>
      <p class="lead">${isLogin ? "Use your WF Clan Recruit username to manage listings." : "This lets you publish clan and alliance posts that everyone can see."}</p>
      <form id="auth-form" class="stack" data-next="${escapeHtml(next)}">
        <label class="field"><span>Username</span><input name="username" required maxlength="20" autocomplete="username" /></label>
        <label class="field"><span>Password</span><input name="password" type="password" required minlength="6" autocomplete="${isLogin ? "current-password" : "new-password"}" /></label>
        <p class="error" id="form-note" hidden></p>
        <button class="btn btn-primary" type="submit">${isLogin ? "Sign in" : "Create account"}</button>
      </form>
      <p class="muted">${
        isLogin
          ? `Need an account? <a href="#/register?next=${encodeURIComponent(next)}" data-link>Register</a>`
          : `Already have one? <a href="#/login?next=${encodeURIComponent(next)}" data-link>Sign in</a>`
      }</p>
      ${demoLoginHint()}
    </section>
  `;
}

export function accountView({ user, clans, alliances }) {
  const admin = Boolean(user.admin);
  return `
    <section class="page-hero">
      <p class="eyebrow">${admin ? "Moderator" : "Account"}</p>
      <h1>${escapeHtml(user.username)}</h1>
      <p class="lead">${
        admin
          ? "You can remove any listing on the board. Removals are immediate for everyone."
          : "Your listings live on the shared board. Remove one and it disappears for everyone."
      }</p>
    </section>
    <section class="section">
      <div class="section-head"><h2>${admin ? "Clan posts" : "Your clans"}</h2><a class="text-link" href="#/post" data-link>New clan</a></div>
      ${listingList(clans, "clan", "You have not posted a clan yet.")}
    </section>
    <section class="section">
      <div class="section-head"><h2>${admin ? "Alliance posts" : "Your alliances"}</h2><a class="text-link" href="#/post-alliance" data-link>New alliance</a></div>
      ${listingList(alliances, "alliance", "You have not posted an alliance yet.")}
    </section>
  `;
}

function listingList(items, kind, emptyText) {
  if (!items.length) return `<p class="muted">${emptyText}</p>`;
  const attr = kind === "clan" ? "data-delete-clan" : "data-delete-alliance";
  return `<div class="list">${items
    .map(
      (item) => `
            <div class="list-row">
              ${photo(item, 44)}
              <div><strong>${escapeHtml(item.name)}</strong><p class="muted">[${escapeHtml(item.tag)}] · ${escapeHtml(item.status)}</p></div>
              <button class="btn btn-ghost" type="button" ${attr}="${escapeHtml(item.id)}">Remove</button>
            </div>`
    )
    .join("")}</div>`;
}

export function guideView() {
  return `
    <section class="page-hero">
      <p class="eyebrow">Guide</p>
      <h1>How it works</h1>
      <p class="lead">A listing here is a public post. Recruits read it, join your Discord, then wait for the in-game invite.</p>
    </section>
    <section class="guide-page">
      <div class="grid three">
        <article class="panel guide-step">
          <p class="kicker">Step 01</p>
          <h3>Create an account</h3>
          <p class="muted">Leaders sign in so posts stay on the server. Players can browse without one.</p>
        </article>
        <article class="panel guide-step">
          <p class="kicker">Step 02</p>
          <h3>Publish a listing</h3>
          <p class="muted">Add a clan or alliance, upload an image, and include a Discord invite you control.</p>
        </article>
        <article class="panel guide-step">
          <p class="kicker">Step 03</p>
          <h3>Recruits join Discord</h3>
          <p class="muted">They read the post, click through, introduce themselves, then wait for the invite.</p>
        </article>
      </div>
      <article class="panel">
        <p class="kicker">Rules</p>
        <h3>Keep listings honest</h3>
        <ul class="guide-rules">
          <li>Use a real Discord invite. People will click it.</li>
          <li>Be exact about MR, trials, and behavior rules.</li>
          <li>You can remove your own posts from the account page.</li>
        </ul>
      </article>
      <div class="row guide-actions">
        <a class="btn btn-primary" href="#/browse" data-link>Browse clans</a>
        <a class="btn btn-ghost" href="#/post" data-link>Post a listing</a>
      </div>
    </section>
  `;
}

export function clanModal(clan, { admin = false } = {}) {
  return `
    <div class="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="clan-title">
        <button class="icon-close" type="button" data-close-modal aria-label="Close">×</button>
        <div class="modal-hero">
          ${photo(clan, 72)}
          <div>
            <div class="modal-kicker">
              <p class="kicker">[${escapeHtml(clan.tag)}] · Est. ${escapeHtml(clan.founded || "—")}${clan.allianceName ? ` · ${escapeHtml(clan.allianceName)}` : ""}</p>
              <span class="pill ${statusClass(clan.status)}">${escapeHtml(clan.status)}</span>
            </div>
            <h2 id="clan-title">${escapeHtml(clan.name)}</h2>
            <p class="headline">${escapeHtml(clan.headline)}</p>
            <div class="chips">${chipList(clan.playstyles)}</div>
          </div>
        </div>
        <dl class="detail-stats">
          <div><dt>Platform</dt><dd>${escapeHtml(clan.platform)}</dd></div>
          <div><dt>Tier</dt><dd>${escapeHtml(clan.tier)}</dd></div>
          <div><dt>Roster</dt><dd>${clan.members} / ${capacity(clan)}</dd></div>
          <div><dt>MR</dt><dd>${clan.mrRequired === 0 ? "Any" : `${clan.mrRequired}+`}</dd></div>
          <div><dt>Region</dt><dd>${escapeHtml(clan.region)}</dd></div>
          <div><dt>Language</dt><dd>${escapeHtml(clan.language)}</dd></div>
          <div><dt>Leader</dt><dd>${escapeHtml(clan.leader)}</dd></div>
          <div><dt>Posted</dt><dd>${timeAgo(clan.createdAt)}</dd></div>
        </dl>
        <div class="meter tall"><i style="width:${fillPercent(clan)}%"></i></div>
        <h3>About</h3>
        <p class="muted post-body">${escapeHtml(clan.about)}</p>
        <div class="two-col">
          <div><h3>They offer</h3><ul>${clan.offering.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
          <div><h3>Requirements</h3><ul>${clan.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        </div>
        <div class="row">
          <a class="btn btn-discord" href="${escapeHtml(clan.discord)}" target="_blank" rel="noopener noreferrer">Join ${escapeHtml(clan.name)} on Discord</a>
          ${
            admin
              ? `<button class="btn btn-ghost" type="button" data-delete-clan="${escapeHtml(clan.id)}">Remove listing</button>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

export function allianceModal(alliance, { admin = false } = {}) {
  const clans = alliance.memberClans || [];
  return `
    <div class="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="alliance-title">
        <button class="icon-close" type="button" data-close-modal aria-label="Close">×</button>
        <div class="modal-hero">
          ${photo(alliance, 72)}
          <div>
            <div class="modal-kicker">
              <p class="kicker">[${escapeHtml(alliance.tag)}] · Alliance</p>
              <span class="pill ${statusClass(alliance.status)}">${escapeHtml(alliance.status)}</span>
            </div>
            <h2 id="alliance-title">${escapeHtml(alliance.name)}</h2>
            <p class="headline">${escapeHtml(alliance.headline)}</p>
          </div>
        </div>
        <dl class="detail-stats">
          <div><dt>Platforms</dt><dd>${escapeHtml((alliance.platforms || []).join(", "))}</dd></div>
          <div><dt>Clans</dt><dd>${alliance.clanCount}</dd></div>
          <div><dt>Players</dt><dd>${alliance.members}</dd></div>
          <div><dt>Region</dt><dd>${escapeHtml(alliance.region)}</dd></div>
          <div><dt>Language</dt><dd>${escapeHtml(alliance.language)}</dd></div>
          <div><dt>Posted</dt><dd>${timeAgo(alliance.createdAt)}</dd></div>
        </dl>
        <h3>About</h3>
        <p class="muted post-body">${escapeHtml(alliance.about)}</p>
        <div class="two-col">
          <div><h3>They offer</h3><ul>${alliance.offering.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
          <div><h3>Requirements</h3><ul>${alliance.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        </div>
        ${
          clans.length
            ? `<h3>Clans on this board</h3><div class="mini-clans">${clans
                .map((clan) => `<button class="mini-clan btn-plain" type="button" data-open-clan="${escapeHtml(clan.id)}">${photo(clan, 28)} ${escapeHtml(clan.name)}</button>`)
                .join("")}</div>`
            : ""
        }
        <div class="row">
          <a class="btn btn-discord" href="${escapeHtml(alliance.discord)}" target="_blank" rel="noopener noreferrer">Join ${escapeHtml(alliance.name)} on Discord</a>
          ${
            admin
              ? `<button class="btn btn-ghost" type="button" data-delete-alliance="${escapeHtml(alliance.id)}">Remove listing</button>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

export function previewClan(form, imageUrl = null) {
  const data = new FormData(form);
  const playstyles = data.getAll("playstyles");
  return {
    id: "preview",
    name: data.get("name") || "Your clan name",
    tag: String(data.get("tag") || "TAG").toUpperCase(),
    image: imageUrl,
    platform: data.get("platform") || "PC",
    tier: data.get("tier") || "Ghost",
    members: Number(data.get("members") || 1),
    mrRequired: Number(data.get("mrRequired") || 0),
    playstyles: playstyles.length ? playstyles : ["Social"],
    region: data.get("region") || "Global",
    language: data.get("language") || "English",
    status: data.get("status") || "Open",
    leader: data.get("leader") || "Leader",
    discord: data.get("discord") || "https://discord.gg/warframe",
    allianceName: null,
    headline: data.get("headline") || "Your headline appears here.",
    summary: data.get("summary") || "A short summary shows under the headline.",
    about: data.get("about") || "",
    offering: parseLines(data.get("offering") || "Your offering"),
    requirements: parseLines(data.get("requirements") || "Your requirements"),
    createdAt: new Date().toISOString(),
  };
}

export function previewAlliance(form, imageUrl = null) {
  const data = new FormData(form);
  return {
    id: "preview",
    name: data.get("name") || "Your alliance",
    tag: String(data.get("tag") || "TAG").toUpperCase(),
    image: imageUrl,
    platforms: data.getAll("platforms").length ? data.getAll("platforms") : ["PC"],
    region: data.get("region") || "Global",
    language: data.get("language") || "English",
    status: data.get("status") || "Open",
    clanCount: Number(data.get("clanCount") || 1),
    members: Number(data.get("members") || 1),
    discord: data.get("discord") || "https://discord.gg/warframe",
    headline: data.get("headline") || "Your headline appears here.",
    summary: data.get("summary") || "A short summary shows under the headline.",
    about: data.get("about") || "",
    offering: parseLines(data.get("offering") || "Your offering"),
    requirements: parseLines(data.get("requirements") || "Your requirements"),
    memberClans: [],
    createdAt: new Date().toISOString(),
  };
}

export function navAccount(user) {
  if (user) {
    return `
      <a class="btn btn-ghost" href="#/account" data-link>${escapeHtml(user.username)}</a>
      <button class="btn btn-ghost" type="button" data-logout>Sign out</button>
    `;
  }
  return `
    <a class="btn btn-ghost" href="#/login" data-link>Sign in</a>
    <a class="btn btn-primary" href="#/register" data-link>Create account</a>
  `;
}
