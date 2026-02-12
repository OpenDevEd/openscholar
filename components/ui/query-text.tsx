"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface QueryTextProps {
  query?: string | null;
  className?: string;
}

export function QueryText({ query, className }: QueryTextProps) {
  const tc = useTranslations("common");
  // Treat empty strings, null, undefined as "no query"
  if (!query || query.trim().length === 0) {
    return (
      <span className={cn("text-muted-foreground italic", className)}>
        {tc("noQuery")}
      </span>
    );
  }

  return <span className={cn("text-foreground", className)}>{query}</span>;
}
