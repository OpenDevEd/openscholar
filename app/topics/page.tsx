import {Suspense} from "react";
import {PageWrapper} from "@/components/PageWrapper";
import {TopicList} from "@/components/topics/topic-list";
export default function Page() {
  return <PageWrapper><Suspense><TopicList /></Suspense></PageWrapper>;
}
