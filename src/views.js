import {
  LANGUAGES,
  PLAYSTYLES,
  PLATFORMS,
  REGIONS,
  STATUSES,
  TIER_CAPS,
  TIERS,
} from "./data.js";
import { sanitizePostHtml, splitVideoHtml, toEditorHtml } from "./richtext.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function activityAt(item) {
  return item.bumpedAt || item.createdAt;
}

function postedStat(item) {
  const bumped = item.bumpedAt && item.bumpedAt !== item.createdAt;
  return { label: bumped ? "Bumped" : "Posted", at: activityAt(item) };
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

export function isSafeMediaUrl(url) {
  return Boolean(url) && (url.startsWith("/uploads/") || url.startsWith("blob:"));
}

export function postBodyHtml(about, videoUrl, { placeholder = false } = {}) {
  const html = sanitizePostHtml(toEditorHtml(about));
  const { before, after, hasMarker } = splitVideoHtml(html);
  const safe = isSafeMediaUrl(videoUrl) ? videoUrl : null;
  const showSlot = placeholder && (Boolean(safe) || hasMarker);
  const player = showSlot
    ? `<div class="post-video-slot">Video appears here</div>`
    : safe
      ? `<video class="post-video" controls playsinline preload="metadata" data-stop src="${escapeHtml(safe)}"></video>`
      : "";

  if (!player) {
    return before || after ? `<div class="post-body muted">${before}${after}</div>` : "";
  }

  if (!hasMarker) {
    return `${html ? `<div class="post-body muted">${html}</div>` : ""}${player}`;
  }

  return `${before ? `<div class="post-body muted">${before}</div>` : ""}${player}${
    after ? `<div class="post-body muted">${after}</div>` : ""
  }`;
}

export function photo(item, size = 56) {
  if (item.image) {
    return `<img class="photo" src="${escapeHtml(item.image)}" alt="" width="${size}" height="${size}" />`;
  }
  const initials = String(item.tag || item.name || "?").slice(0, 2).toUpperCase();
  return `<div class="photo fallback" style="--hue:${hueFrom(item.id || item.name)}">${escapeHtml(initials)}</div>`;
}

export const REPORT_REASON_LABELS = {
  dead_invite: "Dead Discord invite",
  inactive: "Looks inactive",
  fake: "Fake or misleading",
  stolen_name: "Stolen name or tag",
  other: "Something else",
};

function listingBadges(item) {
  const bits = [];
  if (item.paused) bits.push(`<span class="pill is-paused">Paused</span>`);
  if (item.stale) bits.push(`<span class="pill is-stale">Stale</span>`);
  if (item.inviteOk === false) bits.push(`<span class="pill is-trial">Invite failed</span>`);
  return bits.join("");
}

function recruitingNote(item) {
  if (item.paused) return "Recruiting is paused. Discord is hidden until the leader turns it back on.";
  if (item.inviteOk === false) return "The Discord invite failed a check. The leader needs a working invite.";
  if (item.stale) return "This listing went 21 days without a bump, so Discord is hidden until the leader refreshes it.";
  return "Not recruiting right now.";
}

function joinDiscord(item, label) {
  if (item.recruiting === false) {
    return `<p class="muted join-note">${escapeHtml(recruitingNote(item))}</p>`;
  }
  return `<a class="btn btn-discord" href="${escapeHtml(item.discord)}" target="_blank" rel="noopener noreferrer" data-stop>${escapeHtml(label)}</a>`;
}

function reportForm(kind, id) {
  const options = Object.entries(REPORT_REASON_LABELS)
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");
  return `
    <details class="report-box">
      <summary>Report this listing</summary>
      <form class="stack report-form" data-report-kind="${escapeHtml(kind)}" data-report-id="${escapeHtml(id)}">
        <label class="field"><span>Reason</span><select name="reason" required><option value="">Choose one</option>${options}</select></label>
        <label class="field"><span>Details <small>optional</small></span><textarea name="details" maxlength="400" rows="3" placeholder="Dead invite, stolen tag, no activity…"></textarea></label>
        <button class="btn btn-ghost" type="submit">Send report</button>
        <p class="muted" data-report-note hidden></p>
      </form>
    </details>
  `;
}

function clanRosterChecks(clans, selected = []) {
  return clans
    .map((clan) => {
      const id = `roster-${clan.id}`;
      return `<label class="check" for="${id}"><input id="${id}" type="checkbox" name="rosterIds" value="${escapeHtml(clan.id)}" ${
        selected.includes(clan.id) ? "checked" : ""
      } /><span>[${escapeHtml(clan.tag)}] ${escapeHtml(clan.name)}</span></label>`;
    })
    .join("");
}

export function clanCard(clan) {
  const fill = fillPercent(clan);
  return `
    <article class="card${clan.recruiting === false ? " is-quiet" : ""}" data-href="/clans/${escapeHtml(clan.id)}" tabindex="0">
      <header class="card-head">
        ${photo(clan)}
        <div>
          <p class="kicker">[${escapeHtml(clan.tag)}]${clan.allianceName ? ` · ${escapeHtml(clan.allianceName)}` : ""}</p>
          <h3>${escapeHtml(clan.name)}</h3>
          <p class="muted">${escapeHtml(clan.platform)} · ${escapeHtml(clan.tier)} · ${escapeHtml(clan.region)}</p>
        </div>
        <div class="card-pills">
          <span class="pill ${statusClass(clan.status)}">${escapeHtml(clan.status)}</span>
          ${listingBadges(clan)}
        </div>
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
          <span>${postedStat(clan).label}</span>
          <strong>${timeAgo(postedStat(clan).at)}</strong>
        </div>
      </div>
      <footer class="card-foot">
        <a class="btn btn-ghost" href="/clans/${escapeHtml(clan.id)}" data-link>View post</a>
        ${joinDiscord(clan, "Join Discord")}
      </footer>
    </article>
  `;
}

export function allianceCard(alliance) {
  const clans = alliance.memberClans || [];
  return `
    <article class="card${alliance.recruiting === false ? " is-quiet" : ""}" data-href="/alliances/${escapeHtml(alliance.id)}" tabindex="0">
      <header class="card-head">
        ${photo(alliance)}
        <div>
          <p class="kicker">[${escapeHtml(alliance.tag)}] · Alliance</p>
          <h3>${escapeHtml(alliance.name)}</h3>
          <p class="muted">${escapeHtml((alliance.platforms || []).join(" / "))} · ${escapeHtml(alliance.region)}</p>
        </div>
        <div class="card-pills">
          <span class="pill ${statusClass(alliance.status)}">${escapeHtml(alliance.status)}</span>
          ${listingBadges(alliance)}
        </div>
      </header>
      <p class="headline">${escapeHtml(alliance.headline)}</p>
      <p class="muted">${escapeHtml(alliance.summary)}</p>
      <div class="stats">
        <div><span>Clans</span><strong>${alliance.clanCount}</strong></div>
        <div><span>Players</span><strong>${alliance.members}</strong></div>
        <div><span>${postedStat(alliance).label}</span><strong>${timeAgo(postedStat(alliance).at)}</strong></div>
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
        <a class="btn btn-ghost" href="/alliances/${escapeHtml(alliance.id)}" data-link>View alliance</a>
        ${joinDiscord(alliance, "Join Discord")}
      </footer>
    </article>
  `;
}

export function homeView({ clans, alliances, user, auth = {} }) {
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
        <a class="text-link" href="/browse" data-link>Browse all clans</a>
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
        <a class="text-link" href="/alliances" data-link>Browse alliances</a>
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
        <a class="btn btn-primary" href="/browse" data-link>Browse clans</a>
      </div>
      <div class="panel">
        <p class="eyebrow">For leaders</p>
        <h2>Post once. Keep it current.</h2>
        <p class="muted">Create an account with one Discord click. That is your sign-in — no second Discord login. Then verify your Warframe Forum profile and publish.</p>
        ${
          user
            ? `<a class="btn btn-ghost" href="/post" data-link>Post a listing</a>`
            : auth.discord
              ? discordCreateButton("/account")
              : `<a class="btn btn-ghost" href="/register" data-link>Create an account</a>`
        }
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
          <label class="field"><span>Language</span><select name="language"><option value="">Any</option>${optionList(LANGUAGES, filters.language)}</select></label>
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
          <label class="field"><span>Language</span><select name="language"><option value="">Any</option>${optionList(LANGUAGES, filters.language)}</select></label>
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
      const id = `${name}-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      return `<label class="check" for="${id}"><input id="${id}" type="checkbox" name="${name}" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""} /><span>${escapeHtml(value)}</span></label>`;
    })
    .join("");
}

function imagePicker(label) {
  return `
    <div class="field">
      <span>${escapeHtml(label)}</span>
      <div class="file-picker" data-file-picker="image">
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

function videoPicker() {
  return `
    <div class="field">
      <span>Video in post</span>
      <div class="file-picker" data-file-picker="video">
        <input type="hidden" name="removeVideo" value="" />
        <div class="file-picker-target">
          <input class="file-picker-input" name="video" type="file" accept="video/mp4,video/webm,.mp4,.webm" />
          <div class="file-picker-ui">
            <span class="file-picker-preview" data-file-preview aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2.75" y="4.75" width="14.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M8.25 8.1v4.8L13.1 10.5 8.25 8.1Z" fill="currentColor"/>
              </svg>
            </span>
            <span class="file-picker-copy">
              <strong data-file-label>Upload a video</strong>
              <small data-file-hint>MP4 or WEBM. Max 25 MB.</small>
            </span>
            <span class="file-picker-action" data-file-action>Choose video</span>
          </div>
        </div>
        <button class="file-picker-clear" type="button" data-file-clear hidden>Remove video</button>
      </div>
    </div>
  `;
}

function aboutComposer(draft = {}) {
  return `
    <div class="field">
      <span>Full post</span>
      <div class="richtext">
        <div class="richtext-toolbar" role="toolbar" aria-label="Post formatting">
          <button class="richtext-btn" type="button" data-rt="bold" title="Bold"><strong>B</strong></button>
          <button class="richtext-btn" type="button" data-rt="italic" title="Italic"><em>I</em></button>
          <button class="richtext-btn" type="button" data-rt="underline" title="Underline"><u>U</u></button>
          <button class="richtext-btn" type="button" data-rt="ulist" title="Bullet list">List</button>
          <button class="richtext-btn" type="button" data-rt="link" title="Add link">Link</button>
          <button class="richtext-btn" type="button" data-insert-video title="Insert video at cursor">Video</button>
        </div>
        <div class="richtext-editor" data-rich-editor contenteditable="true" role="textbox" aria-multiline="true" aria-label="Full post"></div>
        <textarea name="about" hidden>${escapeHtml(toEditorHtml(draft.about || ""))}</textarea>
      </div>
    </div>
    ${videoPicker()}
    <small class="field-help">Select text to format. Click in the post, then Video to place the clip. Insert again to move it.</small>
  `;
}

function demoLoginHint() {
  if (!import.meta.env.DEV) return "";
  return `<p class="muted">Local demo: <code>leader</code> / <code>recruit1</code></p>`;
}

function discordButton(nextHash, { label = "Continue with Discord", mode = "login" } = {}) {
  const params = new URLSearchParams({ next: nextHash });
  if (mode === "register") params.set("mode", "register");
  return `<a class="btn btn-discord" href="/api/auth/discord?${params}">${escapeHtml(label)}</a>`;
}

function discordCreateButton(nextHash = "/account") {
  return discordButton(nextHash, { label: "Create account with Discord", mode: "register" });
}

function forumVerifyPanel(user) {
  const token = user.forumToken || "";
  const aboutMeUrl =
    user.forumAboutMeUrl ||
    (user.forumProfileUrl
      ? `${String(user.forumProfileUrl).replace(/\/?$/, "/")}?tab=field_core_pfield_1`
      : "https://forums.warframe.com/");
  return `
    <form id="forum-form" class="stack">
      <label class="field">
        <span>Forum profile URL</span>
        <input name="profileUrl" type="url" required placeholder="https://forums.warframe.com/profile/1234-yourname/" value="${escapeHtml(user.forumProfileUrl || "")}" />
      </label>
      ${
        token
          ? `<div class="verify-code">
              <span>Put this exact code in <a href="${escapeHtml(aboutMeUrl)}" target="_blank" rel="noopener noreferrer">About Me</a>, then click Save on the forum.</span>
              <code>${escapeHtml(token)}</code>
            </div>`
          : `<p class="muted">Paste your profile URL and we will give you a one-time code.</p>`
      }
      <p class="error" id="forum-note" hidden></p>
      <div class="row">
        <button class="btn btn-ghost" type="submit" data-forum="start">${token ? "Update URL" : "Get code"}</button>
        ${token ? `<button class="btn btn-primary" type="button" data-forum="check">I saved the code</button>` : ""}
      </div>
    </form>
  `;
}

function authGate(nextHash, auth = {}) {
  return `
    <section class="auth-card">
      <p class="eyebrow">Account required</p>
      <h1>Create an account to publish</h1>
      <p class="lead">Anyone can browse. Click Create account with Discord — that creates the account and is your Discord sign-in. Then verify a Warframe Forum profile to post.</p>
      <div class="row">
        ${auth.discord ? discordCreateButton(nextHash) : ""}
        <a class="btn ${auth.discord ? "btn-ghost" : "btn-primary"}" href="/login?next=${encodeURIComponent(nextHash)}" data-link>Sign in</a>
      </div>
      ${auth.discord ? `<p class="muted">That Discord click creates the account and signs you in. You will not need a second Discord login.</p>` : ""}
      ${demoLoginHint()}
    </section>
  `;
}

export function publishGateView(user, nextHash = "/post", auth = {}) {
  if (!user) return authGate(nextHash, auth);
  if (user.publishBlock === "discord") return authGate(nextHash, auth);
  if (user.publishBlock === "age") {
    return `
      <section class="auth-card">
        <p class="eyebrow">Discord</p>
        <h1>Account is too new</h1>
        <p class="lead">Discord accounts must be at least ${user.minAgeDays || 7} days old before you can post. Yours is ${user.discordAgeDays ?? 0} days old.</p>
        <a class="btn btn-ghost" href="/browse" data-link>Browse clans</a>
      </section>
    `;
  }
  return `
    <section class="auth-card">
      <p class="eyebrow">Warframe Forum</p>
      <h1>Verify your in-game name</h1>
      <p class="lead">Prove you own a forums.warframe.com profile. Recruits and leaders can both do this. Browsing stays public.</p>
      <ol class="verify-steps">
        <li>Open <a href="https://forums.warframe.com/" target="_blank" rel="noopener noreferrer">your Warframe Forum profile</a> and copy the URL from the address bar.</li>
        <li>Paste it below and get a code.</li>
        <li>Open the <strong>About Me</strong> tab (not Activity), paste the code, and click Save.</li>
        <li>Come back here and confirm. Give the forum a few seconds if the first check misses it.</li>
      </ol>
      ${forumVerifyPanel(user)}
    </section>
  `;
}

export function postView({ user, alliances = [], draft = {}, auth = {} }) {
  const next = draft.id ? `/post?id=${draft.id}` : "/post";
  if (!user) return authGate(next, auth);
  if (!user.canPublish) return publishGateView(user, next, auth);
  const editing = Boolean(draft.id);
  return `
    <section class="page-hero">
      <p class="eyebrow">Leaders</p>
      <h1>${editing ? "Edit listing" : "Post a listing"}</h1>
      <p class="lead">${editing ? "Update this clan post. Bump it from your account page to send it to the top of the board." : "Upload an image, write the post once, and send recruits to Discord."}</p>
      <div class="tabs" role="tablist" aria-label="Listing type">
        <a class="tab is-active" href="/post${editing ? `?id=${encodeURIComponent(draft.id)}` : ""}" data-link>Clan</a>
        <a class="tab" href="/post-alliance" data-link>Alliance</a>
      </div>
    </section>
    <section class="composer">
      <form id="post-form" class="stack" novalidate>
        <div class="form-block">
          <h2>Identity</h2>
          <div class="two-col">
            <label class="field"><span>Clan name</span><input name="name" required maxlength="48" value="${escapeHtml(draft.name || "")}" /></label>
            <label class="field"><span>Tag</span><input name="tag" required maxlength="5" value="${escapeHtml(draft.tag || "")}" /></label>
            <label class="field"><span>In-game leader</span><input name="leader" required maxlength="32" value="${escapeHtml(draft.leader || user.forumName || user.username)}" /></label>
            <label class="field"><span>Founded</span><input name="founded" maxlength="8" value="${escapeHtml(draft.founded || "")}" placeholder="2019" /></label>
          </div>
          <p class="muted">Name and tag must be unique on the board. You can post more than one clan.</p>
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
            <label class="field"><span>Discord invite <small>permanent invite, we check it</small></span><input name="discord" type="url" required placeholder="https://discord.gg/yourclan" value="${escapeHtml(draft.discord || "")}" /></label>
            <label class="field">
              <span>Alliance</span>
              <select name="allianceId">
                <option value="">None</option>
                ${alliances.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === draft.allianceId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </label>
          </div>
          <fieldset class="fieldset"><legend>Playstyles</legend><div class="checks">${checks("playstyles", PLAYSTYLES, draft.playstyles || [])}</div></fieldset>
        </div>
        <div class="form-block">
          <h2>The post</h2>
          <label class="field"><span>Headline</span><input name="headline" required maxlength="90" value="${escapeHtml(draft.headline || "")}" /></label>
          <label class="field"><span>Short summary</span><textarea name="summary" required maxlength="220" rows="3">${escapeHtml(draft.summary || "")}</textarea></label>
          ${aboutComposer(draft)}
          <div class="two-col">
            <label class="field"><span>What you offer <small>one per line</small></span><textarea name="offering" required rows="5" placeholder="Fully researched Moon clan">${escapeHtml((draft.offering || []).join("\n"))}</textarea></label>
            <label class="field"><span>Requirements <small>one per line</small></span><textarea name="requirements" required rows="5" placeholder="MR 10+">${escapeHtml((draft.requirements || []).join("\n"))}</textarea></label>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Save changes" : "Publish clan"}</button>
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

export function alliancePostView({ user, draft = {}, auth = {}, clans = [] }) {
  const next = draft.id ? `/post-alliance?id=${draft.id}` : "/post-alliance";
  if (!user) return authGate(next, auth);
  if (!user.canPublish) return publishGateView(user, next, auth);
  const editing = Boolean(draft.id);
  const ownerId = draft.ownerId || user.id;
  const mine = clans.filter((clan) => clan.ownerId === ownerId);
  const selected = (draft.memberClans || []).map((clan) => clan.id);
  const rosterSelected = selected.length ? selected : mine.filter((clan) => clan.allianceId === draft.id).map((clan) => clan.id);
  return `
    <section class="page-hero">
      <p class="eyebrow">Leaders</p>
      <h1>${editing ? "Edit listing" : "Post a listing"}</h1>
      <p class="lead">${editing ? "Update this alliance post. Bump it from your account page to send it to the top of the board." : "For groups of clans that share a Discord and want one public listing."}</p>
      <div class="tabs" role="tablist" aria-label="Listing type">
        <a class="tab" href="/post" data-link>Clan</a>
        <a class="tab is-active" href="/post-alliance${editing ? `?id=${encodeURIComponent(draft.id)}` : ""}" data-link>Alliance</a>
      </div>
    </section>
    <section class="composer">
      <form id="alliance-form" class="stack" novalidate>
        <div class="form-block">
          <h2>Identity</h2>
          <div class="two-col">
            <label class="field"><span>Alliance name</span><input name="name" required maxlength="48" value="${escapeHtml(draft.name || "")}" /></label>
            <label class="field"><span>Tag</span><input name="tag" required maxlength="5" value="${escapeHtml(draft.tag || "")}" /></label>
            <label class="field"><span>Clans in alliance</span><input name="clanCount" type="number" min="1" required value="${escapeHtml(draft.clanCount || "")}" /></label>
            <label class="field"><span>Approx. players</span><input name="members" type="number" min="1" required value="${escapeHtml(draft.members || "")}" /></label>
          </div>
          <p class="muted">Name and tag must be unique on the board.</p>
          ${imagePicker("Alliance image")}
        </div>
        <div class="form-block">
          <h2>Details</h2>
          <div class="two-col">
            <label class="field"><span>Region</span><select name="region" required>${optionList(REGIONS, draft.region || "Global")}</select></label>
            <label class="field"><span>Language</span><select name="language" required>${optionList(LANGUAGES, draft.language)}</select></label>
            <label class="field"><span>Status</span><select name="status" required>${optionList(STATUSES, draft.status)}</select></label>
            <label class="field"><span>Discord invite <small>permanent invite, we check it</small></span><input name="discord" type="url" required placeholder="https://discord.gg/youralliance" value="${escapeHtml(draft.discord || "")}" /></label>
          </div>
          <fieldset class="fieldset"><legend>Platforms</legend><div class="checks">${checks("platforms", PLATFORMS, draft.platforms || [])}</div></fieldset>
          <fieldset class="fieldset">
            <legend>Clan roster</legend>
            <p class="muted">Tick your clan listings to show them on this alliance page. You can post more than one clan.</p>
            <div class="checks">${
              mine.length
                ? clanRosterChecks(mine, rosterSelected)
                : `<p class="muted">Post clan listings first, then attach them here.</p>`
            }</div>
          </fieldset>
        </div>
        <div class="form-block">
          <h2>The post</h2>
          <label class="field"><span>Headline</span><input name="headline" required maxlength="90" value="${escapeHtml(draft.headline || "")}" /></label>
          <label class="field"><span>Short summary</span><textarea name="summary" required maxlength="220" rows="3">${escapeHtml(draft.summary || "")}</textarea></label>
          ${aboutComposer(draft)}
          <div class="two-col">
            <label class="field"><span>What you offer</span><textarea name="offering" required rows="5">${escapeHtml((draft.offering || []).join("\n"))}</textarea></label>
            <label class="field"><span>Requirements</span><textarea name="requirements" required rows="5">${escapeHtml((draft.requirements || []).join("\n"))}</textarea></label>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Save changes" : "Publish alliance"}</button>
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

export function authView(mode, next = "/", { error = "", discord = true, passwordRegister = false } = {}) {
  const isLogin = mode === "login";
  const errors = {
    "discord-age": `Discord accounts must be at least 7 days old to create an account and post.`,
    "discord-email": "Use a Discord account with a verified email.",
    "discord-denied": "Discord sign-in was cancelled.",
    "discord-state": "Discord sign-in expired. Try again.",
    "discord-config": "Discord sign-in is not configured on this server.",
    "discord-linked": "That Discord account is already linked to someone else.",
    "discord-token": "Discord sign-in failed. Try again.",
    "discord-profile": "Could not read your Discord profile.",
    "discord-error": "Discord sign-in failed. Try again.",
  };
  const message = errors[error] || "";
  const nextQuery = `next=${encodeURIComponent(next)}`;
  return `
    <section class="auth-card">
      <p class="eyebrow">${isLogin ? "Welcome back" : "New account"}</p>
      <h1>${isLogin ? "Sign in to post" : "Create an account"}</h1>
      <p class="lead">${
        isLogin
          ? "Use Discord to sign back in. If you created your account with Discord, that already counts as Discord auth — next you verify Warframe Forums to post."
          : "Click the Discord button. Discord creates your account and signs you in, so you can skip a separate Discord login. To publish, verify a Warframe Forum profile."
      }</p>
      ${message ? `<p class="error">${escapeHtml(message)}</p>` : ""}
      ${
        discord
          ? `<div class="row">${isLogin ? discordButton(next) : discordCreateButton(next)}</div>`
          : `<p class="muted">Discord is not configured. ${import.meta.env.DEV ? "Use the local username form below." : "Ask the site admin to set DISCORD_CLIENT_ID."}</p>`
      }
      ${
        isLogin
          ? `<p class="muted">New here? <a href="/register?${nextQuery}" data-link>Create an account with Discord</a></p>`
          : `<p class="muted">Already have an account? <a href="/login?${nextQuery}" data-link>Sign in with Discord</a>.</p>`
      }
      ${
        isLogin || passwordRegister
          ? `<details class="auth-advanced">
        <summary>${isLogin ? "Username and password" : "Local username (dev)"}</summary>
        <form id="auth-form" class="stack" data-next="${escapeHtml(next)}">
          <label class="field"><span>Username</span><input name="username" required maxlength="20" autocomplete="username" /></label>
          <label class="field"><span>Password</span><input name="password" type="password" required minlength="6" autocomplete="${isLogin ? "current-password" : "new-password"}" /></label>
          <p class="error" id="form-note" hidden></p>
          <button class="btn btn-primary" type="submit">${isLogin ? "Sign in" : "Create account"}</button>
        </form>
      </details>`
          : ""
      }
      ${demoLoginHint()}
    </section>
  `;
}

export function accountView({ user, clans, alliances, reports = [] }) {
  const admin = Boolean(user.admin);
  return `
    <section class="page-hero">
      <p class="eyebrow">${admin ? "Moderator" : "Account"}</p>
      <h1>${escapeHtml(user.username)}</h1>
      <p class="lead">${
        admin
          ? "Edit, bump, pause, or remove any listing. Open reports are at the bottom."
          : "Edit your listing, bump it, pause recruiting, or remove it."
      }</p>
    </section>
    <section class="section">
      <div class="panel">
        <p class="kicker">Posting access</p>
        <h2>${user.canPublish ? "You can publish" : "Finish verification to post"}</h2>
        <ul class="verify-status">
          <li>${user.discordId ? `Discord connected${user.discordUsername ? ` (${escapeHtml(user.discordUsername)})` : ""} — this is your sign-in` : "Discord not connected"}</li>
          <li>${user.forumVerified ? `Forum verified${user.forumName ? ` (${escapeHtml(user.forumName)})` : ""}` : "Warframe Forum not verified"}</li>
        </ul>
        ${
          user.canPublish
            ? `<p class="muted">You can edit, bump, and publish. New listings are limited to one every 15 minutes. Bumps are once every 12 hours.</p>`
            : user.publishBlock === "forum"
              ? `<p class="muted">Discord is already done. Verify your Warframe Forum profile to publish.</p>${forumVerifyPanel(user)}`
              : user.publishBlock === "age"
                ? `<p class="muted">Discord accounts must be at least ${user.minAgeDays || 7} days old to post. Yours is ${user.discordAgeDays ?? 0} days old.</p>`
                : `<p class="muted">Connect Discord once. That creates the account and skips a second Discord login.</p><div class="row">${discordCreateButton("/account")}</div>`
        }
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>${admin ? "Clan posts" : "Your clans"}</h2><a class="text-link" href="/post" data-link>New clan</a></div>
      ${listingList(clans, "clan", "You have not posted a clan yet.")}
    </section>
    <section class="section">
      <div class="section-head"><h2>${admin ? "Alliance posts" : "Your alliances"}</h2><a class="text-link" href="/post-alliance" data-link>New alliance</a></div>
      ${listingList(alliances, "alliance", "You have not posted an alliance yet.")}
    </section>
    ${admin ? reportsPanel(reports) : ""}
    <section class="section">
      <div class="panel">
        <p class="kicker">Privacy</p>
        <h2>Your data on this site</h2>
        <p class="muted">Listings you publish are public. Discord email and session tokens are not shown on the board. Read the <a href="/privacy" data-link>privacy policy</a> for the full list, including cookies, the forum reader, and third parties.</p>
        <div class="row">
          <button class="btn btn-ghost" type="button" data-export-account>Download my data</button>
          ${admin ? "" : `<button class="btn btn-ghost btn-danger" type="button" data-delete-account>Delete my account</button>`}
        </div>
        ${admin ? `<p class="muted">Admin accounts cannot be deleted from this page so the board cannot be locked out.</p>` : ""}
      </div>
    </section>
  `;
}

function listingList(items, kind, emptyText) {
  if (!items.length) return `<p class="muted">${emptyText}</p>`;
  const editPath = kind === "clan" ? "/post" : "/post-alliance";
  const openPath = kind === "clan" ? "/clans" : "/alliances";
  const bumpAttr = kind === "clan" ? "data-bump-clan" : "data-bump-alliance";
  const deleteAttr = kind === "clan" ? "data-delete-clan" : "data-delete-alliance";
  const pauseAttr = kind === "clan" ? "data-pause-clan" : "data-pause-alliance";
  return `<div class="list">${items
    .map((item) => {
      const badges = listingBadges(item);
      return `
            <div class="list-row${item.recruiting === false ? " is-quiet" : ""}">
              ${photo(item, 44)}
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <p class="muted">[${escapeHtml(item.tag)}] · ${escapeHtml(item.status)}${badges ? ` ${badges}` : ""}</p>
              </div>
              <div class="list-actions">
                <a class="btn btn-ghost" href="${openPath}/${encodeURIComponent(item.id)}" data-link>Open</a>
                <a class="btn btn-ghost" href="${editPath}?id=${encodeURIComponent(item.id)}" data-link>Edit</a>
                <button class="btn btn-ghost" type="button" ${pauseAttr}="${escapeHtml(item.id)}" data-paused="${item.paused ? "0" : "1"}">${
                  item.paused ? "Resume" : "Pause"
                }</button>
                <button class="btn btn-ghost" type="button" ${bumpAttr}="${escapeHtml(item.id)}" ${item.canBump ? "" : "disabled"} title="${item.canBump ? "Send this post to the top of the board" : "You can bump once every 12 hours"}">Bump</button>
                <button class="btn btn-ghost" type="button" ${deleteAttr}="${escapeHtml(item.id)}">Remove</button>
              </div>
            </div>`;
    })
    .join("")}</div>`;
}

function reportsPanel(reports) {
  const open = reports.filter((item) => item.status === "open");
  const rest = reports.filter((item) => item.status !== "open");
  const rows = [...open, ...rest];
  if (!rows.length) {
    return `<section class="section"><div class="panel"><p class="kicker">Reports</p><h2>No listing reports</h2><p class="muted">Players can report dead invites, inactivity, fake posts, or stolen names.</p></div></section>`;
  }
  return `<section class="section">
      <div class="section-head"><h2>Reports</h2><p class="muted">${open.length} open</p></div>
      <div class="list">${rows
        .map(
          (item) => `
        <div class="list-row">
          <div>
            <strong>${escapeHtml(REPORT_REASON_LABELS[item.reason] || item.reason)}</strong>
            <p class="muted">${escapeHtml(item.kind)} · ${escapeHtml(item.listingName || item.listingId)} · ${escapeHtml(item.status)} · ${timeAgo(item.createdAt)}</p>
            ${item.details ? `<p class="muted">${escapeHtml(item.details)}</p>` : ""}
          </div>
          <div class="list-actions">
            <a class="btn btn-ghost" href="/${item.kind === "clan" ? "clans" : "alliances"}/${encodeURIComponent(item.listingId)}" data-link>Open</a>
            ${
              item.status === "open"
                ? `<button class="btn btn-ghost" type="button" data-resolve-report="${escapeHtml(item.id)}" data-status="resolved">Resolve</button>
                   <button class="btn btn-ghost" type="button" data-resolve-report="${escapeHtml(item.id)}" data-status="dismissed">Dismiss</button>`
                : ""
            }
          </div>
        </div>`
        )
        .join("")}</div>
    </section>`;
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
          <h3>Create an account with Discord</h3>
          <p class="muted">One Discord button creates the account and signs you in. You do not do a second Discord login. Anyone can still browse without an account.</p>
        </article>
        <article class="panel guide-step">
          <p class="kicker">Step 02</p>
          <h3>Publish a listing</h3>
          <p class="muted">Add a clan or alliance after you verify a Warframe Forum profile. Include a Discord invite you control.</p>
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
          <li>Create an account with the Discord button. That click is your Discord auth.</li>
          <li>Verify a Warframe Forum profile with a one-time code, like Warframe Market.</li>
          <li>Use a real, non-expiring Discord invite. We check it with Discord before it goes live.</li>
          <li>Clan names and tags are unique. Do not post someone else’s name.</li>
          <li>Be exact about MR, trials, and behavior rules.</li>
          <li>Bump at least every 21 days or the listing goes stale and Discord is hidden.</li>
          <li>You can pause recruiting or remove your own posts from the account page.</li>
          <li>The <a href="/privacy" data-link>privacy policy</a> lists what we store and how to download or delete it.</li>
        </ul>
      </article>
      <div class="row guide-actions">
        <a class="btn btn-primary" href="/browse" data-link>Browse clans</a>
        <a class="btn btn-ghost" href="/post" data-link>Post a listing</a>
      </div>
    </section>
  `;
}

export function clanPage(clan, { admin = false } = {}) {
  return `
    <article class="listing-page panel">
      <p class="eyebrow"><a href="/browse" data-link>Clans</a></p>
      <div class="modal-hero">
        ${photo(clan, 72)}
        <div>
          <div class="modal-kicker">
            <p class="kicker">[${escapeHtml(clan.tag)}] · Est. ${escapeHtml(clan.founded || "—")}${
              clan.allianceName
                ? ` · <a href="/alliances/${escapeHtml(clan.allianceId)}" data-link>${escapeHtml(clan.allianceName)}</a>`
                : ""
            }</p>
            <span class="pill ${statusClass(clan.status)}">${escapeHtml(clan.status)}</span>
            ${listingBadges(clan)}
          </div>
          <h1 id="clan-title">${escapeHtml(clan.name)}</h1>
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
        <div><dt>${postedStat(clan).label}</dt><dd>${timeAgo(postedStat(clan).at)}</dd></div>
      </dl>
      <div class="meter tall"><i style="width:${fillPercent(clan)}%"></i></div>
      <h2>About</h2>
      ${postBodyHtml(clan.about, clan.video)}
      <div class="two-col">
        <div><h2>They offer</h2><ul>${clan.offering.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        <div><h2>Requirements</h2><ul>${clan.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      </div>
      <div class="row listing-actions">
        ${joinDiscord(clan, `Join ${clan.name} on Discord`)}
        <button class="btn btn-ghost" type="button" data-copy-url>Copy link</button>
        ${admin ? `<button class="btn btn-ghost" type="button" data-delete-clan="${escapeHtml(clan.id)}">Remove listing</button>` : ""}
      </div>
      ${reportForm("clan", clan.id)}
    </article>
  `;
}

export function alliancePage(alliance, { admin = false } = {}) {
  const clans = alliance.memberClans || [];
  return `
    <article class="listing-page panel">
      <p class="eyebrow"><a href="/alliances" data-link>Alliances</a></p>
      <div class="modal-hero">
        ${photo(alliance, 72)}
        <div>
          <div class="modal-kicker">
            <p class="kicker">[${escapeHtml(alliance.tag)}] · Alliance</p>
            <span class="pill ${statusClass(alliance.status)}">${escapeHtml(alliance.status)}</span>
            ${listingBadges(alliance)}
          </div>
          <h1 id="alliance-title">${escapeHtml(alliance.name)}</h1>
          <p class="headline">${escapeHtml(alliance.headline)}</p>
        </div>
      </div>
      <dl class="detail-stats">
        <div><dt>Platforms</dt><dd>${escapeHtml((alliance.platforms || []).join(", "))}</dd></div>
        <div><dt>Clans</dt><dd>${alliance.clanCount}</dd></div>
        <div><dt>Players</dt><dd>${alliance.members}</dd></div>
        <div><dt>Region</dt><dd>${escapeHtml(alliance.region)}</dd></div>
        <div><dt>Language</dt><dd>${escapeHtml(alliance.language)}</dd></div>
        <div><dt>${postedStat(alliance).label}</dt><dd>${timeAgo(postedStat(alliance).at)}</dd></div>
      </dl>
      <h2>About</h2>
      ${postBodyHtml(alliance.about, alliance.video)}
      <div class="two-col">
        <div><h2>They offer</h2><ul>${alliance.offering.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        <div><h2>Requirements</h2><ul>${alliance.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      </div>
      ${
        clans.length
          ? `<h2>Clans on this board</h2><div class="mini-clans">${clans
              .map(
                (clan) =>
                  `<a class="mini-clan" href="/clans/${escapeHtml(clan.id)}" data-link>${photo(clan, 28)} ${escapeHtml(clan.name)}</a>`
              )
              .join("")}</div>`
          : ""
      }
      <div class="row listing-actions">
        ${joinDiscord(alliance, `Join ${alliance.name} on Discord`)}
        <button class="btn btn-ghost" type="button" data-copy-url>Copy link</button>
        ${admin ? `<button class="btn btn-ghost" type="button" data-delete-alliance="${escapeHtml(alliance.id)}">Remove listing</button>` : ""}
      </div>
      ${reportForm("alliance", alliance.id)}
    </article>
  `;
}

export function previewClan(form, imageUrl = null, videoUrl = null) {
  const data = new FormData(form);
  const playstyles = data.getAll("playstyles");
  return {
    id: "preview",
    name: data.get("name") || "Your clan name",
    tag: String(data.get("tag") || "TAG").toUpperCase(),
    image: imageUrl,
    video: videoUrl,
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

export function previewAlliance(form, imageUrl = null, videoUrl = null) {
  const data = new FormData(form);
  return {
    id: "preview",
    name: data.get("name") || "Your alliance",
    tag: String(data.get("tag") || "TAG").toUpperCase(),
    image: imageUrl,
    video: videoUrl,
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

export function navAccount(user, { discord = false } = {}) {
  if (user) {
    return `
      <a class="btn btn-ghost" href="/account" data-link>${escapeHtml(user.username)}</a>
      <button class="btn btn-ghost" type="button" data-logout>Sign out</button>
    `;
  }
  return `
    <a class="btn btn-ghost" href="/login" data-link>Sign in</a>
    ${discord ? discordCreateButton("/account") : `<a class="btn btn-primary" href="/register" data-link>Create account</a>`}
  `;
}
