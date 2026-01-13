import { cn } from "@/lib/utils";

interface QueryTextProps {
  query?: string | null;
  className?: string;
}

export function QueryText({ query, className }: QueryTextProps) {
  // Treat empty strings, null, undefined as "no query"
  if (!query || query.trim().length === 0) {
    return (
      <span className={cn("text-muted-foreground italic", className)}>
        No query
      </span>
    );
  }

  return <span className={cn("text-foreground", className)}>{query}</span>;
}
