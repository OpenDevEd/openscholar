import {notFound} from "next/navigation";
import {PageWrapper} from "@/components/PageWrapper";
import {TopicPage} from "@/components/topics/topic-page";
import {readTopic} from "@/app/actions/topics";
import {catalogAncestors, catalogChildren, catalogNode} from "@/lib/topics/search";
import {ensureTopicCatalog} from "@/lib/topics/ensure-catalog";
export default async function Page({params}: {params: Promise<{topicId: string}>}) {
  const {topicId} = await params;
  const topic = catalogNode(topicId);
  if (topic?.level !== "topic") notFound();
  const related = catalogChildren(topic.parent).filter(node => node.id !== topicId);
  // The description is read from the platform's copy of the catalog, so that copy must exist first.
  // Rendered with the page so the description does not arrive late and push the page down.
  const detail = await ensureTopicCatalog().then(() => readTopic(topicId)).catch(() => null);
  return <PageWrapper><TopicPage key={topic.id} topic={topic} path={catalogAncestors(topicId)} related={related} detail={detail} /></PageWrapper>;
}
