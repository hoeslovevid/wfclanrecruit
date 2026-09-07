import {
  CONTACT_LABELS,
  CONTACT_MODES,
  LANGUAGES,
  LINK_KINDS,
  LINK_MAX,
  PLAYSTYLES,
  PLAYSTYLE_GROUPS,
  PLATFORMS,
  REGIONS,
  STATUSES,
  TAG_MAX,
  TIER_CAPS,
  TIERS,
  groupOf,
  normalizeContact,
  normalizeLinks,
  normalizePlaystyles,
  wantsDiscord,
  wantsWhisper,
} from "./data.js";
import {
  isSafeHref,
  sanitizePostHtml,
  sectionIsEmpty,
  sectionToHtml,
  splitVideoHtml,
  toEditorHtml,
} from "./richtext.js";
import { youTubeEmbedUrl, youTubeThumbUrl } from "./video.js";
import { MEDIA_MAX, isUploadedImage, mediaList } from "./media.js";
import {
  ROLE_MAX,
  ROLE_NAME_MAX,
  ROLE_STATUSES,
  ROLE_SUGGESTIONS,
  ROLE_TEXT_MAX,
  isRoleOpen,
  openRoles,
  rolesOf,
} from "./roles.js";

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

// The group is carried into the markup so a card's chips read as playstyle /
// social / content at a glance rather than as one undifferentiated row.
function chipList(items = []) {
  return items
    .map((item) => `<span class="chip" data-group="${escapeHtml(groupOf(item))}">${escapeHtml(item)}</span>`)
    .join("");
}

// Ordered by group, then by the order the group lists them, so two clans that
// picked the same tags always show them in the same order.
function orderedPlaystyles(items = []) {
  // normalizePlaystyles already returns them in group order.
  return normalizePlaystyles(items);
}

function hueFrom(seed) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash << 5) - hash + char.charCodeAt(0);
  return Math.abs(hash) % 360;
}

// The first clip plays where the leader put the [video] marker. Any others sit
// in a strip under the post and swap into that same frame on click, so a clan
// with four contest entries shows all four without four iframes on the page.
// One stage, one strip. The stage holds both an iframe and an img and shows
// whichever the active entry needs, because a YouTube embed and a still cannot
// be swapped by changing a single src.
function mediaStage(media) {
  const first = media[0];
  if (!first) return "";
  const videoSrc = first.kind === "video" ? youTubeEmbedUrl(first.id) : "";
  const imageSrc = first.kind === "image" ? first.url : "";
  return `
    <div class="post-media" data-stop data-media-stage>
      <iframe
        ${videoSrc ? `src="${escapeHtml(videoSrc)}"` : ""}
        title="Clan video"
        loading="lazy"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        data-media-frame
        ${videoSrc ? "" : "hidden"}
      ></iframe>
      <img
        ${imageSrc ? `src="${escapeHtml(imageSrc)}"` : ""}
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        data-media-image
        ${imageSrc ? "" : "hidden"}
      />
    </div>
  `;
}

function mediaThumb(entry) {
  return entry.kind === "video" ? youTubeThumbUrl(entry.id) : entry.url;
}

function mediaStrip(media) {
  if (media.length < 2) return "";
  const items = media
    .map((entry, index) => {
      const thumb = mediaThumb(entry);
      if (!thumb) return "";
      const src = entry.kind === "video" ? youTubeEmbedUrl(entry.id) : entry.url;
      if (!src) return "";
      return `
        <button
          class="media-pick${index === 0 ? " is-active" : ""}"
          type="button"
          data-stop
          data-media-kind="${escapeHtml(entry.kind)}"
          data-media-src="${escapeHtml(src)}"
          aria-pressed="${index === 0 ? "true" : "false"}"
          aria-label="${entry.kind === "video" ? "Play video" : "Show image"} ${index + 1}"
        >
          <img src="${escapeHtml(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="160" height="90" />
          ${entry.kind === "video" ? `<span class="media-pick-badge" aria-hidden="true">▶</span>` : ""}
          <span class="media-pick-index">${index + 1}</span>
        </button>`;
    })
    .join("");
  if (!items) return "";
  const videos = media.filter((entry) => entry.kind === "video").length;
  const images = media.length - videos;
  const label = [videos && `${videos} video${videos > 1 ? "s" : ""}`, images && `${images} image${images > 1 ? "s" : ""}`]
    .filter(Boolean)
    .join(" · ");
  return `
    <div class="media-gallery" data-media-gallery>
      <p class="kicker">${escapeHtml(label)}</p>
      <div class="media-strip">${items}</div>
    </div>
  `;
}

export function postBodyHtml(about, media, { placeholder = false } = {}) {
  // Accepts the media list, or anything older that reduces to one: an array of
  // YouTube ids, or a single id string.
  const entries = Array.isArray(media)
    ? media.every((entry) => typeof entry === "string")
      ? mediaList({ videos: media })
      : mediaList({ media })
    : mediaList({ video: media });

  const html = sanitizePostHtml(toEditorHtml(about));
  const { before, after, hasMarker } = splitVideoHtml(html);
  const showSlot = placeholder && (entries.length > 0 || hasMarker);
  const stage = showSlot
    ? `<div class="post-video-slot">${
        entries.length > 1 ? `${entries.length} items appear here` : "Media appears here"
      }</div>`
    : mediaStage(entries);
  const band = showSlot ? stage : stage ? `${stage}${mediaStrip(entries)}` : "";

  if (!band) {
    return before || after ? `<div class="post-body muted">${before}${after}</div>` : "";
  }
  if (!hasMarker) {
    return `${html ? `<div class="post-body muted">${html}</div>` : ""}${band}`;
  }
  return `${before ? `<div class="post-body muted">${before}</div>` : ""}${band}${
    after ? `<div class="post-body muted">${after}</div>` : ""
  }`;
}

// Small, single-path glyphs: the row sits beside body text, so anything with
// interior detail turns to mud at 14px.
const LINK_ICONS = {
  Website: `<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 0c1.8 1.6 2.8 4 2.8 6.5S9.8 12.9 8 14.5m0-13C6.2 3.1 5.2 5.5 5.2 8S6.2 12.9 8 14.5M1.9 6h12.2M1.9 10h12.2"/>`,
  YouTube: `<path d="M14.4 5.2a1.9 1.9 0 0 0-1.3-1.3C11.9 3.5 8 3.5 8 3.5s-3.9 0-5.1.4A1.9 1.9 0 0 0 1.6 5.2 19 19 0 0 0 1.3 8c0 1 .1 1.9.3 2.8a1.9 1.9 0 0 0 1.3 1.3c1.2.4 5.1.4 5.1.4s3.9 0 5.1-.4a1.9 1.9 0 0 0 1.3-1.3c.2-.9.3-1.8.3-2.8s-.1-1.9-.3-2.8Z"/><path d="m6.7 9.9 3.2-1.9-3.2-1.9v3.8Z" fill="currentColor" stroke="none"/>`,
  Twitch: `<path d="M3 1.5h11v8.2l-3.1 3.1H8.4l-2 1.7v-1.7H3V1.5Z"/><path d="M7.4 5v3.3M10.7 5v3.3"/>`,
  TikTok: `<path d="M10 1.7v7.9a3 3 0 1 1-2.4-2.9"/><path d="M10 1.7a3.6 3.6 0 0 0 3.6 3.5"/>`,
  X: `<path d="m2.6 2.4 6.6 8.6 4.3 4.6M13.4 2.4 2.6 15.6" stroke-linecap="round"/>`,
  Instagram: `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3.4"/><circle cx="8" cy="8" r="2.8"/><circle cx="11.6" cy="4.4" r=".85" fill="currentColor" stroke="none"/>`,
  Steam: `<circle cx="8" cy="8" r="6.5"/><circle cx="10.3" cy="6" r="2"/><circle cx="5.6" cy="10.3" r="1.6"/><path d="m7 9.2 1.8-1.5"/>`,
  Reddit: `<circle cx="8" cy="9" r="5.3"/><path d="M8 3.7 9 1.4l2.6.6"/><circle cx="11.6" cy="2" r=".9" fill="currentColor" stroke="none"/><path d="M6.2 8.6h.01M9.8 8.6h.01" stroke-width="1.8" stroke-linecap="round"/><path d="M6.1 11c1.1.8 2.7.8 3.8 0"/>`,
  Other: `<path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1"/>`,
};

