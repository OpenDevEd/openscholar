"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import { useIsMobile } from "@/lib/hooks";
import { SourcesPanelChips } from "./sources-panel-chips";
import { SourcesPanelExtensionBanner } from "./sources-panel-extension-banner";
import { SourcesPanelHeader } from "./sources-panel-header";
import { SourcesPanelList } from "./sources-panel-list";
import { SourcesPanelToolbar } from "./sources-panel-toolbar";
import { useSourcesPanelKeyboard } from "./use-sources-panel-keyboard";
import { useSourcesPanelState } from "./use-sources-panel-state";

interface SourcesPanelProps {
  jobId: Id<"extractionJobs">;
}

/**
 * Desktop rail orchestrator for the chat Sources panel. Composes header,
 * chips, toolbar (search + sort + bulk), extension banner, and list.
 *
 * Hidden on mobile; the mobile entry point is `SourcesPanelSheet` mounted
 * inside the chat header.
 */
export function SourcesPanel({ jobId }: SourcesPanelProps) {
  const isMobile = useIsMobile();
  if (isMobile) return null;
  return <SourcesPanelInner jobId={jobId} />;
}

export function SourcesPanelInner({ jobId }: SourcesPanelProps) {
  const t = useTranslations("sourcesPanel");
  const reduceMotion = useReducedMotion();
  const rawRows = useQuery(
    api.chat.chatPapers.listChatSourcesWithInclusion,
    { jobId },
  );
  const rows = rawRows ?? [];
  const {
    state,
    setState,
    visibleRows,
    matches,
    chipCounts,
    totalCount,
    includedCount,
  } = useSourcesPanelState(rows);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filterActive = state.q.trim().length > 0 || state.src !== "all";
  const allVisibleIncluded =
    visibleRows.length > 0 && visibleRows.every((r) => r.included);
  const showExtensionBanner =
    !bannerDismissed &&
    filterActive &&
    allVisibleIncluded &&
    visibleRows.length < totalCount;

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

  const keyboard = useSourcesPanelKeyboard({
    visibleRows,
    onToggleOne: async (row, next) => {
      try {
        await toggleChatPaper({ chatPaperId: row.chatPaperId, included: next });
      } catch {
        toast.error(t("toggle.error"));
      }
    },
    onToggleRange: async (rangeRows, next) => {
      try {
        await bulkSetChatPapers({
          jobId,
          sourceIds: rangeRows.map((r) => r.sourceId),
          included: next,
        });
      } catch {
        toast.error(t("bulk.error", { action: next ? "include" : "exclude" }));
      }
    },
    onIncludeAllVisible: async () => {
      try {
        await bulkSetChatPapers({
          jobId,
          sourceIds: visibleRows.map((r) => r.sourceId),
          included: true,
        });
      } catch {
        toast.error(t("bulk.error", { action: "include" }));
      }
    },
    onInvertVisible: async () => {
      const wasIncluded = visibleRows
        .filter((r) => r.included)
        .map((r) => r.sourceId);
      const wasExcluded = visibleRows
        .filter((r) => !r.included)
        .map((r) => r.sourceId);
      try {
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
      } catch {
        toast.error(t("bulk.error", { action: "invert" }));
      }
    },
    onClearSearch: () => setState({ q: "" }),
    hasSearchQuery: state.q.length > 0,
    searchInputRef,
  });

  return (
    <div
      className="flex h-full w-full flex-col bg-background"
      data-sources-panel
      data-job-id={jobId}
      data-motion-disabled={reduceMotion ? "true" : "false"}
      onKeyDown={keyboard.onKeyDown}
    >
      <SourcesPanelHeader
        totalCount={totalCount}
        includedCount={includedCount}
      />
      <SourcesPanelChips
        counts={chipCounts}
        selected={state.src}
        onSelect={(next) => setState({ src: next })}
      />
      <SourcesPanelToolbar
        jobId={jobId}
        visibleRows={visibleRows}
        query={state.q}
        onQueryChange={(next) => setState({ q: next })}
        sort={state.sort}
        dir={state.dir}
        onSortChange={(sort, dir) => setState({ sort, dir })}
        searchInputRef={searchInputRef}
      />
      <SourcesPanelExtensionBanner
        jobId={jobId}
        visibleCount={visibleRows.length}
        totalCount={totalCount}
        visible={showExtensionBanner}
        onDismiss={() => setBannerDismissed(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SourcesPanelList
          jobId={jobId}
          rows={visibleRows}
          matches={matches}
          query={state.q}
          activeDescendantId={keyboard.activeId}
          emptyState={
            <p
              className="px-4 py-8 text-center text-sm text-muted-foreground"
              data-sources-panel-empty
            >
              {t("emptyMatch")}
            </p>
          }
        />
      </div>
    </div>
  );
}
