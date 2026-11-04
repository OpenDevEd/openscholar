import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";
import { INDEXED_PATHS } from "@/lib/seo/page-metadata";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const t = await getTranslations("metadata");
  return INDEXED_PATHS.map((path) => ({ url: path === "/" ? t("siteUrl") : `${t("siteUrl")}${path}` }));
}
