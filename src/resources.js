// The four resource hubs. These are a closed vocabulary: creators write
// articles into one of them, they do not invent a fifth section of the site.
// The copy is what a clan lead reads on the index, not a CMS label.

export const ARTICLE_HUBS = {
  dojo: {
    slug: "dojo",
    name: "Dojo building",
    kicker: "With Architects Anonymous",
    lead: "Layouts, rooms, and how to build a dojo with other people rather than alone.",
  },
  clan: {
    slug: "clan",
    name: "How to run a clan",
    kicker: "Management",
    lead: "Moderation, ranks, inactivity, and the resources that keep a clan from rotting.",
  },
  discord: {
    slug: "discord",
    name: "Discord and comms",
    kicker: "Servers",
    lead: "Stand up a Discord, pick the channels that matter, and plug in a bot when you have one.",
  },
  advertise: {
    slug: "advertise",
    name: "How to advertise",
    kicker: "Reach",
    lead: "This board, Reddit, in-game LFG, community Discords, and the official servers.",
  },
};

export const ARTICLE_HUB_SLUGS = Object.keys(ARTICLE_HUBS);

// Guides run longer than a listing card. 1500 characters is the clan post
// budget; an article about a dojo or a Discord setup needs room to actually
// teach, so this is the one place that budget is different.
export const ARTICLE_PLAIN_MAX = 8000;

export function hubOf(slug) {
  return ARTICLE_HUBS[String(slug || "")] || null;
}

export function hubList() {
  return ARTICLE_HUB_SLUGS.map((slug) => ARTICLE_HUBS[slug]);
}

export function articlePath(article) {
  if (!article?.hub || !article?.id) return "/resources";
  return `/resources/${article.hub}/${article.id}`;
}

export function canWriteGuides(user) {
  return Boolean(user?.admin || user?.creator);
}

export function canEditArticle(user, article) {
  if (!user || !article) return false;
  if (user.admin) return true;
  return Boolean(user.creator && article.ownerId === user.id);
}

export function canSeeArticle(user, article) {
  if (!article) return false;
  if (article.hidden) return Boolean(user?.admin);
  if (!article.published) {
    return Boolean(user && (user.admin || article.ownerId === user.id));
  }
  return true;
}

export function isLiveArticle(article) {
  return Boolean(article?.published) && !article?.hidden;
}
