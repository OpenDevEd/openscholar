import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

/** The app's public address. `openscholar.ai` itself is the marketing site. */
export const SITE_URL = "https://discover.openscholar.ai";

/** Whether this request came to the real site: dev and previews stay out of search engines. */
export async function isLiveSite() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return host === new URL(SITE_URL).host;
}

/** What every link preview carries; a page adds its own title, description and address. */
export async function previewDefaults() {
  const t = await getTranslations("metadata");
  const image = { url: "/og.png", width: 1200, height: 630, alt: t("siteName") };
  return {
    openGraph: { siteName: t("siteName"), locale: t("locale"), type: "website" as const, images: [image] },
    twitter: { card: "summary_large_image" as const, creator: t("twitterCreator"), images: [image] },
  };
}

/**
 * A page search engines may list. Every other page stays out, which the root layout sets, so a new
 * page is private to search until it's named here. `title` is the whole title, as a page's tab and
 * its preview show it.
 */
export async function indexedPage({ path, title, description }: { path: string; title: string; description: string }): Promise<Metadata> {
  const [live, defaults] = await Promise.all([isLiveSite(), previewDefaults()]);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: { index: live, follow: live },
    openGraph: { ...defaults.openGraph, title, description, url: path },
    twitter: { ...defaults.twitter, title, description },
  };
}

/** A title under a section that has its own: a layout's plain title stops the root's template reaching further down. */
export async function namedTitle(name: string): Promise<Metadata["title"]> {
  const t = await getTranslations("metadata");
  return { absolute: `${name} | ${t("siteName")}` };
}

/** The search-engine pages, for the sitemap. */
export const INDEXED_PATHS = ["/", "/pricing", "/terms", "/privacy", "/cookie-policy", "/credits"] as const;

/**
 * The paper pages search engines are asked to read (`app/papers/sitemap.ts`): in each band of years, the 10,000 most cited
 * papers with an abstract, as only those pages are indexed. Bands, not one list, so recent papers get their share and each
 * sitemap is read on its own: our index numbers pages only to its 10,000th result. Grow the list by adding bands once
 * Search Console shows most of these indexed, never the whole index.
 */
export const PAPER_SITEMAP_YEARS = ["<2001", "2001-2010", "2011-2016", "2017-2021", ">2021"] as const;
