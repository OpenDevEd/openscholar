import type {Metadata} from "next";
import {cache} from "react";
import {notFound} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {indexedPage, isLiveSite} from "@/lib/seo/page-metadata";
import {PageWrapper} from "@/components/PageWrapper";
import {TopicPage} from "@/components/topics/topic-page";
import {readTopic} from "@/app/actions/topics";
import {catalogAncestors, catalogChildren, catalogNode} from "@/lib/topics/search";
import {topicHref} from "@/lib/topics/links";
import {readTopicPublicationsForPage} from "@/lib/topics/topic-page-data";

// Read once per request, for the metadata and the page.
const detailOf = cache((topicId: string) => readTopic(topicId).catch(() => null));
const publicationsOf = cache((topicId: string) => readTopicPublicationsForPage(topicId));

export async function generateMetadata({params, searchParams}: {params: Promise<{topicId: string}>; searchParams: Promise<{libraryQuery?: string}>}): Promise<Metadata> {
  const [{topicId}, {libraryQuery}] = await Promise.all([params, searchParams]);
  const topic = catalogNode(topicId);
  if (topic?.level !== "topic") return {};
  const [detail, publications, t, live] = await Promise.all([detailOf(topicId), publicationsOf(topicId), getTranslations("metadata"), isLiveSite()]);
  const page = await indexedPage({path: topicHref(topic.id, topic.name), title: `${topic.name} | ${t("siteName")}`, description: detail?.description || topic.name});
  // Only a topic whose records arrived with the page is worth a search result; the rest stay out, as they all did before.
  // A search within the topic shows other records than the ones sent, so its address stays out too.
  return {...page, robots: {index: live && !libraryQuery && !!publications?.papers.length, follow: live}};
}

export default async function Page({params}: {params: Promise<{topicId: string}>}) {
  const {topicId} = await params;
  const topic = catalogNode(topicId);
  if (topic?.level !== "topic") notFound();
  const related = catalogChildren(topic.parent).filter(node => node.id !== topicId);
  // Rendered with the page so the description does not arrive late and push the page down; so are the first records, when they're ready in time.
  const [detail, publications] = await Promise.all([detailOf(topicId), publicationsOf(topicId)]);
  return <PageWrapper><TopicPage key={topic.id} topic={topic} path={catalogAncestors(topicId)} related={related} detail={detail} publications={publications} /></PageWrapper>;
}
