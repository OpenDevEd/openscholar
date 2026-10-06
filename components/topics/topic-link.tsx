"use client";

import { useContext } from "react";
import { useTranslations } from "next-intl";
import { TopicHoverCard } from "@/components/entity-cards";
import { FocusModeClose } from "@/components/focus-mode/close-context";
import { useTopicFilter } from "@/components/paper-card/hooks";
import { FilterName } from "@/components/paper-card/shared";
import { useUIStore } from "@/lib/store";

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
  // In focus mode, a new search closes it, whichever focus mode it is.
  const closeFocus = useContext(FocusModeClose);
  const id = topic.id.replace(/^https?:\/\/openalex\.org\//, "");
  const name = topic.display_name;
  return (
    <TopicHoverCard id={id} name={name}>
      <FilterName
        pressed={filter.selected.includes(id)}
        label={t("filterByTopic", { name })}
        className={className}
        onToggle={() => {
          if (!filter.canFilter) (closeFocus ?? (() => useUIStore.getState().setIsFocusModeOpen(false)))();
          filter.toggle({ value: id, name });
        }}
      >
        {name}
      </FilterName>
    </TopicHoverCard>
  );
}
