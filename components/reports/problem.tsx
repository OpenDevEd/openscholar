"use client";

import { useState, type ReactNode } from "react";
import { CircleX } from "@/components/icons";
import { AutoHeight } from "@/components/ui/auto-height";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";

/**
 * What just went wrong, said in the page beside what its author did, where they are looking, and not in a corner of
 * the screen. It opens its own room, so what's below it slides instead of jumping.
 */
export function Problem({ children, className }: { children: ReactNode; /** Its spacing, as padding: a margin would show while it is empty. */ className?: string }) {
  return (
    <AutoHeight>
      {children ? (
        <p role="alert" className={cn("flex items-start gap-2 text-sm text-destructive", className)}>
          <CircleX className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{children}</span>
        </p>
      ) : null}
    </AutoHeight>
  );
}

/**
 * One place's trouble: what it is, a way to say or clear it, and a handler for a failed request that keeps the
 * server's own words, or `otherwise` when it gave none. Given a `scope`, trouble belongs to the scope it was said
 * in: an answer that comes back after the page has moved to another report is never shown on that one.
 */
export function useProblem(scope = "") {
  const [said, set] = useState<{ words: string; scope: string } | null>(null);
  const say = (words: string | null) => set(words === null ? null : { words, scope });
  const failed = (otherwise: string) => (error: unknown) => say(getErrorMessage(error, otherwise));
  return { problem: said?.scope === scope ? said.words : null, say, failed };
}
