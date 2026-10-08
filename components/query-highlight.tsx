"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode, type Ref, type SyntheticEvent } from "react";
import { cn } from "@/lib/utils";
import {
  highlightSegments,
  parseBooleanQuery,
  queryMatcher,
  type QueryMatcher,
  type QueryToken,
} from "@/lib/search/boolean-query";
import { useKeywordExpansionStore } from "@/lib/store";
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
export function QueryText({ query }: { query: string }) {
  const { tokens, conceptCount } = useMemo(() => parseBooleanQuery(query), [query]);
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

/**
 * A copy of the query drawn behind a transparent input or textarea, so the field shows the
 * highlighting while the browser still owns typing, the caret and selection. Give it the same
 * font size, line height and padding as the field.
 */
export function QueryMirror({ query, className, ref }: { query: string; className?: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden text-foreground", className)}>
      <QueryText query={query} />
      {/* Keeps a trailing line break as tall as the textarea draws it. */}
      {"​"}
    </div>
  );
}

/** Keeps a {@link QueryMirror} scrolled with its field. */
export function useMirrorScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const sync = (event: SyntheticEvent<HTMLElement>) => {
    if (!ref.current) return;
    ref.current.scrollTop = event.currentTarget.scrollTop;
    ref.current.scrollLeft = event.currentTarget.scrollLeft;
  };
  return { ref, sync };
}

/** What a field with a mirror behind it needs: hidden text, a visible caret and selection. */
export const MIRRORED_FIELD = "relative text-transparent caret-foreground selection:bg-primary/25";

// ---------- The results ----------

const QueryMatchContext = createContext<QueryMatcher | null>(null);

/** Gives the result cards inside it the searched query to highlight. OQL queries highlight nothing. */
export function QueryMatchProvider({ query, field, children }: { query: string; field: string; children: ReactNode }) {
  const expandQuery = useKeywordExpansionStore((state) => state.expandQuery);
  const matcher = useMemo(
    () => (field === OQL_FIELD || !query.trim() ? null : queryMatcher(expandQuery(query).expandedQuery)),
    [query, field, expandQuery],
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
