function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function absoluteUrl(origin, path) {
  if (!path) return `${origin}/logo.png`;
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function listingFromPath(pathname) {
  const clan = String(pathname || "").match(/^\/clans\/([^/]+)\/?$/);
  if (clan) return { kind: "clan", id: decodeURIComponent(clan[1]) };
  const alliance = String(pathname || "").match(/^\/alliances\/([^/]+)\/?$/);
  if (alliance) return { kind: "alliance", id: decodeURIComponent(alliance[1]) };
  return null;
}

export function socialTags({ title, description, url, image, kind = "website" }) {
  const card = image && !image.endsWith("/logo.png") ? "summary_large_image" : "summary";
  return `<!--social-meta-->
    <title>${escapeAttr(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <meta property="og:site_name" content="WF Clan Recruit" />
    <meta property="og:type" content="${escapeAttr(kind)}" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:url" content="${escapeAttr(url)}" />
    <meta property="og:image" content="${escapeAttr(image)}" />
    <meta name="twitter:card" content="${card}" />
    <meta name="twitter:title" content="${escapeAttr(title)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${escapeAttr(image)}" />
    <!--/social-meta-->`;
}

export function defaultSocial(origin) {
  return socialTags({
    title: "WF Clan Recruit — Warframe Clans & Alliances",
    description:
      "WF Clan Recruit is a dark recruitment board for Warframe clans and alliances. Browse posts, join Discord, or publish your own listing.",
    url: `${origin}/`,
    image: `${origin}/logo.png`,
    kind: "website",
  });
}

export function listingSocial(origin, listing, kind) {
  const path = kind === "alliance" ? `/alliances/${listing.id}` : `/clans/${listing.id}`;
  const title = `[${listing.tag}] ${listing.name}`;
  const description = [listing.headline, listing.summary].filter(Boolean).join(" — ").slice(0, 200);
  return socialTags({
    title: `${title} — WF Clan Recruit`,
    description: description || `${listing.name} is recruiting on WF Clan Recruit.`,
    url: `${origin}${path}`,
    image: absoluteUrl(origin, listing.image),
    kind: "article",
  });
}

export function applySocialMeta(html, tags) {
  if (html.includes("<!--social-meta-->")) {
    return html.replace(/<!--social-meta-->[\s\S]*?<!--\/social-meta-->/, tags);
  }
  return html.replace("</head>", `${tags}\n  </head>`);
}

export function robotsTxt(origin) {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /account
Disallow: /login
Disallow: /register
Disallow: /post
Disallow: /post-alliance

Sitemap: ${origin}/sitemap.xml
`;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function urlEntry(origin, path, lastmod) {
  const loc = `${origin}${path}`;
  const mod = lastmod ? `\n    <lastmod>${xmlEscape(String(lastmod).slice(0, 10))}</lastmod>` : "";
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${mod}\n  </url>`;
}

export function sitemapXml(origin, { clans = [], alliances = [] } = {}) {
  const staticPages = ["/", "/browse", "/alliances", "/guide", "/privacy"];
  const urls = [
    ...staticPages.map((path) => urlEntry(origin, path)),
    ...clans.map((item) => urlEntry(origin, `/clans/${item.id}`, item.bumpedAt || item.createdAt)),
    ...alliances.map((item) => urlEntry(origin, `/alliances/${item.id}`, item.bumpedAt || item.createdAt)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}
