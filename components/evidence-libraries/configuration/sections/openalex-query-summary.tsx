"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { FilterChips } from "@/components/ui/filter-display";
import { QueryText } from "@/components/ui/query-text";
import { getFieldLabel, type FilterT } from "@/lib/filters";
import { paramsToSearchResult } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import type { OpenAlexSourceEntry } from "@/lib/evidence-libraries/configuration/sources";
import { readOpenAlexSourceSearch } from "@/lib/evidence-libraries/openalex-source-query";
import { DisclosureButton } from "../disclosure-button";

/** The query cut to three lines, with the full text on request. */
function QueryLine({ query, scope }: { query: string; scope: string | null }) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const queryId = useId();
  const queryRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);

  // ResizeObserver: whether the collapsed query is cut off at the row's current width.
  useEffect(() => {
    const node = queryRef.current;
    if (!node || expanded) return;
    const observer = new ResizeObserver(() => setClipped(node.scrollHeight > node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex min-w-0 items-start gap-2">
        <Search className="mt-[0.2em] size-3.5 shrink-0" aria-hidden />
        <span
          ref={queryRef}
          id={queryId}
          className={cn("min-w-0", expanded ? "max-h-72 overflow-y-auto pr-2" : "line-clamp-3")}
        >
          <QueryText query={query} className="break-words font-medium [overflow-wrap:anywhere]" />
        </span>
      </span>
      {scope ? <span>{scope}</span> : null}
      {/* Sits on the scope's line, so it takes no height of its own. */}
      {expanded || clipped ? (
        <DisclosureButton
          aria-expanded={expanded}
          aria-controls={queryId}
          className="-my-1 ml-0 h-6"
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? "showLessQuery" : "showFullQuery")}
        </DisclosureButton>
      ) : null}
    </div>
  );
}

export function OpenAlexQuerySummary({ source }: { source: OpenAlexSourceEntry }) {
  const params = readOpenAlexSourceSearch(source);
  const t = useTranslations("searchFilters") as FilterT;

  return (
    <div className="space-y-2.5">
      {/* Keyed by the query, so an edited query starts collapsed. */}
      <QueryLine key={params.q} query={params.q} scope={params.q ? getFieldLabel(params.field, t) : null} />
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
