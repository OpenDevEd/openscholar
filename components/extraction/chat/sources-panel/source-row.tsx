"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import { cn } from "@/lib/utils";
import { extractMatchSnippet } from "@/lib/chat/search/match-snippet";
import type { SearchMatch } from "@/lib/chat/search/source-scorer";
import {
  CHAT_SOURCE_COLOR_VAR,
  CHAT_SOURCE_ICON,
} from "@/lib/chat/source-presentation";

const SOURCE_LABEL: Record<ChatSourceRow["sourceType"], string> = {
  openalex: "OpenAlex",
  zotero: "Zotero",
  unknown: "Source",
};

interface SourceRowProps {
  row: ChatSourceRow;
  match?: SearchMatch;
  query?: string;
  isActiveDescendant?: boolean;
}

export function SourceRow({
  row,
  match,
  query = "",
  isActiveDescendant = false,
}: SourceRowProps) {
  const matchedNonChromeField =
    match &&
    (match.field === "abstract" ||
      match.field === "doi" ||
      match.field === "openalexId")
      ? match.field
      : null;

  const snippetSource =
    matchedNonChromeField === "abstract"
      ? row.abstract
      : matchedNonChromeField === "doi"
        ? row.doi
        : matchedNonChromeField === "openalexId"
          ? row.openalexId
          : null;

  const snippet =
    snippetSource && query.trim().length > 0
      ? extractMatchSnippet(snippetSource, query)
      : null;

  const authorLine = formatAuthorMeta(row);
  const SourceIcon = CHAT_SOURCE_ICON[row.sourceType];
  const sourceColorVar = CHAT_SOURCE_COLOR_VAR[row.sourceType];

  return (
    <div
      id={`src-row-${row.chatPaperId}`}
      role="option"
      aria-selected={row.included}
      aria-label={`${row.title} \u2014 ${row.included ? "included" : "excluded"}`}
      data-paper-included={row.included}
      data-paper-source={row.sourceType}
      data-chat-paper-id={row.chatPaperId}
      data-active-descendant={isActiveDescendant ? "true" : undefined}
      className={cn(
        "group flex w-full flex-col gap-0.5 text-sm",
        row.included
          ? "opacity-100"
          : "opacity-55 hover:opacity-100 focus-within:opacity-100",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
          {row.title}
        </p>
        <span
          title={SOURCE_LABEL[row.sourceType]}
          data-source-icon={row.sourceType}
          className="shrink-0 pt-0.5"
          style={{ color: `var(${sourceColorVar})` }}
        >
          <SourceIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{SOURCE_LABEL[row.sourceType]}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-muted-foreground">
          {authorLine}
        </p>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {row.openalexId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Open in OpenAlex"
              data-source-action="openalex"
              asChild
            >
              <a
                href={openAlexUrl(row.openalexId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="size-3" />
              </a>
            </Button>
          )}
          {row.doi && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Open DOI"
              data-source-action="doi"
              asChild
            >
              <a
                href={`https://doi.org/${row.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="size-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
      {snippet && matchedNonChromeField && (
        <p
          className="mt-0.5 text-[11px] italic text-muted-foreground"
          data-match-field={matchedNonChromeField}
        >
          <span className="mr-1 text-[10px] not-italic uppercase tracking-wide text-muted-foreground/70">
            {matchedNonChromeField}
          </span>
          <SnippetText
            text={snippet.text}
            highlightRanges={snippet.highlightRanges}
          />
        </p>
      )}
    </div>
  );
}

function SnippetText({
  text,
  highlightRanges,
}: {
  text: string;
  highlightRanges: ReadonlyArray<readonly [number, number]>;
}) {
  if (highlightRanges.length === 0) return <>{text}</>;
  const [start, end] = highlightRanges[0];
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded bg-primary/20 px-0.5 text-foreground">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

function formatAuthorMeta(row: ChatSourceRow): string {
  const firstAuthor = row.authors[0];
  const authorLabel = firstAuthor
    ? row.authors.length > 1
      ? `${firstAuthor} et al.`
      : firstAuthor
    : "Unknown author";
  return row.year !== null ? `${authorLabel} \u00B7 ${row.year}` : authorLabel;
}

function openAlexUrl(id: string): string {
  if (id.startsWith("http")) return id;
  return `https://openalex.org/${id}`;
}
