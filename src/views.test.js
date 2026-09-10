// The messaging surface renders from plain data, so it can be checked without
// a browser. What is worth pinning here is the part that is easy to get subtly
// wrong: the tick means "verified" and nothing else, and it must never turn
// into a gate.
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountMenu,
  accountView,
  adminView,
  alliancePostView,
  alliancesView,
  browseView,
  clanCard,
  clanPage,
  compareView,
  conversationHtml,
  filterThreads,
  guideView,
  homeView,
  navAccount,
  ignoreListHtml,
  ignoreRow,
  messageBodyHtml,
  messageBubble,
  messagePresence,
  messagesView,
  playersView,
  relativeTime,
  saveButton,
  threadRow,
  verifiedTick,
} from "./views.js";
import { defaultFilters } from "./browse.js";

const verified = { id: "u1", name: "Gunson", verified: true, online: false };
const plain = { id: "u2", name: "NasNotDaily", verified: false, online: false };

const thread = {
  id: "clan:steel:u1:u2",
  kind: "clan",
  listingId: "steel",
  listingName: "Steel Meridian",
  href: "/clans/steel",
  preview: "Hi ill buy zylok",
  unread: 0,
  blocked: false,
  lastMessageAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  with: plain,
};

test("verifiedTick renders only for a verified account", () => {
  assert.match(verifiedTick(true), /verified-tick/);
  assert.equal(verifiedTick(false), "");
  assert.equal(verifiedTick(undefined), "");
});

test("verifiedTick is labelled for a screen reader", () => {
  assert.match(verifiedTick(true), /aria-label="Verified"/);
});

test("a thread row carries the tick when the other person is verified", () => {
  assert.match(threadRow({ ...thread, with: verified }), /verified-tick/);
});

// The point of the whole change: an unverified account is a full participant.
// The row must still render their name, their preview and a way in.
test("a thread row with an unverified person renders without a tick and is not gated", () => {
  const html = threadRow(thread);
  assert.doesNotMatch(html, /verified-tick/);
  assert.match(html, /NasNotDaily/);
  assert.match(html, /Hi ill buy zylok/);
  assert.match(html, /data-thread="clan:steel:u1:u2"/);
});

test("a thread row says how stale the conversation is", () => {
  assert.match(threadRow(thread), /Last update 3 days ago/);
});

test("a thread row with nothing said yet says so rather than printing a date", () => {
  const html = threadRow({ ...thread, lastMessageAt: null, last: null });
  assert.match(html, /No messages yet/);
});

test("presence in the inbox names offline out loud", () => {
  assert.match(messagePresence(plain), /Offline/);
  assert.match(messagePresence({ ...plain, online: true, presenceStatus: "ingame" }), /Online in game/);
  // A missing person is offline, not a crash.
  assert.match(messagePresence(undefined), /Offline/);
});

test("relativeTime counts up through the units and hands back past a year", () => {
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  assert.equal(relativeTime(ago(5 * 1000)), "just now");
  assert.equal(relativeTime(ago(3 * 60 * 1000)), "3 minutes ago");
  assert.equal(relativeTime(ago(60 * 60 * 1000)), "1 hour ago");
  assert.equal(relativeTime(ago(2 * 24 * 60 * 60 * 1000)), "2 days ago");
  assert.doesNotMatch(relativeTime(ago(500 * 24 * 60 * 60 * 1000)), /ago/);
  assert.equal(relativeTime("not a date"), "");
});

test("a message bubble ticks its author", () => {
  const message = { senderId: "u1", body: "hello", createdAt: new Date().toISOString(), from: verified };
  assert.match(messageBubble(message, "u2"), /verified-tick/);
  assert.doesNotMatch(messageBubble({ ...message, from: plain }, "u2"), /verified-tick/);
});

test("the conversation menu offers ignore and leave, in wfmarket's words", () => {
  const html = conversationHtml(thread, [], "u1");
  assert.match(html, /thread-menu/);
  assert.match(html, /Ignore user/);
  assert.match(html, /Leave chat/);
});

// A draft has no stored thread to leave, so offering it would be a lie - but
// there is still someone to ignore, so the menu must not vanish with it.
test("a draft conversation offers ignore but not leave", () => {
  const html = conversationHtml({ ...thread, draft: true }, [], "u1");
  assert.match(html, /Ignore user/);
  assert.doesNotMatch(html, /Leave chat/);
  assert.doesNotMatch(html, /Mute chat/);
});

