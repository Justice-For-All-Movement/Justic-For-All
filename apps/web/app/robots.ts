import type { MetadataRoute } from "next";
import { getSiteUrl, NOINDEX_PATHS } from "../lib/site-url";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...NOINDEX_PATHS] }],
    ...(site ? { sitemap: new URL("/sitemap.xml", site).toString() } : {})
  };
}
