"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
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
  const [pending, setPending] = useState(false);

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

  if (!visible || visibleCount >= totalCount) return null;

  async function handleIncludeAll() {
    setPending(true);
    try {
      await bulkSetChatPapers({ jobId, sourceIds: undefined, included: true });
    } catch {
      toast.error(t("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      data-sources-extension-banner
      className="flex items-center justify-between gap-3 border-b border-border/50 bg-primary/5 px-4 py-2 text-xs"
    >
      <span className="text-muted-foreground">
        {t("filtered", { filtered: visibleCount })}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs font-medium"
          data-banner-include-all
          disabled={pending}
          onClick={handleIncludeAll}
        >
          {t("includeAll", { total: totalCount })}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label={t("dismiss")}
          data-banner-dismiss
          onClick={onDismiss}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