function linkIcon(kind) {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">${
    LINK_ICONS[kind] || LINK_ICONS.Other
  }</svg>`;
}

// Renders whatever survives normalizeLinks, so a hand-edited record with a
// javascript: URL drops out here rather than reaching the page.
export function linkRow(item) {
  const links = normalizeLinks(item?.links, isSafeHref);
  if (!links.length) return "";
  return `
    <div class="listing-links">
      ${links
        .map(
          (link) =>
            `<a class="link-pill" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer nofollow" data-stop>${linkIcon(
              link.kind
            )}<span>${escapeHtml(link.kind)}</span></a>`
        )
        .join("")}
    </div>
  `;
}

// The three boxes are optional and stack full width: side by side they forced
// every leader to write two lists of matching length, and a long one against an
// empty one looked broken. Each renders only when it holds something.
function listingSection(item, name, heading, { accent = false } = {}) {
  const html = sanitizePostHtml(sectionToHtml(item?.[name]));
  if (sectionIsEmpty(html)) return "";
  return `
    <section class="detail-list${accent ? " is-accent" : ""}">
      <h2>${escapeHtml(heading)}</h2>
      <div class="post-body">${html}</div>
    </section>
  `;
}

// A clan short an architect is recruiting even when its roster is full, so the
// roles get their own block rather than a line inside the post. Kept as a
// section rather than a tab: the board now filters on these and the cards count
// them, and none of that pays off if the detail is behind a click.
function lookingForSection(item) {
  const roles = rolesOf(item);
  if (!roles.length) return "";
  return `
    <section class="detail-list looking-for">
      <h2>Looking for</h2>
      <ul class="role-list">
        ${roles
          .map(
            (role) => `
          <li class="role${isRoleOpen(role) ? "" : " is-closed"}">
            <div class="role-line">
              <strong>${escapeHtml(role.name)}</strong>
              <span class="pill ${statusClass(role.status)}">${escapeHtml(role.status)}</span>
              ${role.count ? `<span class="role-count">${role.count} wanted</span>` : ""}
            </div>
            ${role.description ? `<p class="muted">${escapeHtml(role.description)}</p>` : ""}
            ${role.requirements ? `<p class="role-req"><span>Needs</span> ${escapeHtml(role.requirements)}</p>` : ""}
          </li>`
          )
          .join("")}
      </ul>
    </section>
  `;
}

// Some clans filter in the recruitment process itself - a form, a trial run, an
// interview. Accented because it is the last thing a recruit reads before
// acting on the listing.
export function listingSections(item) {
  return [
    listingSection(item, "offering", "They offer"),
    listingSection(item, "requirements", "Requirements"),
    listingSection(item, "howToJoin", "How to join", { accent: true }),
    lookingForSection(item),
  ].join("");
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
  if (item.hidden) bits.push(`<span class="pill is-stale">Hidden</span>`);
  if (item.paused) bits.push(`<span class="pill is-paused">Paused</span>`);
  if (item.stale) bits.push(`<span class="pill is-stale">Stale</span>`);
  if (item.inviteOk === false) bits.push(`<span class="pill is-trial">Invite failed</span>`);
  return bits.join("");
}

function recruitingNote(item) {
  if (item.hidden) return "This listing is hidden from the board.";
  if (item.paused) return "Recruiting is paused. Discord is hidden until the leader turns it back on.";
  if (item.inviteOk === false) return "The Discord invite failed a check. The leader needs a working invite.";
  if (item.stale) return "This listing went 21 days without a bump, so Discord is hidden until the leader refreshes it.";
  return "Not recruiting right now.";
}

function joinDiscord(item, label) {
  // A whisper-only listing has no invite to offer, and says so by omission.
  // The invite is optional now, so a listing that reaches recruits some other
  // way is in the same position: no button, no note about a missing one.
  if (!wantsDiscord(item) || !item.discord) return "";
  if (item.recruiting === false) {
    return `<p class="muted join-note">${escapeHtml(recruitingNote(item))}</p>`;
  }
  return `<a class="btn btn-discord" href="${escapeHtml(item.discord)}" target="_blank" rel="noopener noreferrer" data-stop>${escapeHtml(label)}</a>`;
}

// Warframe invites are handed out in-game, so the last step of joining is a
// /w to the leader. Build it from the owner's verified forum name (see
// whisperName in server/listing.js) and hide it whenever Discord is hidden.
export function whisperMessage(clan, name = clan.whisperName) {
  if (!wantsWhisper(clan)) return null;
  if (!name || clan.recruiting === false) return null;
  return `/w ${name} Hi ${name} I would like to join ${clan.name} (wfclanrecruit)`;
}

// Everyone online gets their own line, so a recruit can pick whoever is
// actually in game rather than being funnelled at one person. When nobody is
// online the owner still shows, because a whisper left unread is better than no
// way to make contact at all.
function whisperContacts(clan) {
  const contacts = clan.contacts || [];
  const online = contacts.filter((item) => item.online);
  if (online.length) return online;
  const owner = contacts.find((item) => item.owner);
  return owner ? [owner] : [];
}

function whisperBox(clan) {
  if (!wantsWhisper(clan) || clan.recruiting === false) return "";
  const rows = whisperContacts(clan)
    .map((contact) => {
      const message = whisperMessage(clan, contact.name);
      if (!message) return "";
      return `
        <div class="whisper-row">
          <div class="whisper-who">
            <strong>${escapeHtml(contact.name)}</strong>
            <span class="muted">${contact.owner ? "Leader" : "Recruiter"}</span>
            ${presenceDot(contact)}
          </div>
          <code class="whisper-text">${escapeHtml(message)}</code>
          <button class="btn btn-ghost" type="button" data-copy-listing="${escapeHtml(clan.id)}" data-copy-text="${escapeHtml(message)}">Copy whisper</button>
        </div>`;
    })
    .join("");
  if (!rows) return "";
  return `
    <div class="whisper">
      <p class="kicker">Whisper in-game</p>
      ${rows}
    </div>
  `;
}

function whisperCardButton(clan) {
  const first = whisperContacts(clan)[0];
  const message = first ? whisperMessage(clan, first.name) : null;
  if (!message) return "";
  return `<button class="btn btn-ghost btn-small" type="button" title="Copy the /w message for this clan's leader" data-copy-listing="${escapeHtml(clan.id)}" data-copy-text="${escapeHtml(message)}">Whisper</button>`;
}

// "Offline" rather than "Invisible": it is the default now, and a default
// should read as a plain state rather than as something you switched on. The
// stored value stays `invisible`, so nothing has to migrate.
const PRESENCE_LABELS = {
  online: "Online",
  ingame: "Online in game",
  invisible: "Offline",
};

// Self-declared, like warframe.market's: Warframe has no public presence API,
// so the label says what the leader chose, never what the game reports.
// Plain text beside a coloured dot, not a pill: the pill slot belongs to the
// recruiting status (Open / Selective / Trial Required). Offline renders
// nothing at all - it is the resting state of nearly every listing.
// `silent` is for the nav, where a visible label already sits beside the dot.
export function presenceDot(item, { silent = false } = {}) {
  if (!item.online) return "";
  const status = item.presenceStatus === "ingame" ? "ingame" : "online";
  const label = status === "ingame" ? "Online in game" : "Online";
  return `<span class="presence is-${status}"><i aria-hidden="true"></i>${
    silent ? "" : escapeHtml(label)
  }</span>`;
}

export function presenceSummary(status) {
  const current = PRESENCE_LABELS[status] ? status : "online";
  return `${presenceDot({ online: current !== "invisible", presenceStatus: current }, { silent: true })}<span>${escapeHtml(
    PRESENCE_LABELS[current]
  )}</span>`;
}

function keepLabel(minutes) {
  if (minutes === 0) return "While tab is open";
  return minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
}

// A held status survives a reload - the deadline is on the user record - but
// the menu used to redraw with nothing selected, so it always claimed "while
// tab is open" and the hold looked broken. Render what is actually stored, and
// say when it runs out.
export function presenceControl(user) {
  const presence = user.presence || {};
  const current = PRESENCE_LABELS[presence.status] ? presence.status : "invisible";
  const heldFor = Number(presence.keepMinutes || 0);
  const options = Object.entries(PRESENCE_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === current ? "selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");
  const keeps = (user.keepMinutes || [0, 30, 60, 120, 240])
    .map(
      (minutes) =>
        `<option value="${minutes}" ${minutes === heldFor ? "selected" : ""}>${escapeHtml(
          keepLabel(minutes)
        )}</option>`
    )
    .join("");
  const note = presence.until && heldFor ? heldUntilNote(presence.until) : "";
  return `
    <details class="presence-menu">
      <summary title="Your status">${presenceSummary(current)}</summary>
      <div class="presence-panel">
        <p class="kicker">Select your status</p>
        <label class="field"><span class="sr-only">Status</span><select data-presence-status>${options}</select></label>
        <label class="field"><span>And keep status for</span><select data-presence-keep>${keeps}</select></label>
        <p class="muted presence-note" data-presence-note ${note ? "" : "hidden"}>${escapeHtml(note)}</p>
      </div>
    </details>
  `;
}

export function heldUntilNote(until) {
  const at = new Date(until).getTime();
  if (!Number.isFinite(at) || at <= Date.now()) return "";
  return `Held until ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
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

