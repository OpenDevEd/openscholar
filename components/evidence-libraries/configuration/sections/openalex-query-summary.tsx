"use client";

import {
  CalendarRange,
  FileText,
  Globe2,
  LockOpen,
  Network,
  Search,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { QueryText } from "@/components/ui/query-text";
import { COUNTRIES } from "@/lib/constants";
import type { OpenAlexQuery } from "@/lib/evidence-libraries/configuration/sources";
import {
  OPENALEX_SDGS,
  OPENALEX_WORK_TYPES,
  parseOpenAlexSourceQuery,
} from "@/lib/evidence-libraries/openalex-source-query";
import { useSourceTopicNames } from "./use-source-topic-names";
import { SEARCH_FIELDS } from "@/lib/types";

export function OpenAlexQuerySummary({ query }: { query: OpenAlexQuery }) {
  const parsed = parseOpenAlexSourceQuery(query);
  const topicNames = useSourceTopicNames(parsed.topicLevel, parsed.topicIds);
  const scope =
    parsed.scope === "all"
      ? "All fields"
      : (SEARCH_FIELDS.find((field) => field.value === parsed.scope)?.label ??
        parsed.scope);
  const items = [
    ...(parsed.yearRange
      ? [
          {
            key: "years",
            icon: CalendarRange,
            label: "Years",
            value: `${parsed.yearRange[0]}–${parsed.yearRange[1]}`,
          },
        ]
      : []),
    ...parsed.locations.map((id) => ({
      key: `country-${id}`,
      icon: Globe2,
      label: "Author location",
      value: COUNTRIES[id] ?? id,
    })),
    ...parsed.types.map((id) => ({
      key: `type-${id}`,
      icon: FileText,
      label: "Type",
      value: OPENALEX_WORK_TYPES.find((type) => type.id === id)?.name ?? id,
    })),
    ...parsed.topicIds.map((id) => ({
      key: `topic-${id}`,
      icon: Network,
      label:
        parsed.topicLevel === "topic"
          ? "Topic"
          : parsed.topicLevel === "subfield"
            ? "Subfield"
            : "Field",
      value: topicNames[id] ?? id,
    })),
    ...parsed.sdgs.map((id) => ({
      key: `sdg-${id}`,
      icon: Target,
      label: `SDG ${id}`,
      value:
        OPENALEX_SDGS.find((goal) => goal.id === id)?.name.replace(
          /^\d+\. /,
          "",
        ) ?? id,
    })),
    ...(parsed.openAccessOnly
      ? [
          {
            key: "open-access",
            icon: LockOpen,
            label: "Open access only",
            value: "Open access only",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-2.5">
      {parsed.search ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <QueryText
            query={parsed.search}
            className="min-w-0 break-words font-medium [overflow-wrap:anywhere]"
          />
          <span className="text-muted-foreground">{scope}</span>
        </div>
      ) : null}
      {items.length ? (
        <ul aria-label="Search filters" className="flex flex-wrap gap-1.5">
          {items.map(({ key, icon: Icon, label, value }) => (
            <li key={key} className="min-w-0 max-w-full">
              <Badge
                variant="secondary"
                className="max-w-full items-start gap-1.5 whitespace-normal rounded-md py-1 font-normal"
              >
                <Icon
                  className="mt-0.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {label !== value ? (
                    <span className="text-muted-foreground">{label} </span>
                  ) : null}
                  {value}
                </span>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
