import {notFound} from "next/navigation";
import {fetchQuery} from "convex/nextjs";
import {api} from "@/convex/_generated/api";
import {PageWrapper} from "@/components/PageWrapper";
import {TopicPage} from "@/components/topics/topic-page";
import type {TopicNode} from "@/lib/topics/contract";
import {readTopicNodes} from "@/app/actions/topics";
export default async function Page({params}: {params: Promise<{topicId: string}>}) {
  const {topicId} = await params;
  if (!/^T[1-9]\d*$/.test(topicId)) notFound();
  const [topic] = await readTopicNodes([topicId]);
  if (!topic) notFound();
  const path: TopicNode[] = [];
  let parent = topic.parent;
  while (parent) {
    const [node] = await fetchQuery(api.topics.catalog.resolve, {ids: [parent]});
    if (!node) break;
    path.unshift(node); parent = node.parent;
  }
  const related: TopicNode[] = [];
  let cursor: string | null = null;
  do {
    const page: {nodes: TopicNode[]; nextCursor: string | null} = await fetchQuery(api.topics.catalog.directory, {parent: topic.parent, cursor, limit: 100});
    related.push(...page.nodes.filter(node => node.id !== topicId)); cursor = page.nextCursor;
  } while (cursor);
  return <PageWrapper><TopicPage key={topic.id} topic={topic} path={path} related={related} /></PageWrapper>;
}
