"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  highlightSegments,
  parseBooleanQuery,
  QUERY_HIGHLIGHT_COOKIE,
  queryMatcher,
  type QueryMatcher,
  type QueryToken,
} from "@/lib/search/boolean-query";
import { shortcutExpansions, useKeywordExpansionStore } from "@/lib/store";
import { OQL_FIELD } from "@/lib/openalex/oql";

/** One colour per concept, the same in the query box and in the results. */
const CONCEPT_STYLES = [
  { ink: "ink-amber-500", mark: "bg-amber-400/30", layer: "bg-amber-500/10" },
  { ink: "ink-sky-500", mark: "bg-sky-400/25", layer: "bg-sky-500/10" },
  { ink: "ink-violet-500", mark: "bg-violet-400/25", layer: "bg-violet-500/10" },
  { ink: "ink-emerald-500", mark: "bg-emerald-400/25", layer: "bg-emerald-500/10" },
  { ink: "ink-pink-500", mark: "bg-pink-400/25", layer: "bg-pink-500/10" },
  { ink: "ink-teal-500", mark: "bg-teal-400/25", layer: "bg-teal-500/10" },
] as const;

const conceptStyle = (concept: number) => CONCEPT_STYLES[concept % CONCEPT_STYLES.length];

/** The person's saved shortcuts by name. They load after the page, so colours follow once they arrive. */
function useShortcutExpansions() {
  const keywords = useKeywordExpansionStore((state) => state.keywords);
  return useMemo(() => shortcutExpansions(keywords), [keywords]);
}

// ---------- On or off ----------

const QueryHighlightContext = createContext<{ on: boolean; setOn: (on: boolean) => void }>({ on: true, setOn: () => {} });

/** Whether queries and results are highlighted. Off is kept in a cookie, so it holds signed in or out. */
export function QueryHighlightProvider({ initial, children }: { initial: boolean; children: ReactNode }) {
  const [on, setOnState] = useState(initial);
  const value = useMemo(
    () => ({
      on,
      setOn: (next: boolean) => {
        setOnState(next);
        document.cookie = `${QUERY_HIGHLIGHT_COOKIE}=${next ? "on" : "off"}; Path=/; Max-Age=31536000; SameSite=Lax`;
      },
    }),
    [on],
  );
  return <QueryHighlightContext.Provider value={value}>{children}</QueryHighlightContext.Provider>;
}

export const useQueryHighlight = () => useContext(QueryHighlightContext);

// ---------- The query ----------

function tokenClass(token: QueryToken, coloured: boolean): string | undefined {
  switch (token.kind) {
    case "and":
    case "or":
      return "text-muted-foreground";
    case "not":
      return "ink-destructive";
    case "open":
    case "close":
      if (token.unmatched) return "ink-destructive underline decoration-wavy decoration-destructive/70";
      if (token.excluded) return "ink-destructive";
      return token.concept !== undefined && coloured ? conceptStyle(token.concept).ink : "text-muted-foreground";
    case "term":
    case "phrase":
      if (token.excluded) return "ink-destructive line-through decoration-destructive/50";
      return token.concept !== undefined && coloured ? conceptStyle(token.concept).ink : undefined;
    case "space":
      return undefined;
  }
}

/**
 * The query with its logic drawn in: each concept in its colour, operators muted, NOT and what
 * it excludes in red, and each parenthesised group as a tinted layer over the groups around it.
 * Only colours and backgrounds change, so the text keeps the exact width of the field it mirrors.
 */
export function HighlightedQuery({ query }: { query: string }) {
  const expansions = useShortcutExpansions();
  const { tokens, conceptCount } = useMemo(() => parseBooleanQuery(query, expansions), [query, expansions]);
  const { on } = useQueryHighlight();
  if (!on) return <>{query}</>;
  // A plain keyword query is one concept: it stays in the normal text colour.
  const coloured = conceptCount > 1;

  // Each "(" opens a layer that its ")" closes; an unclosed one runs to the end.
  const root: ReactNode[] = [];
  const stack: { token: QueryToken; children: ReactNode[] }[] = [];
  let groups = 0;
  const close = () => {
    const group = stack.pop()!;
    const layer = group.token.excluded
      ? "bg-destructive/[0.07]"
      : group.token.concept !== undefined && coloured
        ? conceptStyle(group.token.concept).layer
        : "bg-foreground/[0.05]";
    (stack.at(-1)?.children ?? root).push(
      <span key={`group-${groups++}`} className={cn("rounded-sm box-decoration-clone", layer)}>
        {group.children}
      </span>,
    );
  };
  tokens.forEach((token, index) => {
    const node = (
      <span key={index} className={tokenClass(token, coloured)}>
        {token.text}
      </span>
    );
    if (token.kind === "open" && !token.unmatched) {
      stack.push({ token, children: [node] });
      return;
    }
    (stack.at(-1)?.children ?? root).push(node);
    if (token.kind === "close" && !token.unmatched && stack.length > 0) close();
  });
  while (stack.length > 0) close();
  return <>{root}</>;
}

/** The render function rich-textarea fields take: the query with its logic drawn in, or as typed. */
export function queryRenderer(highlight: boolean) {
  return highlight ? (value: string) => <HighlightedQuery query={value} /> : (value: string) => value;
}

// Tailwind's sm and md: the home box's text size changes at both.
const BREAKPOINTS = ["(min-width: 40rem)", "(min-width: 48rem)"];

/** Listens to the browser's media queries for the breakpoints. */
function subscribeToBreakpoints(onChange: () => void) {
  const queries = BREAKPOINTS.map((query) => window.matchMedia(query));
  queries.forEach((query) => query.addEventListener("change", onChange));
  return () => queries.forEach((query) => query.removeEventListener("change", onChange));
}

const breakpointsMet = () => BREAKPOINTS.filter((query) => window.matchMedia(query).matches).length;

/**
 * The style a rich-textarea query field takes. rich-textarea copies the field's font and padding
 * only when this object changes, so a new one comes at each breakpoint; the caret colour is set
 * because it otherwise keeps the first one it sees, whatever the theme.
 */
export function useQueryFieldStyle() {
  const breakpoint = useSyncExternalStore(subscribeToBreakpoints, breakpointsMet, () => 0);
  return useMemo(() => ({ width: "100%", caretColor: "var(--foreground)", "--breakpoint": breakpoint }), [breakpoint]);
}

// ---------- The results ----------

const QueryMatchContext = createContext<QueryMatcher | null>(null);

/** Gives the result cards inside it the searched query to highlight. OQL queries highlight nothing. */
export function QueryMatchProvider({ query, field, children }: { query: string; field: string; children: ReactNode }) {
  const expansions = useShortcutExpansions();
  const { on } = useQueryHighlight();
  const matcher = useMemo(
    () => (!on || field === OQL_FIELD || !query.trim() ? null : queryMatcher(query, expansions)),
    [on, query, field, expansions],
  );
  return <QueryMatchContext.Provider value={matcher}>{children}</QueryMatchContext.Provider>;
}

/** Result text with each match marked in the colour of the concept it matched. */
export function QueryMatchText({ text }: { text: string | undefined }) {
  const matcher = useContext(QueryMatchContext);
  const segments = useMemo(() => highlightSegments(text ?? "", matcher), [text, matcher]);
  if (!matcher) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.concept === undefined ? (
          segment.text
        ) : (
          <mark key={index} className={cn("rounded-sm text-inherit box-decoration-clone", conceptStyle(segment.concept).mark)}>
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
}
