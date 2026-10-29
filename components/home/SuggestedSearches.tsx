"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useStore } from "zustand";
import type { Infer } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { suggestionValidator } from "@/convex/research/suggestionValidators";
import { AiIcon, ArrowRight, History } from "@/components/icons";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/settings/model-map";
import { useOptionalAuthQuery, useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useResearchPhase, useResearchScope } from "@/lib/research/reads";
import { localSearchHistoryStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type SearchSuggestion = Infer<typeof suggestionValidator>;

/**
 * Whether the person has searched: in this workspace signed in, in this browser signed out.
 * Undefined until it's known.
 */
export function useHasSearched(): boolean | undefined {
  const phase = useResearchPhase();
  const scope = useResearchScope();
  const { data: me } = useOptionalAuthQuery(api.users.queries.me, {});
  const mine = useCursorPage(api.research.records.listedSearches, me && scope ? { ...scope, sort: "recent", by: me._id } : "skip", 1);
  const local = useStore(localSearchHistoryStore, (state) => state.searchHistory.length);
  if (phase === "anonymous") return local > 0;
  if (!scope || mine.isLoading) return undefined;
  return mine.items.length > 0;
}

/**
 * Research questions written from the person's own recent searches in this workspace (#964),
 * read as stored: the page slides its frame open when they arrive and the rows fade in. The
 * last set stays, dimmed, while a new one is written. Signed out there's no workspace, so none.
 */
export function SuggestedSearches({ onPick, working, disabled }: { onPick: (question: string) => void; working: boolean; disabled: boolean }) {
  const scope = useResearchScope();
  const { data } = useProtectedQuery(api.research.suggestions.mine, scope ?? "skip");
  if (!data?.suggestions.length) return null;
  return <Suggestions suggestions={data.suggestions} dimmed={data.refreshing} onPick={onPick} working={working} disabled={disabled} />;
}

function Suggestions({ suggestions, dimmed, onPick, working, disabled }: { suggestions: SearchSuggestion[]; dimmed: boolean; onPick: (question: string) => void; working: boolean; disabled: boolean }) {
  const reduceMotion = useReducedMotion();
  const [picked, setPicked] = useState<string>();
  return (
    // Last set, dimmed and inert while a new one is written.
    <ul inert={dimmed} aria-busy={dimmed} className={cn("flex flex-col gap-0.5 pt-5 transition-opacity duration-300", dimmed && "opacity-50")}>
      {suggestions.map((suggestion, index) => (
        <motion.li
          key={suggestion.question}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE, delay: index * 0.07 }}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setPicked(suggestion.question);
              onPick(suggestion.question);
            }}
            className="group flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
          >
            <AiIcon working={working && picked === suggestion.question} className="mt-0.5 size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground text-pretty">{suggestion.question}</span>
              <TooltipHint label={suggestion.from} onlyWhenClipped>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <History className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{suggestion.from}</span>
                </span>
              </TooltipHint>
            </span>
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
          </button>
        </motion.li>
      ))}
    </ul>
  );
}
