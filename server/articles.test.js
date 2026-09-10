import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_HUB_SLUGS,
  articlePath,
  canEditArticle,
  canSeeArticle,
  canWriteGuides,
  hubOf,
  isLiveArticle,
} from "../src/resources.js";
import { articleTooLong, defaultByline, parseArticleFields } from "./articles.js";
import {
  applyPendingCreator,
  grantCreator,
  grantCreatorByUserId,
  revokeCreator,
  searchCreatorCandidates,
} from "./creators.js";

test("the four hubs are a closed list", () => {
  assert.deepEqual(ARTICLE_HUB_SLUGS, ["dojo", "clan", "discord", "advertise"]);
  assert.equal(hubOf("dojo").kicker, "With Architects Anonymous");
  assert.equal(hubOf("wiki"), null);
});

test("a published article is public; a draft is not", () => {
  const live = { id: "rooms", hub: "dojo", published: true, hidden: false, ownerId: "user-1" };
  const draft = { ...live, published: false };
  const hidden = { ...live, hidden: true };
  const owner = { id: "user-1", creator: true };
  const stranger = { id: "user-2" };
  const admin = { id: "user-3", admin: true };
  assert.equal(isLiveArticle(live), true);
  assert.equal(canSeeArticle(null, live), true);
  assert.equal(canSeeArticle(stranger, draft), false);
  assert.equal(canSeeArticle(owner, draft), true);
  assert.equal(canSeeArticle(admin, hidden), true);
  assert.equal(canSeeArticle(owner, hidden), false);
});

test("creators edit their own guides; admins edit any", () => {
  const article = { id: "rooms", hub: "dojo", ownerId: "user-1" };
  assert.equal(canWriteGuides({ creator: true }), true);
  assert.equal(canWriteGuides({ admin: true }), true);
  assert.equal(canWriteGuides({}), false);
  assert.equal(canEditArticle({ id: "user-1", creator: true }, article), true);
  assert.equal(canEditArticle({ id: "user-2", creator: true }, article), false);
  assert.equal(canEditArticle({ id: "user-9", admin: true }, article), true);
  assert.equal(articlePath(article), "/resources/dojo/rooms");
});

test("an article needs a hub, a title, a summary, and a body", () => {
  const user = { username: "Gunson", forumName: "--Gunson--" };
  assert.match(parseArticleFields({}, user).error, /hub/i);
  assert.match(parseArticleFields({ hub: "dojo" }, user).error, /required/i);
  assert.match(
    parseArticleFields({ hub: "dojo", title: "Rooms", summary: "A layout" }, user).error,
    /Write the article/
  );
  const ok = parseArticleFields(
    { hub: "dojo", title: "Rooms", summary: "A layout", about: "<p>Decorate the clan hall.</p>", published: "1" },
    user
  );
  assert.equal(ok.fields.hub, "dojo");
  assert.equal(ok.fields.published, true);
  assert.equal(ok.fields.byline, "--Gunson--");
  assert.equal(defaultByline({ username: "alpha" }), "alpha");
});

test("an over-long article is refused rather than silently cut", () => {
  const html = `<p>${"word ".repeat(9000)}</p>`;
  assert.match(articleTooLong(html), /too long/);
});

test("a creator grant promotes an existing account and otherwise waits", () => {
  const actor = { id: "user-a", admin: true };
  const db = {
    users: [{ id: "user-b", discordId: "123456789012345678", creator: false, admin: false }],
    creatorGrants: [],
  };
  assert.equal(grantCreatorByUserId(db, "user-b", actor).ok, true);
  assert.equal(db.users[0].creator, true);
  const waiting = { users: [], creatorGrants: [] };
  assert.equal(grantCreator(waiting, "987654321098765432", actor).pending, true);
  assert.equal(waiting.creatorGrants[0].discordId, "987654321098765432");
});

test("a pending creator grant applies on Discord sign-in", () => {
  const db = {
    users: [{ id: "user-c", discordId: "111111111111111111", creator: false }],
    creatorGrants: [{ discordId: "111111111111111111", grantedAt: "2026-09-10T00:00:00.000Z" }],
  };
  assert.equal(applyPendingCreator(db, db.users[0]), true);
  assert.equal(db.users[0].creator, true);
  assert.equal(db.creatorGrants.length, 0);
});

test("admins are not offered as creators, and a creator can be removed", () => {
  const actor = { id: "user-a", admin: true };
  const users = [
    { id: "user-a", username: "alpha", admin: true },
    { id: "user-b", username: "beta", forumVerified: true, forumName: "Beta" },
    { id: "user-c", username: "gamma", creator: true, forumName: "Gamma" },
  ];
  assert.deepEqual(searchCreatorCandidates(users, "be", "user-a").map((item) => item.id), ["user-b"]);
  const db = { users: [{ id: "user-c", creator: true }], creatorGrants: [] };
  assert.equal(revokeCreator(db, { userId: "user-c" }).ok, true);
  assert.equal(db.users[0].creator, false);
  assert.match(grantCreator({ users, creatorGrants: [] }, "alpha", actor).error, /run the board/);
});
