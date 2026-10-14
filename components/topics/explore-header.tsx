"use client";
import { useTranslations } from "next-intl";
import { AuthorsIcon, ExploreIcon, TopicsIcon } from "@/components/icons";
import { ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { useWorkspaceRouter } from "@/lib/workspaces/href";

/** Explore's header: topics and authors are each at their own address, under one title and tabs that stay in place. */
export function useExploreHeader(list: "topics" | "authors") {
  const t = useTranslations("workspaces");
  const tTopics = useTranslations("topics");
  const router = useWorkspaceRouter();
  return {
    icon: ExploreIcon,
    title: t("explore"),
    tabs: <ListViewTabs label={t("explore")} value={list} onChange={next => { if (next !== list) router.push(`/${next}`); }} tabs={[
      {value: "topics", label: tTopics("title"), icon: <TopicsIcon aria-hidden className="size-3.5" />},
      {value: "authors", label: t("authors"), icon: <AuthorsIcon aria-hidden className="size-3.5" />},
    ]} />,
  };
}
