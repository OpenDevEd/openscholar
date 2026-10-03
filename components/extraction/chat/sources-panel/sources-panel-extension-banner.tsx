"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatchToSnapshot,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";

interface SourcesPanelExtensionBannerProps {
  jobId: Id<"extractionJobs">;
  visibleCount: number;
  totalCount: number;
  visible: boolean;
  onDismiss: () => void;
}

export function SourcesPanelExtensionBanner({
  jobId,
  visibleCount,
  totalCount,
  visible,
  onDismiss,
}: SourcesPanelExtensionBannerProps) {
  const t = useTranslations("sourcesPanel.extensionBanner");
  const reduceMotion = useReducedMotion();
  const [pending, setPending] = useState(false);

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

  const showBanner = visible && visibleCount < totalCount;

  async function handleIncludeAll() {
    setPending(true);
    try {
      await bulkSetChatPapers({ jobId, sourceIds: undefined, included: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <AnimatePresence initial={false}>
      {showBanner && (
        <motion.div
          role="status"
          data-sources-extension-banner
          className="flex items-center justify-between gap-2 overflow-hidden border-b border-primary/20 bg-primary/5 px-3 py-1.5 text-xs"
          initial={reduceMotion ? false : { opacity: 0, y: 8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={
            reduceMotion
              ? { opacity: 1, height: 0 }
              : { opacity: 0, y: 8, height: 0 }
          }
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }
          }
        >
          <span className="flex min-w-0 items-center gap-1.5 text-solid-foreground/80">
            <CheckCircle2
              className="size-3.5 shrink-0 text-primary"
              aria-hidden
            />
            <span className="truncate">
              {t("filtered", { filtered: visibleCount })}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs font-semibold text-primary hover:bg-primary/10 hover:text-primary"
              data-banner-include-all
              disabled={pending}
              onClick={handleIncludeAll}
            >
              {t("includeAll", { total: totalCount })}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t("dismiss")}
              data-banner-dismiss
              onClick={onDismiss}
            >
              <X className="size-3" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