test("an ignored conversation offers the way back and no composer", () => {
  const html = conversationHtml({ ...thread, blocked: true }, [], "u1");
  assert.match(html, /Stop ignoring/);
  assert.doesNotMatch(html, /data-send-form/);
});

test("the composer is a plain text box with the same character budget", () => {
  const html = conversationHtml(thread, [], "u1");
  assert.match(html, /0\/2000 chars\./);
  assert.match(html, /textarea[^>]*name="body"/);
  assert.match(html, /maxlength="2000"/);
  assert.doesNotMatch(html, /data-rich-editor/);
  assert.doesNotMatch(html, /data-rt="bold"/);
  assert.doesNotMatch(html, /data-emoji-toggle/);
});

test("a message bubble shows the words and drops scripts", () => {
  const html = messageBubble(
    {
      senderId: "u1",
      body: "<strong>hello</strong><script>alert(1)</script>",
      createdAt: new Date().toISOString(),
      from: plain,
    },
    "u2"
  );
  assert.match(html, /hello/);
  assert.doesNotMatch(html, /<strong/);
  assert.doesNotMatch(html, /<script/);
});

test("a leftover custom-emoji tag is not rendered as an image", () => {
  const html = messageBodyHtml(`hi <img data-emoji="emoji-1" src="https://evil.example/x.png"> there`);
  assert.match(html, /hi\s+there/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /evil\.example/);
});

