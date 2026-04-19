"use client";

import { useRef } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import type { SearchMatch } from "@/lib/chat/search/source-scorer";
import { cn } from "@/lib/utils";
import { SourceRow } from "./source-row";

interface SourcesPanelListProps {
  jobId: Id<"extractionJobs">;
  rows: ChatSourceRow[];
  matches: ReadonlyMap<string, SearchMatch>;
  query: string;
  activeDescendantId: string | null;
  emptyState: React.ReactNode;
}

/**
 * The Sources panel listbox surface.
 *
 * Implements the WAI-ARIA APG listbox pattern directly (not via the
 * <SelectableList> primitive) because that primitive's role="button" +
 * tabindex=0 outer wrapper raises an axe nested-interactive violation
 * once focusable descendants like Checkbox or anchors live inside the
 * row. Plan rule 8 still applies — we reuse SelectableList's *logic*
 * via the shift-click anchor + lib/chat/chat-papers-selection helpers
 * — but the JSX is built fresh so the semantic ownership stays
 * unambiguous (listbox owns selection, options carry aria-selected).
 *
 * - Container: role="listbox", aria-multiselectable, aria-activedescendant
 * - Each row: role="option" (id from <SourceRow>), no tabindex (single
 *   tab stop on the parent panel; keyboard nav lives in
 *   useSourcesPanelKeyboard).
 * - Visual checkmark is a span (aria-hidden) — selection truth is on
 *   the option's aria-selected. Clicking the row anywhere toggles.
 *   Inner OpenAlex/DOI links stay interactive without nested-interactive
 *   warnings because option is not in axe's interactive-roles list.
 */
export function SourcesPanelList({
  jobId,
  rows,
  matches,
  query,
  activeDescendantId,
  emptyState,
}: SourcesPanelListProps) {
  const t = useTranslations("sourcesPanel");
  const lastIndexRef = useRef<number | null>(null);

  const toggleChatPaper = useMutation(
    api.chat.chatPapers.toggleChatPaper,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      applyInclusionPatch(
        current,
        new Map([[args.chatPaperId, args.included]]),
      ),
    );
  });

  const bulkSetChatPapers = useMutation(
    api.chat.chatPapers.bulkSetChatPapers,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    const patch = buildBulkPatch(current, args.sourceIds, args.included);
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      applyInclusionPatch(current, patch),
    );
  });

  async function handleSingleToggle(row: ChatSourceRow) {
    try {
      await toggleChatPaper({
        chatPaperId: row.chatPaperId,
        included: !row.included,
      });
    } catch {
      toast.error(t("toggle.error"));
    }
  }

  async function handleRangeToggle(
    fromIndex: number,
    toIndex: number,
    targetIncluded: boolean,
  ) {
    const [from, to] =
      fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    const batch = rows
      .slice(from, to + 1)
      .filter((r) => r.included !== targetIncluded);
    if (batch.length === 0) return;
    try {
      await bulkSetChatPapers({
        jobId,
        sourceIds: batch.map((r) => r.sourceId),
        included: targetIncluded,
      });
    } catch {
      toast.error(
        t("bulk.error", { action: targetIncluded ? "include" : "exclude" }),
      );
    }
  }

  function handleRowActivate(index: number, shiftKey: boolean) {
    const current = rows[index];
    if (!current) return;
    const last = lastIndexRef.current;
    if (shiftKey && last !== null && last !== index) {
      void handleRangeToggle(last, index, !current.included);
    } else {
      void handleSingleToggle(current);
    }
    lastIndexRef.current = index;
  }

  if (rows.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div
      role="listbox"
      aria-multiselectable="true"
      aria-label={t("listLabel")}
      aria-activedescendant={activeDescendantId ?? undefined}
      data-sources-panel-list
      className="divide-y divide-border/40"
    >
      {rows.map((row, index) => {
        const selected = row.included;
        return (
          <div
            key={row.chatPaperId}
            // The actual role="option" + id + aria-selected lives on the
            // <SourceRow> inner. This outer is a non-interactive click
            // target so axe's nested-interactive rule stays clean.
            data-selectable-row
            data-paper-included={selected}
            data-paper-source={row.sourceType}
            data-chat-paper-id={row.chatPaperId}
            onClick={(e) => handleRowActivate(index, e.shiftKey)}
            className={cn(
              "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
              selected ? "bg-primary/5" : "hover:bg-muted/40",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background",
              )}
              data-checkbox-state={selected ? "checked" : "unchecked"}
            >
              {selected ? <CheckIcon className="size-3" /> : null}
            </span>
            <div className="flex-1 min-w-0">
              <SourceRow
                row={row}
                match={matches.get(row.chatPaperId)}
                query={query}
                isActiveDescendant={
                  `src-row-${row.chatPaperId}` === activeDescendantId
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
