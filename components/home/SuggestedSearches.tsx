"use client";

import { Suspense, use, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useLocale } from "next-intl";
import { useStore } from "zustand";
import { api } from "@/convex/_generated/api";
import { suggestSearches, type SearchSuggestion } from "@/app/actions/search-suggestions";
import { AiIcon, ArrowRight, History } from "@/components/icons";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/settings/model-map";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { useResearchPhase, useResearchScope } from "@/lib/research/reads";
import { localSearchHistoryStore } from "@/lib/store";

// ponytail: mock cache, one generation per workspace and set of searches for the tab's life; the real version stores them in Convex.
const generated = new Map<string, Promise<SearchSuggestion[]>>();
function suggestionsFor(workspaceId: string, searches: string[], language: string) {
  const key = JSON.stringify([workspaceId, language, searches]);
  let promise = generated.get(key);
  if (!promise) {
    // Started after this render: a server action updates the router, which React refuses mid-render.
    promise = new Promise<void>((resolve) => queueMicrotask(resolve)).then(() => suggestSearches(searches, language)).catch((error) => {
      console.error("Search suggestions failed:", error);
      // The next visit tries again.
      generated.delete(key);
      return [];
    });
    generated.set(key, promise);
  }
  return promise;
}

/**
 * The texts of the person's own latest searches, newest first: the account's in this workspace
 * signed in, this browser's signed out. Undefined until they're read.
 */
export function useMySearches(): string[] | undefined {
  const phase = useResearchPhase();
  const scope = useResearchScope();
  const { data: me } = useOptionalAuthQuery(api.users.queries.me, {});
  const recent = useCursorPage(api.research.records.listedSearches, me && scope ? { ...scope, sort: "recent", by: me._id } : "skip", 10);
  const local = useStore(localSearchHistoryStore, (state) => state.searchHistory);
  if (phase === "anonymous") return local.map((search) => search.latestQuestion || search.query).filter(Boolean);
  if (!scope || recent.isLoading) return undefined;
  return recent.items.map((search) => search.latestQuestion || search.query).filter(Boolean);
}

/**
 * Research questions written from the person's own recent searches in this workspace. The page
 * slides its frame open when they arrive and the rows fade in. Signed out there's no workspace, so none.
 */
export function SuggestedSearches({ searches, onPick, working, disabled }: { searches: string[] | undefined; onPick: (question: string) => void; working: boolean; disabled: boolean }) {
  const scope = useResearchScope();
  const language = localeToLanguageCode(useLocale());
  if (!scope || !searches?.length) return null;
  return (
    <Suspense fallback={null}>
      <Suggestions promise={suggestionsFor(scope.workspaceId, searches, language)} onPick={onPick} working={working} disabled={disabled} />
    </Suspense>
  );
}

function Suggestions({ promise, onPick, working, disabled }: { promise: Promise<SearchSuggestion[]>; onPick: (question: string) => void; working: boolean; disabled: boolean }) {
  const suggestions = use(promise);
  const reduceMotion = useReducedMotion();
  const [picked, setPicked] = useState<string>();
  return (
    <ul className="flex flex-col gap-0.5 pt-5">
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
              <span className="text-sm font-medium text-foreground text-balance">{suggestion.question}</span>
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