test("the ignore list undoes a block through the same hook the menu uses", () => {
  const html = ignoreRow({ ...plain, since: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  assert.match(html, /data-block-user="u2"/);
  assert.match(html, /data-blocked="1"/);
  assert.match(html, /Un-ignore/);
  assert.match(html, /Ignored 1 hour ago/);
});

test("an empty ignore list explains itself instead of rendering nothing", () => {
  assert.match(ignoreListHtml([]), /not ignored anyone/);
});

test("the messages page marks whichever tab is showing", () => {
  const chats = messagesView({ user: { id: "u1" }, threads: [thread] });
  assert.match(chats, /class="tab is-active" href="\/messages"/);
  const ignoring = messagesView({ user: { id: "u1" }, threads: [], tab: "ignore" });
  assert.match(ignoring, /data-ignore-list/);
  assert.match(ignoring, /class="tab is-active" href="\/messages\?tab=ignore"/);
});

// An empty inbox used to return before the tabs existed. Someone with nobody to
// talk to may still have people to un-ignore, and needs the tab to reach them.
test("an empty inbox still shows the ignore tab", () => {
  const html = messagesView({ user: { id: "u1" }, threads: [] });
  assert.match(html, /No conversations yet/);
  assert.match(html, /href="\/messages\?tab=ignore"/);
});

// Signing in and creating an account were two buttons describing one Discord
// click. The pair is now a single door, and the login page behind it is what
// still offers registration.
test("a signed-out nav offers exactly one way in", () => {
  const html = navAccount(null);
  assert.match(html, /href="\/login"/);
  assert.doesNotMatch(html, /Create account/);
  assert.doesNotMatch(html, /href="\/register"/);
  assert.equal(html.match(/<a /g).length, 1, "one control, not two");
});

test("a signed-in nav is unchanged by that", () => {
  const html = navAccount({ id: "u1", username: "NewRecruit", forumVerified: false });
  assert.match(html, /data-logout/);
  assert.match(html, /href="\/account"/);
  assert.doesNotMatch(html, /href="\/login"/);
});

// The field name is the whole bug: userAvatar reads discordAvatarUrl, and a
// messenger shaped with any other key renders the fallback mark while looking
// exactly like a stale icon.
test("a thread row shows the other person's Discord picture, not the fallback", () => {
  const face = "https://cdn.discordapp.com/avatars/1/abc.png?size=128";
  const html = threadRow({ ...thread, with: { ...plain, discordAvatarUrl: face } });
  assert.match(html, /cdn\.discordapp\.com\/avatars\/1\/abc\.png/);
});

test("a thread row falls back to the mark only when there is no picture", () => {
  const html = threadRow({ ...thread, with: { ...plain, discordAvatarUrl: null } });
  assert.doesNotMatch(html, /cdn\.discordapp\.com/);
  assert.match(html, /<img/);
});

// --- Account menu ----------------------------------------------------------

const me = {
  id: "u1",
  username: "Gunson",
  forumName: "--Gunson--",
  forumVerified: true,
  presence: { status: "invisible", keepMinutes: 0 },
  keepMinutes: [0, 30, 60, 120, 240],
};

test("the account menu offers all three statuses and marks the current one", () => {
  const html = accountMenu(me);
  assert.match(html, /data-presence-pick="online"/);
  assert.match(html, /data-presence-pick="ingame"/);
  assert.match(html, /data-presence-pick="invisible"/);
  assert.match(html, /data-presence-pick="invisible" aria-pressed="true"/);
  assert.match(html, /data-presence-pick="online" aria-pressed="false"/);
});

// Your own third choice is "Invisible" - you are signed in and not
// broadcasting. What everyone else sees beside your name stays "Offline".
test("your own status reads Invisible while others still see you Offline", () => {
  assert.match(accountMenu(me), /Invisible/);
  assert.match(messagePresence({ online: false }), /Offline/);
});

test("the hold slider is notched over the offered values, not raw minutes", () => {
  const html = accountMenu({ ...me, presence: { status: "online", keepMinutes: 120 } });
  assert.match(html, /data-keep-values="0,30,60,120,240"/);
  assert.match(html, /max="4"/);
  // 120 minutes is the fourth offered value, so the slider sits on notch 3.
  assert.match(html, /value="3"/);
});

test("an unrecognised hold falls back to the first notch rather than -1", () => {
  const html = accountMenu({ ...me, presence: { status: "online", keepMinutes: 999 } });
  assert.match(html, /value="0"/);
});

test("the menu carries settings and sign out, so the nav no longer has to", () => {
  const html = accountMenu(me);
  assert.match(html, /href="\/account"/);
  assert.match(html, /data-logout/);
  assert.doesNotMatch(html, /href="\/admin"/);
  const nav = navAccount(me);
  assert.match(nav, /account-menu/);
  assert.match(nav, /href="\/messages"/);
});

test("the account menu offers message alerts", () => {
  const html = accountMenu({ ...me, presence: { status: "online", keepMinutes: 0 } });
  assert.match(html, /data-alert-sound/);
  assert.match(html, /data-alert-desktop/);
  assert.match(html, /Sound ping/);
});

test("message alerts stay out of the menu when messaging is off", () => {
  const html = accountMenu({ ...me, presence: { status: "online", keepMinutes: 0 } }, "", {
    messaging: false,
  });
  assert.doesNotMatch(html, /data-alert-sound/);
});

test("the account menu offers Staff only to admins", () => {
  const html = accountMenu({ ...me, admin: true });
  assert.match(html, /href="\/admin"/);
  assert.match(html, />Staff</);
});

test("the settings page gives staff a dashboard card", () => {
  const html = accountView({
    user: { ...me, admin: true, canPublish: true },
    clans: [],
    alliances: [],
    players: [],
    reports: [],
  });
  assert.match(html, /staff-jump/);
  assert.match(html, /href="\/admin"/);
  assert.match(html, /Open staff dashboard/);
});

test("the settings page hides the dashboard card from everyone else", () => {
  const html = accountView({
    user: { ...me, admin: false, canPublish: true },
    clans: [],
    alliances: [],
    players: [],
  });
  assert.doesNotMatch(html, /staff-jump/);
  assert.doesNotMatch(html, /Open staff dashboard/);
});

test("the staff page lists live admins and waiting Discord IDs", () => {
  const html = adminView({
    user: { id: "user-a", admin: true },
    staff: {
      admins: [
        { id: "user-a", username: "alpha", discordId: "123456789012345678", you: true, env: false },
        { id: "user-b", username: "beta", discordId: "111111111111111111", you: false, env: false },
        { id: "user-admin", username: "site-op", you: false, env: true },
      ],
      pending: [{ discordId: "999999999999999999", grantedAt: new Date().toISOString() }],
    },
    reports: [],
  });
  assert.match(html, /data-staff-form/);
  assert.match(html, /data-staff-query/);
  assert.match(html, /Grant from the dashboard/);
  assert.doesNotMatch(html, /data-revoke-admin="user-a"/);
  assert.match(html, /data-revoke-admin="user-b"/);
  assert.doesNotMatch(html, /data-revoke-admin="user-admin"/);
  assert.match(html, /Password operator/);
  assert.match(html, /data-revoke-pending="999999999999999999"/);
  assert.doesNotMatch(html, /Custom emojis/);
});

test("the hold is disabled and dimmed while you are invisible", () => {
  const html = accountMenu({ ...me, presence: { status: "invisible", keepMinutes: 120 } });
  assert.match(html, /class="keep-block is-off"/);
  assert.match(html, /disabled/);
});

test("the hold is live again as soon as you are visible", () => {
  const html = accountMenu({ ...me, presence: { status: "online", keepMinutes: 120 } });
  assert.doesNotMatch(html, /is-off/);
  assert.doesNotMatch(html, /disabled/);
});

// An invisible status is not being broadcast, so nothing is being held and
// saying "held until" would describe something that is not happening.
test("no held-until note while invisible, even with a hold stored", () => {
  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const hidden = accountMenu({ ...me, presence: { status: "invisible", keepMinutes: 120, until: soon } });
  assert.match(hidden, /presence-note[^>]*hidden/);
  const shown = accountMenu({ ...me, presence: { status: "online", keepMinutes: 120, until: soon } });
  assert.match(shown, /Held until/);
});

// Swapping a short label for a long one used to resize the summary and shove
// the rest of the nav sideways.
test("the status line reserves the widest label so the nav cannot shift", () => {
  for (const status of ["online", "ingame", "invisible"]) {
    const html = accountMenu({ ...me, presence: { status, keepMinutes: 0 } });
    assert.match(html, /account-status-sizer[^>]*>Online in game</, `sizer missing for ${status}`);
  }
});

test("a listing card and page both offer a save control", () => {
  const clan = {
    id: "steel",
    name: "Steel Meridian",
    tag: "SM",
    headline: "Endgame",
    summary: "Nights",
    playstyles: ["Late Steel Path"],
    platform: "PC",
    tier: "Moon",
    region: "North America",
    status: "Open",
    recruiting: true,
    members: 40,
    mrRequired: 10,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  assert.match(clanCard(clan), /data-save-kind="clan"/);
  assert.match(saveButton("clan", "steel"), /Save/);
  assert.equal(saveButton("clan", "preview"), "");
  const page = clanPage(clan, { similar: [{ ...clan, id: "other", name: "Other" }] });
  assert.match(page, /Similar clans/);
  assert.doesNotMatch(page, /Invite was valid/);
});

test("invite last-checked is shown when the invite is live", () => {
  const html = clanPage({
    id: "steel",
    name: "Steel Meridian",
    tag: "SM",
    headline: "",
    summary: "",
    playstyles: [],
    platform: "PC",
    tier: "Ghost",
    region: "Global",
    language: "English",
    status: "Open",
    recruiting: true,
    members: 1,
    mrRequired: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    discord: "https://discord.gg/abc",
    contact: "discord",
    inviteOk: true,
    inviteCheckedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  assert.match(html, /Invite was valid/);
});

test("home search includes players", () => {
  const html = homeView({ clans: [], alliances: [] });
  assert.match(html, /<option value="players">Players<\/option>/);
  assert.match(html, /href="\/players"/);
  assert.match(html, /LOOKING FOR A CLAN/);
});

test("the clan directory has filter presets and an online-first sort", () => {
  const html = browseView([], defaultFilters(), { items: [], page: 1, pages: 1, total: 0 });
  assert.match(html, /PC · NA/);
  assert.match(html, /PC · EU/);
  assert.match(html, /Online first/);
});

test("alliance and player directories have their own presets", () => {
  assert.match(alliancesView([], defaultFilters(), { items: [], page: 1, pages: 1, total: 0 }), /PC · EU/);
  assert.match(playersView([], defaultFilters(), { items: [], page: 1, pages: 1, total: 0 }), /PC · EU/);
});

test("an empty settings page points at browse and looking-for-clan", () => {
  const html = accountView({
    user: { ...me, admin: false, canPublish: true },
    clans: [],
    alliances: [],
    players: [],
  });
  assert.match(html, /Nothing posted yet/);
  assert.match(html, /href="\/lfc"/);
  assert.match(html, />Saved</);
});

test("the guide tells a recruit how to pick a clan", () => {
  const html = guideView();
  assert.match(html, /How to pick a clan/);
  assert.match(html, /inactivity kick/i);
});

test("the guide points other apps at the public feed", () => {
  const html = guideView();
  assert.match(html, /\/api\/v1/);
  assert.match(html, /User-Agent/);
});

test("inbox search filters by name, listing, and preview", () => {
  const unread = { ...thread, unread: 2, with: { name: "NasNotDaily" } };
  assert.equal(filterThreads([thread, unread], { unreadOnly: true }).length, 1);
  assert.equal(filterThreads([thread], { q: "zylok" }).length, 1);
  assert.equal(filterThreads([thread], { q: "nope" }).length, 0);
});

test("the inbox offers search, unread only, and mark all read", () => {
  const html = messagesView({ user: { id: "u1" }, threads: [{ ...thread, unread: 1 }] });
  assert.match(html, /data-inbox-q/);
  assert.match(html, /data-inbox-unread/);
  assert.match(html, /data-mark-all-read/);
});

test("a conversation can mute the thread and insert leader snippets", () => {
  const html = conversationHtml(thread, [], "u1", {
    snippets: [{ id: "discord", label: "Join Discord", text: "Join the Discord." }],
  });
  assert.match(html, /data-mute-thread=/);
  assert.match(html, /Mute chat/);
  assert.match(html, /data-snippet="Join the Discord."/);
});

test("filtered clan cards say why they matched", () => {
  const html = clanCard(
    {
      id: "steel",
      name: "Steel Meridian",
      tag: "SM",
      headline: "Endgame",
      summary: "Nights",
      playstyles: ["Late Steel Path"],
      platform: "PC",
      tier: "Moon",
      region: "North America",
      status: "Open",
      recruiting: true,
      members: 40,
      mrRequired: 10,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    { platform: "PC", playstyles: ["Late Steel Path"] }
  );
  assert.match(html, /Matches PC · Late Steel Path/);
});

test("a published listing can show the live checklist", () => {
  const html = clanPage(
    {
      id: "steel",
      name: "Steel",
      tag: "SM",
      headline: "",
      summary: "",
      playstyles: [],
      platform: "PC",
      tier: "Ghost",
      region: "Global",
      language: "English",
      status: "Open",
      recruiting: true,
      members: 1,
      mrRequired: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    { live: true }
  );
  assert.match(html, /Just published/);
  assert.match(html, /data-dismiss-live/);
  assert.match(html, /Copy intro/);
});

test("compare needs two clans and lists MR and inactivity", () => {
  assert.match(compareView([]), /Pick two or three/);
  const html = compareView([
    { id: "a", name: "Alpha", platform: "PC", region: "NA", status: "Open", mrRequired: 16, members: 10, tier: "Ghost", inactiveDays: 14, playstyles: ["Social"] },
    { id: "b", name: "Beta", platform: "PC", region: "EU", status: "Trial Required", mrRequired: 8, members: 20, tier: "Shadow", inactiveDays: 0, playstyles: ["Endgame"] },
  ]);
  assert.match(html, /Inactivity kick/);
  assert.match(html, /14 days/);
});

test("saved clans offer a compare checkbox", () => {
  const html = accountView({
    user: { ...me, admin: false, canPublish: true },
    clans: [{ id: "mine", name: "Mine", ownerId: "u1", status: "Open" }],
    alliances: [],
    players: [],
    saved: [{ kind: "clan", id: "steel", href: "/clans/steel", item: { id: "steel", name: "Steel" } }],
  });
  assert.match(html, /data-compare-id="steel"/);
  assert.match(html, />Viewed</);
});

test("an existing alliance listing offers ownership hand-over", () => {
  const html = alliancePostView({
    user: { ...me, canPublish: true },
    draft: { id: "steel-all", name: "Steel", tag: "STL", ownerId: "u1" },
    clans: [],
  });
  assert.match(html, /data-transfer-for="steel-all"/);
  assert.match(html, /data-transfer-kind="alliance"/);
});

test("a new alliance listing has nothing to hand over yet", () => {
  const html = alliancePostView({
    user: { ...me, canPublish: true },
    draft: {},
    clans: [],
  });
  assert.doesNotMatch(html, /data-transfer-for/);
});

test("an alliance ownership offer is answered from settings", () => {
  const html = accountView({
    user: {
      ...me,
      admin: false,
      canPublish: true,
      transferInvites: [{ id: "steel-all", name: "Steel", tag: "STL", kind: "alliance" }],
    },
    clans: [],
    alliances: [],
    players: [],
  });
  assert.match(html, /An alliance post has been offered to you/);
  assert.match(html, /href="\/alliances\/steel-all"/);
  assert.match(html, /data-transfer-accept="steel-all"/);
  assert.match(html, /data-transfer-kind="alliance"/);
});

test("an alliance editor seat edits the alliance composer", () => {
  const html = accountView({
    user: {
      ...me,
      admin: false,
      canPublish: true,
      recruitingOn: [{ id: "steel-all", name: "Steel", tag: "STL", role: "editor", kind: "alliance" }],
    },
    clans: [],
    alliances: [],
    players: [],
  });
  assert.match(html, /href="\/alliances\/steel-all"/);
  assert.match(html, /href="\/post-alliance\?id=steel-all"/);
  assert.match(html, /data-recruiter-kind="alliance"/);
});

