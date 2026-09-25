"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { FilterChips } from "@/components/ui/filter-display";
import { QueryText } from "@/components/ui/query-text";
import { getFieldLabel, type FilterT } from "@/lib/filters";
import { paramsToSearchResult } from "@/lib/search-params";
import type { OpenAlexSourceEntry } from "@/lib/evidence-libraries/configuration/sources";
import { readOpenAlexSourceSearch } from "@/lib/evidence-libraries/openalex-source-query";

export function OpenAlexQuerySummary({ source }: { source: OpenAlexSourceEntry }) {
  const params = readOpenAlexSourceSearch(source);
  const t = useTranslations("searchFilters") as FilterT;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <QueryText query={params.q} className="min-w-0 break-words font-medium [overflow-wrap:anywhere]" />
        {params.q ? <span>{getFieldLabel(params.field, t)}</span> : null}
      </div>
      {/* The scope sits beside the query; sort and ratings do not change what is imported. */}
      <FilterChips
        filters={{
          ...paramsToSearchResult(params),
          field: undefined,
          sortBy: undefined,
          ratingRange: undefined,
          onlyRatedPapers: undefined,
        }}
      />
    </div>
  );
}
