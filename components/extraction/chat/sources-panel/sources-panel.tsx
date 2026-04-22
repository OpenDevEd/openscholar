"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "motion/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatchToSnapshot,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import { useIsMobile } from "@/lib/hooks";
import { usePapersContext } from "../papers-context";
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
const DESKTOP_RAIL_WIDTH = 360;

export function SourcesPanel({ jobId }: SourcesPanelProps) {
  const isMobile = useIsMobile();
  if (isMobile) return null;
  // Desktop rail: bound the column to a fixed pixel width inside the
  // TwoColumnLayout shrink-0 sticky slot. Inline style (matches the
  // legacy PaperSidebarShell pattern) so JIT doesn't have to compile
  // an arbitrary Tailwind class. The Sheet variant skips this wrapper
  // because SheetContent already sizes itself (w-[90vw] max-w-md).
  return (
    <div
      className="h-full shrink-0 border-l"
      style={{ width: DESKTOP_RAIL_WIDTH }}
    >
      <SourcesPanelInner jobId={jobId} />
    </div>
  );
}

export function SourcesPanelInner({ jobId }: SourcesPanelProps) {
  const t = useTranslations("sourcesPanel");
  const reduceMotion = useReducedMotion();
  const { rows } = usePapersContext();
  const {
    state,
    setState,
    visibleRows,
    matches,
    chipCounts,
    totalCount,
    includedCount,
    isSearchStale,
  } = useSourcesPanelState(rows);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filterActive = state.q.trim().length > 0 || state.src !== "all";
  const allVisibleIncluded =
    visibleRows.length > 0 && visibleRows.every((r) => r.included);
  // Only surface the "Include all N" CTA if some hidden row is actually
  // excluded. When everything is already included the action is a no-op
  // and the banner is just noise.
  const hasHiddenExcluded = includedCount < totalCount;
  const showExtensionBanner =
    !bannerDismissed &&
    filterActive &&
    allVisibleIncluded &&
    visibleRows.length < totalCount &&
    hasHiddenExcluded;

  const bulkSetChatPapers = useMutation(
    api.chat.chatPapers.bulkSetChatPapers,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    const patch = buildBulkPatch(current.rows, args.sourceIds, args.included);
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      applyInclusionPatchToSnapshot(current, patch),
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
      applyInclusionPatchToSnapshot(
        current,
        new Map([[args.chatPaperId, args.included]]),
      ),
    );
  });

  const keyboard = useSourcesPanelKeyboard({
    visibleRows,
    onToggleOne: (row, next) => {
      void toggleChatPaper({
        chatPaperId: row.chatPaperId,
        included: next,
      });
    },
    onToggleRange: (rangeRows, next) => {
      void bulkSetChatPapers({
        jobId,
        sourceIds: rangeRows.map((r) => r.sourceId),
        included: next,
      });
    },
    onIncludeAllVisible: () => {
      void bulkSetChatPapers({
        jobId,
        sourceIds: visibleRows.map((r) => r.sourceId),
        included: true,
      });
    },
    onInvertVisible: () => {
      const wasIncluded = visibleRows
        .filter((r) => r.included)
        .map((r) => r.sourceId);
      const wasExcluded = visibleRows
        .filter((r) => !r.included)
        .map((r) => r.sourceId);
      if (wasIncluded.length) {
        void bulkSetChatPapers({
          jobId,
          sourceIds: wasIncluded,
          included: false,
        });
      }
      if (wasExcluded.length) {
        void bulkSetChatPapers({
          jobId,
          sourceIds: wasExcluded,
          included: true,
        });
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
      <SourcesPanelToolbar
        jobId={jobId}
        visibleRows={visibleRows}
        query={state.q}
        onQueryChange={(next) => setState({ q: next })}
        sort={state.sort}
        dir={state.dir}
        onSortChange={(sort, dir) => setState({ sort, dir })}
        chipSelected={state.src}
        chipCounts={chipCounts}
        onChipChange={(next) => setState({ src: next })}
        searchInputRef={searchInputRef}
        isSearchStale={isSearchStale}
      />
      <SourcesPanelExtensionBanner
        jobId={jobId}
        visibleCount={visibleRows.length}
        totalCount={totalCount}
        visible={showExtensionBanner}
        onDismiss={() => setBannerDismissed(true)}
      />
      <div className="min-h-0 flex-1">
        <SourcesPanelList
          jobId={jobId}
          rows={visibleRows}
          matches={matches}
          query={state.q}
          activeDescendantId={keyboard.activeId}
          isSearchStale={isSearchStale}
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
