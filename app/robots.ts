import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";
import { isLiveSite } from "@/lib/seo/page-metadata";

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await isLiveSite())) return { rules: { userAgent: "*", disallow: "/" } };
  const t = await getTranslations("metadata");
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${t("siteUrl")}/sitemap.xml` };
}
