import type { MetadataRoute } from "next";
import { INDEXED_PATHS, SITE_URL } from "@/lib/seo/page-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXED_PATHS.map((path) => ({ url: path === "/" ? SITE_URL : `${SITE_URL}${path}` }));
}
