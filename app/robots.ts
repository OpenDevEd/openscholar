import type { MetadataRoute } from "next";
import { isLiveSite, PAPER_SITEMAP_YEARS, SITE_URL } from "@/lib/seo/page-metadata";
import { TRAINING_CRAWLERS } from "@/lib/seo/training-crawlers";

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await isLiveSite())) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: [
      { userAgent: TRAINING_CRAWLERS, disallow: "/" },
      // Search results are noindex already; crawling them only spends searches on our index.
      { userAgent: "*", allow: "/", disallow: "/results" },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, ...PAPER_SITEMAP_YEARS.map((_, id) => `${SITE_URL}/papers/sitemap/${id}.xml`)],
  };
}
