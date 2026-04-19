"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import type { SortDir, SortField } from "@/lib/chat/sort/source-comparators";
import { cn } from "@/lib/utils";

const SORT_FIELDS: ReadonlyArray<SortField> = [
  "added",
  "title",
  "year",
  "source",
  "inContext",
];

interface SourcesPanelToolbarProps {
  jobId: Id<"extractionJobs">;
  visibleRows: ChatSourceRow[];
  query: string;
  onQueryChange: (next: string) => void;
  sort: SortField;
  dir: SortDir;
  onSortChange: (next: SortField, nextDir: SortDir) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function SourcesPanelToolbar({
  jobId,
  visibleRows,
  query,
  onQueryChange,
  sort,
  dir,
  onSortChange,
  searchInputRef,
}: SourcesPanelToolbarProps) {
  const t = useTranslations("sourcesPanel");
  const reduceMotion = useReducedMotion();

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

  function handleSortPillClick(field: SortField) {
    if (field === sort) {
      onSortChange(field, dir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(field, defaultDir(field));
    }
  }

  async function bulkApply(
    nextIncluded: boolean | "invert",
    successKey: "include" | "exclude" | "invert",
  ) {
    const visibleSourceIds = visibleRows.map((r) => r.sourceId);
    const prevState = visibleRows.map((r) => ({
      sourceId: r.sourceId,
      included: r.included,
    }));

    try {
      if (nextIncluded === "invert") {
        const wasIncluded = visibleRows
          .filter((r) => r.included)
          .map((r) => r.sourceId);
        const wasExcluded = visibleRows
          .filter((r) => !r.included)
          .map((r) => r.sourceId);
        if (wasIncluded.length) {
          await bulkSetChatPapers({
            jobId,
            sourceIds: wasIncluded,
            included: false,
          });
        }
        if (wasExcluded.length) {
          await bulkSetChatPapers({
            jobId,
            sourceIds: wasExcluded,
            included: true,
          });
        }
      } else {
        await bulkSetChatPapers({
          jobId,
          sourceIds: visibleSourceIds,
          included: nextIncluded,
        });
      }

      toast(t(`bulk.success.${successKey}`, { count: visibleSourceIds.length }), {
        duration: 5000,
        action: {
          label: t("bulk.undo"),
          onClick: async () => {
            const wasIncluded = prevState
              .filter((p) => p.included)
              .map((p) => p.sourceId);
            const wasExcluded = prevState
              .filter((p) => !p.included)
              .map((p) => p.sourceId);
            if (wasIncluded.length) {
              await bulkSetChatPapers({
                jobId,
                sourceIds: wasIncluded,
                included: true,
              });
            }
            if (wasExcluded.length) {
              await bulkSetChatPapers({
                jobId,
                sourceIds: wasExcluded,
                included: false,
              });
            }
          },
        },
      });
    } catch {
      toast.error(t("bulk.error", { action: successKey }));
    }
  }

  return (
    <div
      className="flex flex-col gap-2 border-b border-border/50 px-4 py-3"
      data-sources-panel-toolbar
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          data-sources-panel-search
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("sort.groupLabel")}>
        {SORT_FIELDS.map((field) => {
          const active = field === sort;
          return (
            <Button
              key={field}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-7 px-2 text-[11px]")}
              data-sort-pill={field}
              data-active={active ? "true" : undefined}
              data-dir={active ? dir : undefined}
              aria-pressed={active}
              onClick={() => handleSortPillClick(field)}
            >
              {t(`sort.${field}`)}
              {active ? (
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    key={dir}
                    aria-hidden
                    className="ml-1 inline-block"
                    data-sort-glyph={dir}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.12, ease: "easeOut" }
                    }
                  >
                    {dir === "asc" ? "\u2191" : "\u2193"}
                  </motion.span>
                </AnimatePresence>
              ) : null}
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("bulk.groupLabel")}>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          data-bulk-action="include"
          disabled={visibleRows.length === 0}
          onClick={() => bulkApply(true, "include")}
        >
          {t("bulk.include")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          data-bulk-action="exclude"
          disabled={visibleRows.length === 0}
          onClick={() => bulkApply(false, "exclude")}
        >
          {t("bulk.exclude")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          data-bulk-action="invert"
          disabled={visibleRows.length === 0}
          onClick={() => bulkApply("invert", "invert")}
        >
          {t("bulk.invert")}
        </Button>
      </div>
    </div>
  );
}

function defaultDir(field: SortField): SortDir {
  // year and inContext default to "newest first" / "included first" when
  // the user first picks the pill; everything else starts ascending.
  if (field === "year" || field === "inContext") return "desc";
  return "asc";
}
