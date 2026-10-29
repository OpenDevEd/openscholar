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
import { useOptionalAuthQuery, useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { useResearchPhase, useResearchScope } from "@/lib/research/reads";
import { localSearchHistoryStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useWorkspaceScope } from "@/lib/workspaces/url";

/** Mock: generations a day per plan. The real numbers are an Autumn plan limit (`suggestions_per_day`), enforced in Convex with a token bucket. */
const MOCK_PER_DAY: Record<string, number> = { free: 5, free_organization: 5, go: 20, pro: 50, team: 50 };

type Stored = { searches: string[]; suggestions: SearchSuggestion[]; day: string; count: number };
const today = () => new Date().toDateString();
// ponytail: mock store in this browser, per workspace and person; the real version stores the set in Convex.
function readStored(key: string): Stored | undefined {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

const generating = new Map<string, Promise<SearchSuggestion[]>>();
/** One generation per set of searches; it saves the set and counts it against today's limit. */
const generationId = (key: string, searches: string[], language: string) => JSON.stringify([key, language, searches]);
function generate(key: string, searches: string[], language: string) {
  const id = generationId(key, searches, language);
  let promise = generating.get(id);
  if (!promise) {
    // Started after this render: a server action updates the router, which React refuses mid-render.
    promise = new Promise<void>((resolve) => queueMicrotask(resolve))
      .then(() => suggestSearches(searches, language))
      .then((suggestions) => {
        const before = readStored(key);
        localStorage.setItem(key, JSON.stringify({ searches, suggestions, day: today(), count: before?.day === today() ? before.count + 1 : 1 } satisfies Stored));
        return suggestions;
      })
      .catch((error) => {
        console.error("Search suggestions failed:", error);
        // The next visit tries again; until then the last set stays.
        generating.delete(id);
        return readStored(key)?.suggestions ?? [];
      });
    generating.set(id, promise);
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
 * Research questions written from the person's own recent searches in this workspace. The last set
 * shows at once; a new one is written when the searches have changed and the plan's daily number
 * isn't used up, with the last set dimmed meanwhile. Signed out there's no workspace, so none.
 */
export function SuggestedSearches({ searches, onPick, working, disabled }: { searches: string[] | undefined; onPick: (question: string) => void; working: boolean; disabled: boolean }) {
  const scope = useResearchScope();
  const language = localeToLanguageCode(useLocale());
  const { data: account } = useProtectedQuery(api.billing.accounts.mine, useWorkspaceScope());
  if (!scope || searches?.length === 0) return null;
  const key = `home-suggestions:${scope.workspaceId}:${scope.accountId}`;
  const stored = readStored(key);
  const perDay = account === undefined ? undefined : (MOCK_PER_DAY[account?.plan ?? "free"] ?? MOCK_PER_DAY.free);
  const used = stored?.day === today() ? stored.count : 0;
  const changed = searches !== undefined && JSON.stringify(stored?.searches) !== JSON.stringify(searches);
  const list = (suggestions: SearchSuggestion[], dimmed = false) => <Suggestions suggestions={suggestions} dimmed={dimmed} onPick={onPick} working={working} disabled={disabled} />;
  // A generation this visit started stays the list's source, so the list isn't remounted once the set is stored.
  const started = searches && generating.get(generationId(key, searches, language));
  if (searches && (started || (changed && perDay !== undefined && used < perDay))) {
    return (
      <Suspense fallback={stored ? list(stored.suggestions, true) : null}>
        <Generated promise={started || generate(key, searches, language)} render={list} />
      </Suspense>
    );
  }
  return stored ? list(stored.suggestions) : null;
}

function Generated({ promise, render }: { promise: Promise<SearchSuggestion[]>; render: (suggestions: SearchSuggestion[]) => React.ReactNode }) {
  return render(use(promise));
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
