import type {Metadata} from "next";
import {Suspense} from "react";
import {getTranslations} from "next-intl/server";
import {PageWrapper} from "@/components/PageWrapper";
import {TopicList} from "@/components/topics/topic-list";
import {indexedPage} from "@/lib/seo/page-metadata";

/**
 * Search engines may list the topic list and follow it to the topics, whose pages lead to papers. Its search and
 * filters are in the address, and every one of them names this plain list as the canonical address. A workspace's
 * copy of the page (`/o/<slug>/topics`) takes none of this and stays out.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, site] = await Promise.all([getTranslations("topics"), getTranslations("metadata")]);
  return indexedPage({path: "/topics", title: `${t("title")} | ${site("siteName")}`, description: site("defaultDescription")});
}

export default function Page() {
  return <PageWrapper><Suspense><TopicList /></Suspense></PageWrapper>;
}
