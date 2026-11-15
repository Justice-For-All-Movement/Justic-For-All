import type { MetadataRoute } from "next";
import { initiatives } from "@jfa/core";
import { loadSitemapArticles } from "@jfa/db";
import { publicRoutes } from "../lib/public-routes";
import { getSiteUrl, NOINDEX_PATHS } from "../lib/site-url";

export const dynamic = "force-dynamic";

/** Public, indexable pages only. Published articles come from the safe view. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = getSiteUrl();
  if (!site) return [];
  const url = (path: string) => new URL(path, site).toString();
  const indexable = publicRoutes.filter(r => !NOINDEX_PATHS.some(p => r.href.startsWith(p)));
  const articles = await loadSitemapArticles();
  return [
    ...indexable.map(r => ({ url: url(r.href) })),
    ...initiatives.map(i => ({ url: url(`/initiatives/${i.slug}`) })),
    ...articles.map(a => ({ url: url(`/articles/${a.slug}`), lastModified: a.publishedAt }))
  ];
}