// The board's reason to care: a clan can be full and still want an architect.
function roleHint(clan) {
  const open = openRoles(clan);
  if (!open.length) return "";
  const names = open.slice(0, 2).map((role) => role.name);
  const rest = open.length - names.length;
  return `<p class="role-hint">Looking for ${escapeHtml(names.join(", "))}${
    rest ? ` +${rest} more` : ""
  }</p>`;
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
          ${presenceDot(clan)}
        </div>
        <div class="card-pills">
          <span class="pill ${statusClass(clan.status)}">${escapeHtml(clan.status)}</span>
          ${listingBadges(clan)}
        </div>
      </header>
      <p class="headline">${escapeHtml(clan.headline)}</p>
      <p class="muted">${escapeHtml(clan.summary)}</p>
      ${roleHint(clan)}
      <div class="chips">${chipList(orderedPlaystyles(clan.playstyles).slice(0, 4))}</div>
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
        ${whisperCardButton(clan)}
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
  const board = (clans || []).filter((item) => !item.hidden);
  const boardAlliances = (alliances || []).filter((item) => !item.hidden);
  const featuredClans = board.filter((item) => item.featured).slice(0, 3);
  const featuredAlliances = boardAlliances.filter((item) => item.featured).slice(0, 2);
  const homeAlliances = (featuredAlliances.length ? featuredAlliances : boardAlliances).slice(0, 2);
  const recent = board.slice(0, 6);
  const openCount = board.filter((item) => item.status === "Open").length;

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
        <div><dt>Clan posts</dt><dd>${board.length}</dd></div>
        <div><dt>Open now</dt><dd>${openCount}</dd></div>
        <div><dt>Alliances</dt><dd>${boardAlliances.length}</dd></div>
      </dl>
    </section>

    ${
      !board.length && !boardAlliances.length
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

// A collapsed panel must not hide the fact that it is doing something, so the
// toggle carries how many filters are actually narrowing the board. `sort` and
// the recruiting default are excluded - they are always set.
function activeFilterCount(filters = {}) {
  let count = 0;
  if (String(filters.q || "").trim()) count += 1;
  for (const key of ["platform", "tier", "region", "language", "status"]) {
    if (filters[key]) count += 1;
  }
  count += (filters.playstyles || []).length;
  if (filters.role) count += 1;
  if (filters.online) count += 1;
  if (Number(filters.mr || 0) > 0) count += 1;
  return count;
}

// Built from the board, not from a fixed list, so the filter never offers a
// role that would return nothing - and a clan's invented role shows up here as
// soon as someone is recruiting for it.
function roleFilterField(options, selected) {
  if (!options.length && !selected) return "";
  const names = options.map((option) => option.name);
  if (selected && !names.some((name) => name.toLowerCase() === selected.toLowerCase())) {
    names.unshift(selected);
  }
  return `
    <label class="field"><span>Recruiting for</span><select name="role">
      <option value="">Any role</option>
      ${names
        .map(
          (name) =>
            `<option value="${escapeHtml(name)}" ${
              name.toLowerCase() === String(selected || "").toLowerCase() ? "selected" : ""
            }>${escapeHtml(name)}</option>`
        )
        .join("")}
    </select></label>
  `;
}

export function browseView(clans, filters, pager, roleOptions = []) {
  const total = pager?.total ?? clans.length;
  const label = total === 1 ? "1 clan" : `${total} clans`;
  return `
    <section class="page-hero">
      <p class="eyebrow">Clans</p>
      <h1>Browse recruitment posts</h1>
      <p class="lead">Every listing is written by a clan leader. Filter it down, then join the Discord.</p>
    </section>
    <section class="browse">
      <aside class="filters is-collapsed" data-filters>
        <button class="filters-toggle" type="button" data-filters-toggle aria-expanded="false">
          <span>Filters${activeFilterCount(filters) ? ` <em>${activeFilterCount(filters)}</em>` : ""}</span>
          <span class="filters-caret" aria-hidden="true">▾</span>
        </button>
        <div class="row-between">
          <h2>Filters</h2>
          <button class="text-link" type="button" data-clear-filters>Reset</button>
        </div>
        <form id="filter-form">
          <label class="check" for="filter-recruiting"><input id="filter-recruiting" type="checkbox" name="recruiting" value="1" ${
            filters.recruiting ? "checked" : ""
          } /><span>Recruiting now</span></label>
          <label class="field"><span>Keyword</span><input type="search" name="q" value="${escapeHtml(filters.q)}" placeholder="Name, tag, playstyle…" /></label>
          <label class="field"><span>Platform</span><select name="platform"><option value="">Any</option>${optionList(PLATFORMS, filters.platform)}</select></label>
          <label class="field"><span>Tier</span><select name="tier"><option value="">Any</option>${optionList(TIERS, filters.tier)}</select></label>
          ${roleFilterField(roleOptions, filters.role)}
          <fieldset class="fieldset">
            <legend>Playstyles</legend>
            <div class="filter-groups">${filterPlaystyleGroups(filters.playstyles || [])}</div>
          </fieldset>
          <label class="field"><span>Region</span><select name="region"><option value="">Any</option>${optionList(REGIONS, filters.region)}</select></label>
          <label class="field"><span>Language</span><select name="language"><option value="">Any</option>${optionList(LANGUAGES, filters.language)}</select></label>
          <label class="field"><span>Status</span><select name="status"><option value="">Any</option>${optionList(STATUSES, filters.status)}</select></label>
          <label class="check" for="filter-online"><input id="filter-online" type="checkbox" name="online" value="1" ${
            filters.online ? "checked" : ""
          } /><span>Online now</span></label>
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
        <div id="results">${clanResultsHtml(clans, filters, pager)}</div>
      </div>
    </section>
  `;
}

export function alliancesView(alliances, filters, pager) {
  const total = pager?.total ?? alliances.length;
  const label = total === 1 ? "1 alliance" : `${total} alliances`;
  return `
    <section class="page-hero">
      <p class="eyebrow">Alliances</p>
      <h1>Browse alliance listings</h1>
      <p class="lead">Alliances group multiple clans. Join the shared Discord if you want a wider roster.</p>
    </section>
    <section class="browse">
      <aside class="filters is-collapsed" data-filters>
        <button class="filters-toggle" type="button" data-filters-toggle aria-expanded="false">
          <span>Filters${activeFilterCount(filters) ? ` <em>${activeFilterCount(filters)}</em>` : ""}</span>
          <span class="filters-caret" aria-hidden="true">▾</span>
        </button>
        <div class="row-between">
          <h2>Filters</h2>
          <button class="text-link" type="button" data-clear-filters>Reset</button>
        </div>
        <form id="filter-form">
          <label class="check" for="filter-recruiting"><input id="filter-recruiting" type="checkbox" name="recruiting" value="1" ${
            filters.recruiting ? "checked" : ""
          } /><span>Recruiting now</span></label>
          <label class="field"><span>Keyword</span><input type="search" name="q" value="${escapeHtml(filters.q)}" /></label>
          <label class="field"><span>Platform</span><select name="platform"><option value="">Any</option>${optionList(PLATFORMS, filters.platform)}</select></label>
          <label class="field"><span>Region</span><select name="region"><option value="">Any</option>${optionList(REGIONS, filters.region)}</select></label>
          <label class="field"><span>Language</span><select name="language"><option value="">Any</option>${optionList(LANGUAGES, filters.language)}</select></label>
          <label class="field"><span>Status</span><select name="status"><option value="">Any</option>${optionList(STATUSES, filters.status)}</select></label>
        </form>
      </aside>
      <div class="browse-main">
        <p class="muted" id="result-count">${label}</p>
        <div id="results">${allianceResultsHtml(alliances, filters, pager)}</div>
      </div>
    </section>
  `;
}

export function emptyState(title = "Nothing to see here", detail = "Check back later, or post a listing.") {
  return `<div class="empty"><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(detail)}</p></div>`;
}

function browseEmpty(kind, filters) {
  if (filters.recruiting) {
    return emptyState(
      "Nothing to see here",
      `No ${kind} recruiting right now. Uncheck Recruiting now to see paused or stale posts.`
    );
  }
  return emptyState();
}

function pagerBar(pager, noun) {
  if (!pager || pager.pages <= 1) return "";
  return `<nav class="pager" aria-label="${escapeHtml(noun)} pages">
    <button class="btn btn-ghost" type="button" data-page="${pager.page - 1}" ${pager.page <= 1 ? "disabled" : ""}>Previous</button>
    <span class="muted">Page ${pager.page} of ${pager.pages}</span>
    <button class="btn btn-ghost" type="button" data-page="${pager.page + 1}" ${pager.page >= pager.pages ? "disabled" : ""}>Next</button>
  </nav>`;
}

export function clanResultsHtml(clans, filters, pager) {
  const total = pager?.total ?? clans.length;
  if (!total) return browseEmpty("clans", filters);
  return `<div class="grid">${clans.map((clan) => clanCard(clan)).join("")}</div>${pagerBar(pager, "Clan")}`;
}

export function allianceResultsHtml(alliances, filters, pager) {
  const total = pager?.total ?? alliances.length;
  if (!total) return browseEmpty("alliances", filters);
  return `<div class="grid two">${alliances.map((item) => allianceCard(item)).join("")}</div>${pagerBar(pager, "Alliance")}`;
}

// The link rows are not named form fields - they are packed into one hidden
// JSON field on submit - so the live preview reads them straight off the DOM.
// The role rows are unnamed inputs packed into one hidden JSON field on submit,
// so the live preview reads them straight off the DOM, the way the links do.
export function readRoleRows(form) {
  return [...form.querySelectorAll("[data-row-list='role'] [data-row]")].map((row) => ({
    name: row.querySelector("[data-role-name]")?.value || "",
    status: row.querySelector("[data-role-status]")?.value || "Open",
    count: Number(row.querySelector("[data-role-count]")?.value || 0),
    description: row.querySelector("[data-role-description]")?.value || "",
    requirements: row.querySelector("[data-role-requirements]")?.value || "",
  }));
}

export function readLinkRows(form) {
  return [...form.querySelectorAll("[data-row-list='link'] [data-row]")].map((row) => ({
    kind: row.querySelector("[data-link-kind]")?.value || "Other",
    url: row.querySelector("[data-link-url]")?.value || "",
  }));
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

// One repeatable-row language for the three lists a composer now carries:
// videos, links, and the plain-text lists. Each row is markup the browser can
// clone, so main.js adds and removes rows without rebuilding the section.
// `blank` is what an added row is cloned from. It is carried separately rather
// than cloned off the first rendered row, because a list can legitimately start
// empty - the links list does - and then there is nothing to copy.
function rowList(kind, { rows, blank, addLabel, empty = "", extra = "", extraLabel = "" }) {
  return `
    <div class="row-list" data-row-list="${escapeHtml(kind)}">
      <div class="row-list-items" data-row-items>${rows.join("")}</div>
      ${empty ? `<p class="row-list-empty" data-row-empty${rows.length ? " hidden" : ""}>${escapeHtml(empty)}</p>` : ""}
      <div class="row-adds">
        <button class="row-add" type="button" data-row-add>
          <span aria-hidden="true">+</span> ${escapeHtml(addLabel)}
        </button>
        ${
          extra
            ? `<button class="row-add" type="button" data-row-add-extra>
                 <span aria-hidden="true">+</span> ${escapeHtml(extraLabel)}
               </button>`
            : ""
        }
      </div>
      <template data-row-template>${blank}</template>
      ${extra ? `<template data-row-template-extra>${extra}</template>` : ""}
    </div>
  `;
}

// A link row is for YouTube. Images are uploaded rather than linked, so they
// are ours: resized, moderatable, and unable to expire or be swapped later.
function mediaLinkRow(value = "") {
  return `
    <div class="row-item media-input" data-row data-media-row="link">
      <span class="row-handle" data-row-handle role="button" tabindex="0" title="Drag to reorder, or use the arrow keys" aria-label="Reorder this item">⠿</span>
      <span class="media-badge" data-media-badge aria-hidden="true">🔗</span>
      <div class="media-thumb" data-media-thumb hidden><img alt="" referrerpolicy="no-referrer" data-media-thumb-img /></div>
      <input
        data-media-url
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="YouTube link"
        value="${escapeHtml(value)}"
      />
      <button class="row-remove" type="button" data-row-remove aria-label="Remove this item">×</button>
      <p class="media-error" data-media-error role="alert" hidden></p>
    </div>
  `;
}

// An upload row holds the file itself until submit. Once saved it comes back as
// a stored image URL (/uploads/ locally, or the R2 public URL in production)
// and renders as a thumbnail with nothing to type.
function mediaUploadRow(url = "") {
  return `
    <div class="row-item media-input" data-row data-media-row="upload" data-media-url-value="${escapeHtml(url)}">
      <span class="row-handle" data-row-handle role="button" tabindex="0" title="Drag to reorder, or use the arrow keys" aria-label="Reorder this item">⠿</span>
      <span class="media-badge" data-media-badge aria-hidden="true">🖼</span>
      <div class="media-thumb" data-media-thumb ${url ? "" : "hidden"}>
        <img alt="" ${url ? `src="${escapeHtml(url)}"` : ""} data-media-thumb-img />
      </div>
      <input class="media-file" type="file" name="mediaImage" accept="image/png,image/jpeg,image/webp,image/gif" ${url ? "hidden" : ""} />
      <span class="media-name" data-media-name>${url ? "Uploaded image" : ""}</span>
      <button class="row-remove" type="button" data-row-remove aria-label="Remove this item">×</button>
      <p class="media-error" data-media-error role="alert" hidden></p>
    </div>
  `;
}

function mediaRow(entry) {
  if (entry?.kind === "image" && isUploadedImage(entry.url)) return mediaUploadRow(entry.url);
  if (entry?.kind === "image") return mediaLinkRow(entry.url);
  if (entry?.kind === "video") return mediaLinkRow(`https://youtu.be/${entry.id}`);
  return mediaLinkRow();
}

function videoPicker(draft = {}) {
  const entries = mediaList(draft);
  const rows = (entries.length ? entries : [null]).map((entry) => mediaRow(entry));
  return `
    <fieldset class="fieldset boxed-field" data-boxed-field="media">
      <legend>Media <small>up to ${MEDIA_MAX}</small><small class="field-optional">optional</small></legend>
      ${rowList("media", {
        rows,
        blank: mediaLinkRow(),
        extra: mediaUploadRow(),
        addLabel: "Add a YouTube link",
        extraLabel: "Upload an image",
      })}
      <input type="hidden" name="media" value="" />
      <small class="field-help">The first item shows inside the post; the rest become a strip under it. Videos are YouTube links; images are uploaded here and resized for you.</small>
    </fieldset>
  `;
}

function roleRow(role = {}) {
  return `
    <div class="row-item role-item" data-row>
      <div class="role-head">
        <span class="row-handle" data-row-handle role="button" tabindex="0" title="Drag to reorder, or use the arrow keys" aria-label="Reorder this role">⠿</span>
        <input
          data-role-name
          list="role-suggestions"
          type="text"
          maxlength="${ROLE_NAME_MAX}"
          autocomplete="off"
          placeholder="Role, e.g. Event Organizer"
          value="${escapeHtml(role.name || "")}"
        />
        <select data-role-status aria-label="Is this role open">
          ${ROLE_STATUSES.map(
            (status) =>
              `<option value="${escapeHtml(status)}" ${status === role.status ? "selected" : ""}>${escapeHtml(status)}</option>`
          ).join("")}
        </select>
        <input
          data-role-count
          type="number"
          min="0"
          max="99"
          aria-label="How many people you want"
          placeholder="0"
          value="${escapeHtml(role.count ?? "")}"
        />
        <button class="row-remove" type="button" data-row-remove aria-label="Remove this role">×</button>
      </div>
      <input
        data-role-description
        type="text"
        maxlength="${ROLE_TEXT_MAX}"
        placeholder="What the role does"
        value="${escapeHtml(role.description || "")}"
      />
      <input
        data-role-requirements
        type="text"
        maxlength="${ROLE_TEXT_MAX}"
        placeholder="What it asks for"
        value="${escapeHtml(role.requirements || "")}"
      />
    </div>
  `;
}

function rolesField(draft = {}) {
  const roles = rolesOf(draft);
  return `
    <fieldset class="fieldset boxed-field" data-boxed-field="roles">
      <legend>Looking for <small>Specific roles</small><small class="field-optional">optional</small></legend>
      <datalist id="role-suggestions">
        ${ROLE_SUGGESTIONS.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}
      </datalist>
      ${rowList("role", {
        rows: roles.map((role) => roleRow(role)),
        blank: roleRow(),
        addLabel: "Add a role",
        empty: "Recruiters, moderators, event organisers, dojo architects — anything the clan actually needs.",
      })}
      <input type="hidden" name="roles" value="" />
    </fieldset>
  `;
}

function linkRowField(link = {}) {
  return `
    <div class="row-item link-input" data-row>
      <span class="row-handle" data-row-handle role="button" tabindex="0" title="Drag to reorder, or use the arrow keys" aria-label="Reorder this item">⠿</span>
      <select data-link-kind aria-label="Link type">
        ${LINK_KINDS.map(
          (kind) => `<option value="${escapeHtml(kind)}" ${kind === link.kind ? "selected" : ""}>${escapeHtml(kind)}</option>`
        ).join("")}
      </select>
      <input
        data-link-url
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="https://"
        value="${escapeHtml(link.url || "")}"
      />
      <button class="row-remove" type="button" data-row-remove aria-label="Remove this link">×</button>
    </div>
  `;
}

function linksField(draft = {}) {
  const links = normalizeLinks(draft.links, isSafeHref);
  const rows = links.length ? links.map((link) => linkRowField(link)) : [];
  return `
    <div class="field">
      <span>Other links <small class="field-optional">optional · up to ${LINK_MAX}</small></span>
      ${rowList("link", {
        rows,
        blank: linkRowField(),
        addLabel: "Add a link",
        empty: "Website, YouTube channel, Twitch, TikTok — anywhere else the clan lives.",
      })}
      <input type="hidden" name="links" value="" />
    </div>
  `;
}

// One editor shared by the post body and the three optional boxes. The toolbar
// is the same everywhere except the video button, which only means anything in
// the post body - the boxes have nowhere to put a clip.
// The rich-text boxes sit in a fieldset with a legend on the rule. A plain
// control can wear the same frame, so the fields around them stop looking like
// a different kind of thing. The legend labels the group; the control carries
// its own aria-label, since a legend is not a label for one input.
function boxedField(name, label, control, { hint = "", optional = false } = {}) {
  return `
    <fieldset class="fieldset boxed-field" data-boxed-field="${escapeHtml(name)}">
      <legend>
        ${escapeHtml(label)}
        ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
        ${optional ? `<small class="field-optional">optional</small>` : ""}
      </legend>
      ${control}
    </fieldset>
  `;
}

function richTextField(name, label, value, { hint = "", optional = false, video = false, placeholder = "" } = {}) {
  return `
    <fieldset class="fieldset rich-field" data-rich-field="${escapeHtml(name)}">
      <legend>
        ${escapeHtml(label)}
        ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
        ${optional ? `<small class="field-optional">optional</small>` : ""}
      </legend>
      <div class="richtext">
        <div class="richtext-toolbar" role="toolbar" aria-label="${escapeHtml(label)} formatting">
          <button class="richtext-btn" type="button" data-rt="bold" title="Bold"><strong>B</strong></button>
          <button class="richtext-btn" type="button" data-rt="italic" title="Italic"><em>I</em></button>
          <button class="richtext-btn" type="button" data-rt="underline" title="Underline"><u>U</u></button>
          <button class="richtext-btn" type="button" data-rt="ulist" title="Bullet list">List</button>
          <button class="richtext-btn" type="button" data-rt="olist" title="Numbered list">1.</button>
          <button class="richtext-btn" type="button" data-rt="link" title="Add link">Link</button>
          ${video ? `<button class="richtext-btn" type="button" data-insert-video title="Insert video at cursor">Video</button>` : ""}
        </div>
        <div
          class="richtext-editor${video ? "" : " is-compact"}"
          data-rich-editor
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          aria-label="${escapeHtml(label)}"
          data-placeholder="${escapeHtml(placeholder)}"
        ></div>
        <textarea name="${escapeHtml(name)}" hidden>${escapeHtml(toEditorHtml(value || ""))}</textarea>
      </div>
    </fieldset>
  `;
}

// A listing written before these boxes took formatting still holds a string
// array. sectionToHtml turns it back into the bullet list it always rendered
// as, so opening an old post in the editor shows what the page shows.
function sectionField(name, label, value, options = {}) {
  return richTextField(name, label, sectionToHtml(value), { optional: true, ...options });
}

// The browse sidebar is narrow, so the groups get a small rail and a label
// rather than the composer's full fieldset-per-group. The input name stays
// `playstyle`, so the multi-select filter reads them exactly as before.
function filterPlaystyleGroups(selected = []) {
  const chosen = normalizePlaystyles(selected);
  return PLAYSTYLE_GROUPS.map((group) => {
    const active = group.tags.filter((tag) => chosen.includes(tag)).length;
    // Sixty-six tags will not fit a sidebar, so each group opens on demand. A
    // group holding a live filter starts open, or the panel would hide the very
    // thing narrowing the board.
    return `
      <details class="filter-group" data-group="${escapeHtml(group.id)}" ${active ? "open" : ""}>
        <summary class="filter-group-label">
          <span>${escapeHtml(group.label)}</span>
          ${active ? `<em>${active}</em>` : ""}
        </summary>
        <div class="checks">${checks("playstyle", group.tags, chosen)}</div>
      </details>`;
  }).join("");
}

function playstyleGroups(selected = []) {
  return PLAYSTYLE_GROUPS.map(
    (group) => `
      <fieldset class="fieldset playstyle-group" data-group="${escapeHtml(group.id)}">
        <legend>${escapeHtml(group.label)} <small>${escapeHtml(group.hint)}</small></legend>
        <div class="checks">${checks("playstyles", group.tags, normalizePlaystyles(selected))}</div>
      </fieldset>`
  ).join("");
}

function aboutComposer(draft = {}) {
  return `
    ${richTextField("about", "Full post", draft.about || "", {
      video: true,
      hint: "The body of the listing",
    })}
    ${videoPicker(draft)}
    <small class="field-help">Select text to format. Click in the post, then Video to place the media band. Insert again to move it.</small>
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
            <label class="field"><span>Tag</span><input name="tag" required maxlength="${TAG_MAX}" value="${escapeHtml(draft.tag || "")}" /></label>
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
            <label class="field"><span>Inactivity kick <small class="field-optional">days, 0 for none</small></span><input name="inactiveDays" type="number" min="0" max="365" value="${escapeHtml(draft.inactiveDays ?? 0)}" /></label>
            <label class="field"><span>How recruits reach you</span><select name="contact" data-contact>${CONTACT_MODES.map(
              (mode) =>
                `<option value="${mode}" ${normalizeContact(draft.contact) === mode ? "selected" : ""}>${escapeHtml(
                  CONTACT_LABELS[mode]
                )}</option>`
            ).join("")}</select></label>
            <label class="field"><span>Discord invite <small data-discord-hint>optional, permanent invite — we check it</small></span><input name="discord" type="url" placeholder="https://discord.gg/yourclan" value="${escapeHtml(draft.discord || "")}" /></label>
            <label class="field">
              <span>Alliance</span>
              <select name="allianceId">
                <option value="">None</option>
                ${alliances.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === draft.allianceId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </label>
          </div>
          ${linksField(draft)}
          <p class="field-help">Recruits need at least one route: a Discord invite, a verified forum name for whispers, or a link.</p>
          <fieldset class="fieldset">
            <legend>Recruiters</legend>
            ${
              editing
                ? `<p class="field-help">Other verified players who share the whispers for this clan. They have to accept before their name appears, and they get no access to edit this post.</p>
              <div data-roster-for="${escapeHtml(draft.id)}">
                <div data-roster-slot><p class="muted">Loading…</p></div>
              </div>`
                : `<p class="field-help">Publish the clan first, then come back here to invite recruiters.</p>`
            }
          </fieldset>
          <div class="playstyle-groups">${playstyleGroups(draft.playstyles || [])}</div>
          ${rolesField(draft)}
        </div>
        <div class="form-block">
          <h2>The post</h2>
          ${boxedField(
            "headline",
            "Headline",
            `<input name="headline" aria-label="Headline" required maxlength="90" value="${escapeHtml(draft.headline || "")}" />`,
            { hint: "One line, shown on the card" }
          )}
          ${boxedField(
            "summary",
            "Short summary",
            `<textarea name="summary" aria-label="Short summary" required maxlength="220" rows="3">${escapeHtml(draft.summary || "")}</textarea>`,
            { hint: "A sentence under the headline" }
          )}
          ${aboutComposer(draft)}
          ${sectionField("offering", "What you offer", draft.offering, {
            hint: "What the clan gives a recruit",
            placeholder: "Fully researched Moon clan, weekly events, free forma…",
          })}
          ${sectionField("requirements", "Requirements", draft.requirements, {
            hint: "What the clan asks of them",
            placeholder: "MR 10+, voice on for hunts…",
          })}
          ${sectionField("howToJoin", "How to join", draft.howToJoin, {
            hint: "The steps before an invite",
            placeholder: "Post an intro in #recruitment…",
          })}
          <small class="field-help">Leave any of the three empty and the listing simply will not show that section.</small>
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
            <label class="field"><span>Tag</span><input name="tag" required maxlength="${TAG_MAX}" value="${escapeHtml(draft.tag || "")}" /></label>
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
            <label class="field"><span>Discord invite <small>optional, permanent invite — we check it</small></span><input name="discord" type="url" placeholder="https://discord.gg/youralliance" value="${escapeHtml(draft.discord || "")}" /></label>
          </div>
          ${linksField(draft)}
          <p class="field-help">An alliance needs a Discord invite or at least one link — that is how recruits reach you.</p>
          <fieldset class="fieldset"><legend>Platforms</legend><div class="checks">${checks("platforms", PLATFORMS, draft.platforms || [])}</div></fieldset>
          ${rolesField(draft)}
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
          ${boxedField(
            "headline",
            "Headline",
            `<input name="headline" aria-label="Headline" required maxlength="90" value="${escapeHtml(draft.headline || "")}" />`,
            { hint: "One line, shown on the card" }
          )}
          ${boxedField(
            "summary",
            "Short summary",
            `<textarea name="summary" aria-label="Short summary" required maxlength="220" rows="3">${escapeHtml(draft.summary || "")}</textarea>`,
            { hint: "A sentence under the headline" }
          )}
          ${aboutComposer(draft)}
          ${sectionField("offering", "What you offer", draft.offering, {
            hint: "What the alliance gives a clan",
            placeholder: "Shared Discord, cross-clan events…",
          })}
          ${sectionField("requirements", "Requirements", draft.requirements, {
            hint: "What the alliance asks of them",
            placeholder: "Active clan with 20+ members…",
          })}
          ${sectionField("howToJoin", "How to join", draft.howToJoin, {
            hint: "The steps before joining",
            placeholder: "Have your clan leader open a ticket…",
          })}
          <small class="field-help">Leave any of the three empty and the listing simply will not show that section.</small>
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
      <h1>${escapeHtml(displayName(user))}</h1>
      ${
        displayName(user) !== user.username
          ? `<p class="muted account-alias">Signed in as ${escapeHtml(user.username)}</p>`
          : ""
      }
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
      ${listingList(clans, "clan", "You have not posted a clan yet.", { admin })}
    </section>
    ${recruiterInvitesPanel(user)}
    ${recruitingOnPanel(user)}
    <section class="section">
      <div class="section-head"><h2>${admin ? "Alliance posts" : "Your alliances"}</h2><a class="text-link" href="/post-alliance" data-link>New alliance</a></div>
      ${listingList(alliances, "alliance", "You have not posted an alliance yet.", { admin })}
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

function recruiterInvitesPanel(user) {
  const invites = user.invites || [];
  if (!invites.length) return "";
  return `
    <section class="section">
      <div class="panel">
        <p class="kicker">Recruiter invites</p>
        <h2>${invites.length === 1 ? "A clan asked you to help recruit" : "Clans asked you to help recruit"}</h2>
        <p class="muted">Accepting puts your in-game name on that public listing so recruits can whisper you. You can leave at any time, and you get no edit access to the post.</p>
        <div class="list">
          ${invites
            .map(
              (invite) => `
            <div class="list-row">
              <div>
                <strong>${escapeHtml(invite.name)}</strong>
                <p class="muted">[${escapeHtml(invite.tag)}]</p>
              </div>
              <div class="list-actions">
                <a class="btn btn-ghost" href="/clans/${escapeHtml(invite.id)}" data-link>Read the post</a>
                <button class="btn btn-ghost" type="button" data-invite-accept="${escapeHtml(invite.id)}">Accept</button>
                <button class="btn btn-ghost btn-danger" type="button" data-invite-decline="${escapeHtml(invite.id)}">Decline</button>
              </div>
            </div>`
            )
            .join("")}
        </div>
        <p class="muted" data-invite-note hidden></p>
      </div>
    </section>
  `;
}

function recruitingOnPanel(user) {
  const listings = user.recruitingOn || [];
  if (!listings.length) return "";
  return `
    <section class="section">
      <div class="section-head"><h2>You recruit for</h2></div>
      <div class="list">
        ${listings
          .map(
            (item) => `
          <div class="list-row">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <p class="muted">[${escapeHtml(item.tag)}] · your name is on this post</p>
            </div>
            <div class="list-actions">
              <a class="btn btn-ghost" href="/clans/${escapeHtml(item.id)}" data-link>Open</a>
              <button class="btn btn-ghost btn-danger" type="button" data-recruiter-leave="${escapeHtml(item.id)}">Leave</button>
            </div>
          </div>`
          )
          .join("")}
      </div>
    </section>
  `;
}

// Deliberately not a <form>: this panel renders inside the post editor's form,
// and HTML forbids nested forms - the browser drops the inner one, which left
// the Invite button submitting the listing instead of sending an invite.
export function rosterPanel(roster = [], max = 5) {
  const rows = roster.length
    ? roster
        .map(
          (entry) => `
      <div class="roster-row">
        <div>
          <strong>${escapeHtml(entry.username)}</strong>
          <span class="muted">${entry.forumName ? escapeHtml(entry.forumName) : "no in-game name"}</span>
        </div>
        <span class="pill ${entry.status === "accepted" ? "is-open" : "is-selective"}">${
          entry.status === "accepted" ? "Recruiting" : "Invite pending"
        }</span>
        <button class="btn btn-ghost btn-small" type="button" data-roster-remove="${escapeHtml(entry.userId)}">Remove</button>
      </div>`
        )
        .join("")
    : `<p class="muted">No recruiters yet. Invite up to ${max} verified players to share the whispers.</p>`;
  return `
    <div class="roster">
      ${rows}
      <div class="row roster-add">
        <label class="field"><span class="sr-only">Username</span><input data-roster-username placeholder="Their username here" maxlength="20" /></label>
        <button class="btn btn-ghost" type="button" data-roster-invite ${roster.length >= max ? "disabled" : ""}>Invite</button>
      </div>
      <p class="muted" data-roster-note hidden></p>
    </div>
  `;
}

// What a leader actually wants to know before bumping: is anyone reading this,
// and is anyone acting on it.
function listingStats(item) {
  if (!item.recent) return "";
  const { views, whispers } = item.recent;
  if (!views && !whispers && !item.stats?.views) {
    return `<p class="muted listing-stats">No views yet. New posts take a day or two to get read.</p>`;
  }
  const total = item.stats?.views || 0;
  return `<p class="muted listing-stats">
    <strong>${views}</strong> view${views === 1 ? "" : "s"} and
    <strong>${whispers}</strong> whisper${whispers === 1 ? "" : "s"} copied in the last 7 days${
      total ? ` · ${total} views all time` : ""
    }
  </p>`;
}

function listingList(items, kind, emptyText, { admin = false } = {}) {
  if (!items.length) return `<p class="muted">${emptyText}</p>`;
  const editPath = kind === "clan" ? "/post" : "/post-alliance";
  const openPath = kind === "clan" ? "/clans" : "/alliances";
  const bumpAttr = kind === "clan" ? "data-bump-clan" : "data-bump-alliance";
  const deleteAttr = kind === "clan" ? "data-delete-clan" : "data-delete-alliance";
  const pauseAttr = kind === "clan" ? "data-pause-clan" : "data-pause-alliance";
  const hideAttr = kind === "clan" ? "data-hide-clan" : "data-hide-alliance";
  return `<div class="list">${items
    .map((item) => {
      const badges = listingBadges(item);
      return `
            <div class="list-row${item.recruiting === false ? " is-quiet" : ""}">
              ${photo(item, 44)}
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <p class="muted">[${escapeHtml(item.tag)}] · ${escapeHtml(item.status)}${badges ? ` ${badges}` : ""}</p>
                ${listingStats(item)}
              </div>
              <div class="list-actions">
                <a class="btn btn-ghost" href="${openPath}/${encodeURIComponent(item.id)}" data-link>Open</a>
                <a class="btn btn-ghost" href="${editPath}?id=${encodeURIComponent(item.id)}" data-link>Edit</a>
                <button class="btn btn-ghost" type="button" ${pauseAttr}="${escapeHtml(item.id)}" data-paused="${item.paused ? "0" : "1"}">${
                  item.paused ? "Resume" : "Pause"
                }</button>
                ${
                  admin
                    ? `<button class="btn btn-ghost" type="button" ${hideAttr}="${escapeHtml(item.id)}" data-hidden="${item.hidden ? "0" : "1"}">${
                        item.hidden ? "Unhide" : "Hide"
                      }</button>`
                    : ""
                }
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
          <li>You can pause recruiting or remove your own posts from the account page. Moderators can hide a listing from the board without deleting it.</li>
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
          <div class="chips">${chipList(orderedPlaystyles(clan.playstyles))}</div>
          ${linkRow(clan)}
        </div>
      </div>
      <dl class="detail-stats">
        <div><dt>Platform</dt><dd>${escapeHtml(clan.platform)}</dd></div>
        <div><dt>Tier</dt><dd>${escapeHtml(clan.tier)}</dd></div>
        <div><dt>Roster</dt><dd>${clan.members} / ${capacity(clan)}</dd></div>
        <div><dt>MR</dt><dd>${clan.mrRequired === 0 ? "Any" : `${clan.mrRequired}+`}</dd></div>
        <div><dt>Inactivity kick</dt><dd>${
          clan.inactiveDays ? `${clan.inactiveDays} days` : "None"
        }</dd></div>
        <div><dt>Region</dt><dd>${escapeHtml(clan.region)}</dd></div>
        <div><dt>Language</dt><dd>${escapeHtml(clan.language)}</dd></div>
        <div><dt>Leader</dt><dd>${escapeHtml(clan.leader)} ${presenceDot(clan)}</dd></div>
        <div><dt>${postedStat(clan).label}</dt><dd>${timeAgo(postedStat(clan).at)}</dd></div>
      </dl>
      <div class="meter tall"><i style="width:${fillPercent(clan)}%"></i></div>
      <h2>About</h2>
      ${postBodyHtml(clan.about, mediaList(clan))}
      ${listingSections(clan)}
      ${whisperBox(clan)}
      <div class="row listing-actions">
        ${joinDiscord(clan, `Join ${clan.name} on Discord`)}
        <button class="btn btn-ghost" type="button" data-copy-url>Copy link</button>
        ${admin ? `<button class="btn btn-ghost" type="button" data-hide-clan="${escapeHtml(clan.id)}" data-hidden="${clan.hidden ? "0" : "1"}">${clan.hidden ? "Unhide listing" : "Hide listing"}</button>
        <button class="btn btn-ghost" type="button" data-delete-clan="${escapeHtml(clan.id)}">Remove listing</button>` : ""}
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
          ${linkRow(alliance)}
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
      ${postBodyHtml(alliance.about, mediaList(alliance))}
      ${listingSections(alliance)}
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
        ${admin ? `<button class="btn btn-ghost" type="button" data-hide-alliance="${escapeHtml(alliance.id)}" data-hidden="${alliance.hidden ? "0" : "1"}">${alliance.hidden ? "Unhide listing" : "Hide listing"}</button>
        <button class="btn btn-ghost" type="button" data-delete-alliance="${escapeHtml(alliance.id)}">Remove listing</button>` : ""}
      </div>
      ${reportForm("alliance", alliance.id)}
    </article>
  `;
}

export function previewClan(form, imageUrl = null, mediaEntries = []) {
  const data = new FormData(form);
  const playstyles = data.getAll("playstyles");
  return {
    id: "preview",
    name: data.get("name") || "Your clan name",
    tag: String(data.get("tag") || "TAG").toUpperCase(),
    image: imageUrl,
    media: mediaEntries,
    links: readLinkRows(form),
    howToJoin: data.get("howToJoin") || "",
    roles: readRoleRows(form),
    platform: data.get("platform") || "PC",
    tier: data.get("tier") || "Ghost",
    members: Number(data.get("members") || 1),
    mrRequired: Number(data.get("mrRequired") || 0),
    inactiveDays: Number(data.get("inactiveDays") || 0),
    playstyles: playstyles.length ? playstyles : ["Social"],
    region: data.get("region") || "Global",
    language: data.get("language") || "English",
    status: data.get("status") || "Open",
    leader: data.get("leader") || "Leader",
    contact: data.get("contact") || "both",
    discord: data.get("discord") || "",
    allianceName: null,
    headline: data.get("headline") || "Your headline appears here.",
    summary: data.get("summary") || "A short summary shows under the headline.",
    about: data.get("about") || "",
    offering: data.get("offering") || "",
    requirements: data.get("requirements") || "",
    createdAt: new Date().toISOString(),
  };
}

export function previewAlliance(form, imageUrl = null, mediaEntries = []) {
  const data = new FormData(form);
  return {
    id: "preview",
    name: data.get("name") || "Your alliance",
    tag: String(data.get("tag") || "TAG").toUpperCase(),
    image: imageUrl,
    media: mediaEntries,
    links: readLinkRows(form),
    howToJoin: data.get("howToJoin") || "",
    roles: readRoleRows(form),
    platforms: data.getAll("platforms").length ? data.getAll("platforms") : ["PC"],
    region: data.get("region") || "Global",
    language: data.get("language") || "English",
    status: data.get("status") || "Open",
    clanCount: Number(data.get("clanCount") || 1),
    members: Number(data.get("members") || 1),
    discord: data.get("discord") || "",
    headline: data.get("headline") || "Your headline appears here.",
    summary: data.get("summary") || "A short summary shows under the headline.",
    about: data.get("about") || "",
    offering: data.get("offering") || "",
    requirements: data.get("requirements") || "",
    memberClans: [],
    createdAt: new Date().toISOString(),
  };
}

// A leader is known in game by their Warframe name, not by whatever their
// Discord login happens to be called. Once a forum profile is verified that is
// the name recruits will whisper, so it is the name we show them.
export function displayName(user) {
  return (user?.forumVerified && user?.forumName) || user?.username || "";
}

export function navAccount(user, { discord = false } = {}) {
  if (user) {
    const invites = (user.invites || []).length;
    const badge = invites
      ? `<span class="nav-badge" aria-label="${invites} recruiter invite${invites === 1 ? "" : "s"}">${invites}</span>`
      : "";
    return `
      ${presenceControl(user)}
      <a class="btn btn-ghost" href="/account" data-link>${escapeHtml(displayName(user))}${badge}</a>
      <button class="btn btn-ghost" type="button" data-logout>Sign out</button>
    `;
  }
  return `
    <a class="btn btn-ghost" href="/login" data-link>Sign in</a>
    ${discord ? discordCreateButton("/account") : `<a class="btn btn-primary" href="/register" data-link>Create account</a>`}
  `;
}
