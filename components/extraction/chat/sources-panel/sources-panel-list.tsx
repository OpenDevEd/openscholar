"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SelectableList } from "@/components/extraction/bucket/selectable-list";
import { api } from "@/convex/_generated/api";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import type { SearchMatch } from "@/lib/chat/search/source-scorer";
import { SourceRow } from "./source-row";

interface SourcesPanelListProps {
  jobId: Id<"extractionJobs">;
  rows: ChatSourceRow[];
  matches: ReadonlyMap<string, SearchMatch>;
  query: string;
  activeDescendantId: string | null;
  emptyState: React.ReactNode;
}

export function SourcesPanelList({
  jobId,
  rows,
  matches,
  query,
  activeDescendantId,
  emptyState,
}: SourcesPanelListProps) {
  const t = useTranslations("sourcesPanel");

  const toggleChatPaper = useMutation(
    api.chat.chatPapers.toggleChatPaper,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    const patched = applyInclusionPatch(
      current,
      new Map([[args.chatPaperId, args.included]]),
    );
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      patched,
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

  async function handleToggle(row: ChatSourceRow, next: boolean) {
    try {
      await toggleChatPaper({ chatPaperId: row.chatPaperId, included: next });
    } catch {
      toast.error(t("toggle.error"));
    }
  }

  async function handleToggleRange(items: ChatSourceRow[], next: boolean) {
    try {
      await bulkSetChatPapers({
        jobId,
        sourceIds: items.map((r) => r.sourceId),
        included: next,
      });
    } catch {
      toast.error(t("bulk.error", { action: next ? "include" : "exclude" }));
    }
  }

  return (
    <div
      role="listbox"
      aria-multiselectable="true"
      aria-label={t("listLabel")}
      aria-activedescendant={activeDescendantId ?? undefined}
      data-sources-panel-list
    >
      <SelectableList<ChatSourceRow>
        items={rows}
        keyOf={(r) => r.chatPaperId}
        isSelected={(r) => r.included}
        onToggle={handleToggle}
        onToggleRange={handleToggleRange}
        renderRow={(r) => (
          <SourceRow
            row={r}
            match={matches.get(r.chatPaperId)}
            query={query}
            isActiveDescendant={r.chatPaperId === activeDescendantId}
          />
        )}
        emptyState={emptyState}
      />
    </div>
  );
}
