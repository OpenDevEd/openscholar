"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { HighlightedQuery } from "@/components/query-highlight";

interface QueryTextProps {
  query?: string | null;
  className?: string;
  /** An OpenAlex Query Language query, shown as written: its syntax isn't the boolean search's. */
  oql?: boolean;
}

export function QueryText({ query, className, oql = false }: QueryTextProps) {
  const tc = useTranslations("common");
  // Treat empty strings, null, undefined as "no query"
  if (!query || query.trim().length === 0) {
    return (
      <span className={cn("text-muted-foreground italic", className)}>
        {tc("noQuery")}
      </span>
    );
  }

  return <span className={cn("text-foreground", className)}>{oql ? query : <HighlightedQuery query={query} />}</span>;
}
