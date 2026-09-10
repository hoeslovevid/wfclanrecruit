import { normalizeAbout, plainTextFromHtml } from "../src/richtext.js";
import { HEADLINE_MAX, SUMMARY_MAX } from "../src/data.js";
import { ARTICLE_PLAIN_MAX, hubOf } from "../src/resources.js";

export {
  ARTICLE_HUBS,
  ARTICLE_HUB_SLUGS,
  ARTICLE_PLAIN_MAX,
  articlePath,
  canEditArticle,
  canSeeArticle,
  canWriteGuides,
  hubList,
  hubOf,
  isLiveArticle,
} from "../src/resources.js";

export function articleTooLong(html) {
  if (plainTextFromHtml(html).length > ARTICLE_PLAIN_MAX) return "The article is too long.";
  return null;
}

export function defaultByline(user) {
  return String(user?.forumName || user?.username || "").trim().slice(0, 48);
}

export function parseArticleFields(body, user, { media = [], links = [] } = {}) {
  const hub = hubOf(body?.hub);
  if (!hub) return { error: "Pick a hub for this guide." };
  const title = String(body?.title || "").trim().slice(0, HEADLINE_MAX);
  const summary = String(body?.summary || "").trim().slice(0, SUMMARY_MAX);
  if (!title || !summary) return { error: "Fill every required field." };
  const about = normalizeAbout(body?.about);
  if (!plainTextFromHtml(about)) return { error: "Write the article." };
  const tooLong = articleTooLong(about);
  if (tooLong) return { error: tooLong };
  const byline = String(body?.byline || "").trim().slice(0, 48) || defaultByline(user);
  return {
    fields: {
      hub: hub.slug,
      title,
      summary,
      about,
      byline,
      published: String(body?.published || "") === "1" || body?.published === true || body?.published === "true",
      media,
      links,
    },
  };
}
