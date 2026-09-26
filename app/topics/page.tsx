import {Suspense} from "react";
import {PageWrapper} from "@/components/PageWrapper";
import {TopicList} from "@/components/topics/topic-list";
import {ensureTopicCatalog} from "@/lib/topics/ensure-catalog";
export default async function Page() {
  // The list reads the catalog straight from Convex, so it must exist first.
  await ensureTopicCatalog();
  return <PageWrapper><Suspense><TopicList /></Suspense></PageWrapper>;
}
