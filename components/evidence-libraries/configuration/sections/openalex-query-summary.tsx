"use client";

import { Filter, Network, Search, Target, Unlock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { QueryText } from "@/components/ui/query-text";
import { COUNTRIES } from "@/lib/constants";
import { getAllFilterItems, getFieldLabel, type FilterT } from "@/lib/filters";
import { paramsToFilters } from "@/lib/search-params";
import { SDGS, TOPIC_LEVEL_LABELS } from "./openalex-import-model";
import { topicLevelOf } from "@/lib/evidence-libraries/openalex-import-request";

import type { OpenAlexSourceEntry } from "@/lib/evidence-libraries/configuration/sources";
import { readOpenAlexSourceSearch } from "@/lib/evidence-libraries/openalex-source-query";
import { useSourceTopicNames } from "./use-source-topic-names";

export function OpenAlexQuerySummary({ source }: { source: OpenAlexSourceEntry }) {
  const { params, extras } = readOpenAlexSourceSearch(source);
  const topicNames = useSourceTopicNames(extras.topicIds);
  const t = useTranslations("searchFilters") as FilterT;
  const format = useFormatter();
  const filters = getAllFilterItems(
    { ...paramsToFilters(params), sortBy: undefined },
    t,
    (date, options) => format.dateTime(date, options as Parameters<typeof format.dateTime>[1]),
  ).map((item) => ({
    ...item,
    displayValue:
      item.type === "regions" || item.type === "countryFocus"
        ? (item.type === "regions" ? params.reg : params.focus)
            .map((id) => COUNTRIES[id] ?? id)
            .join(", ")
        : item.displayValue,
  }));
  const items = [
    ...filters,
    ...Object.entries(extras.additionalFilters ?? {}).map(([key, displayValue]) => ({key, displayValue, label: key, icon: Filter})),
    ...extras.topicIds.map((id) => ({
      key: `topic-${id}`,
      icon: Network,
      label: TOPIC_LEVEL_LABELS[topicLevelOf(id)],
      displayValue: topicNames[id] ?? id,
    })),
    ...extras.sdgs.map((id) => ({
      key: `sdg-${id}`,
      icon: Target,
      label: `SDG ${id}`,
      displayValue: SDGS.find((goal) => goal.id === id)?.name.replace(/^\d+\. /, "") ?? id,
    })),
    ...(extras.openAccessOnly
      ? [{ key: "open-access", icon: Unlock, label: "Open access only", displayValue: "Open access only" }]
      : []),
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <QueryText query={params.q} className="min-w-0 break-words font-medium [overflow-wrap:anywhere]" />
        {params.q ? <span>{getFieldLabel(params.field, t)}</span> : null}
      </div>
      {items.length ? (
        <ul aria-label="Search filters" className="flex flex-wrap gap-1.5">
          {items.map(({ key, icon: Icon, label, displayValue }) => (
            <li key={key} className="min-w-0 max-w-full">
              <Badge variant="secondary" className="max-w-full items-start gap-1.5 whitespace-normal rounded-md py-1 font-normal">
                <Icon className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {label !== displayValue ? <span className="text-muted-foreground">{label} </span> : null}
                  {displayValue}
                </span>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
