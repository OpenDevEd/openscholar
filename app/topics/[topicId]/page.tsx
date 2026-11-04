import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {namedTitle} from "@/lib/seo/page-metadata";
import {PageWrapper} from "@/components/PageWrapper";
import {TopicPage} from "@/components/topics/topic-page";
import {readTopic} from "@/app/actions/topics";
import {catalogAncestors, catalogChildren, catalogNode} from "@/lib/topics/search";
export async function generateMetadata({params}: {params: Promise<{topicId: string}>}): Promise<Metadata> {
  const {topicId} = await params;
  const topic = catalogNode(topicId);
  return topic?.level === "topic" ? {title: await namedTitle(topic.name)} : {};
}

export default async function Page({params}: {params: Promise<{topicId: string}>}) {
  const {topicId} = await params;
  const topic = catalogNode(topicId);
  if (topic?.level !== "topic") notFound();
  const related = catalogChildren(topic.parent).filter(node => node.id !== topicId);
  // Rendered with the page so the description does not arrive late and push the page down.
  const detail = await readTopic(topicId).catch(() => null);
  return <PageWrapper><TopicPage key={topic.id} topic={topic} path={catalogAncestors(topicId)} related={related} detail={detail} /></PageWrapper>;
}
