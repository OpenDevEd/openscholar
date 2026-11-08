"use client";

import { useTranslations } from "next-intl";
import { TopicHoverCard } from "@/components/entity-cards";
import { useCloseFocus } from "@/components/focus-mode/close-context";
import { useTopicFilter } from "@/components/paper-card/hooks";
import { FilterName } from "@/components/paper-card/shared";

/**
 * A paper's topic or research area. Like an author's name, it narrows the page's search, or
 * starts one where the page has none; its card, a hover away, goes to the topic's page.
 */
export function TopicLink({ topic, className = "" }: {
  topic: { id: string; display_name: string };
  className?: string;
}) {
  const t = useTranslations("searchFilters");
  const filter = useTopicFilter();
  const closeFocus = useCloseFocus();
  const id = topic.id.replace(/^https?:\/\/openalex\.org\//, "");
  const name = topic.display_name;
  return (
    <TopicHoverCard id={id} name={name}>
      <FilterName
        pressed={filter.selected.includes(id)}
        label={t("filterByTopic", { name })}
        className={className}
        onToggle={() => {
          // A new search leaves the page, and the focus mode over it.
          if (!filter.canFilter) closeFocus();
          filter.toggle({ value: id, name });
        }}
      >
        {name}
      </FilterName>
    </TopicHoverCard>
  );
}
