"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { OptionPicker } from "@/components/shared/option-picker";
import { topicLevelOf, type TopicLevel } from "@/lib/openalex/vocabulary";
import { searchTopicCatalog, topicName } from "@/lib/topics/search";

const GROUP_KEYS: Record<TopicLevel, string> = {
  domain: "researchAreaDomains",
  field: "researchAreaFields",
  subfield: "researchAreaSubfields",
  topic: "researchAreaTopics",
};

/** Research areas of every level from our topic catalog. */
export function ResearchAreaFilter({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const tf = useTranslations("searchFilters");
  const [search, setSearch] = useState("");
  const options = searchTopicCatalog(search);
  const names = Object.fromEntries(selected.map((id) => [id, topicName(id) ?? id]));
  const mixedLevels = new Set(selected.map(topicLevelOf)).size > 1;

  return (
    <div className="space-y-2">
      <OptionPicker
        label={tf("researchAreas")}
        placeholder={tf("anyResearchArea")}
        selectedText={tf("nSelected", { count: selected.length })}
        searchPlaceholder={tf("searchResearchAreas")}
        emptyText={tf("nothingFound")}
        removeLabel={(name) => tf("removeChoice", { name })}
        options={options.map((option) => ({
          id: option.id,
          name: option.name,
          group: tf(GROUP_KEYS[option.level] as never),
          detail: option.path.join(" / "),
        }))}
        selected={selected}
        names={names}
        onSearch={setSearch}
        onToggle={(id) =>
          onChange(selected.includes(id) ? selected.filter((one) => one !== id) : [...selected, id])
        }
      />
      {mixedLevels ? (
        <p className="text-xs text-muted-foreground">{tf("researchAreasMixedLevels")}</p>
      ) : null}
    </div>
  );
}
