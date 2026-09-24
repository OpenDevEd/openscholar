"use client";

import { Filter, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OpenAlexQuery } from "@/lib/evidence-libraries/configuration/sources";

export function OpenAlexQuerySummary({ query }: { query: OpenAlexQuery }) {
  const items = [
    ...(query.search
      ? [{ key: "search", icon: Search, value: query.search }]
      : []),
    ...(query.filter
      ? [{ key: "filter", icon: Filter, value: query.filter }]
      : []),
  ];
  return (
    <ul aria-label="Search criteria" className="flex flex-wrap gap-1.5">
      {items.map(({ key, icon: Icon, value }) => (
        <li key={key} className="min-w-0 max-w-full">
          <Badge
            variant="secondary"
            className="max-w-full items-start gap-1.5 whitespace-normal rounded-md py-1 font-normal"
          >
            <Icon
              className="mt-0.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
