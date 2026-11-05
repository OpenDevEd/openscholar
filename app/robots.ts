import type { MetadataRoute } from "next";
import { isLiveSite, SITE_URL } from "@/lib/seo/page-metadata";

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await isLiveSite())) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_URL}/sitemap.xml` };
}
