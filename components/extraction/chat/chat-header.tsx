"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { ModelPicker } from "@/components/extraction/model-picker";
import { ClearConversation } from "./clear-conversation";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAppToast } from "@/lib/toast";
import { toast } from "sonner";

export interface ChatHeaderProps {
  job: Doc<"extractionJobs">;
  threadId: string;
}

export function ChatHeader({ job, threadId }: ChatHeaderProps) {
  const t = useTranslations("extraction");
  const appToast = useAppToast();
  const swapModel = useMutation(api.chat.messages.swapModel);

  const isGenerating = job.isGenerating ?? false;

  const handleModelChange = useCallback(
    (modelId: Id<"models">) => {
      void swapModel({ threadId, modelId })
        .then(() => {
          toast.success(t("chatModelChanged"));
        })
        .catch((err) => {
          appToast.error(t("chatFailedMessage"));
          console.error("swap model failed", err);
        });
    },
    [swapModel, threadId, appToast, t],
  );

  return (
    <header
      className="flex items-center justify-between gap-3 border-b px-4 py-3"
      data-chat-header="true"
    >
      <h1 className="truncate text-lg font-medium" data-testid="chat-job-name">
        {job.name}
      </h1>
      <div className="flex items-center gap-2">
        <div className="min-w-[180px]">
          <ModelPicker
            value={job.chatModelId ?? null}
            onChange={handleModelChange}
            disabled={isGenerating}
          />
        </div>
        <ClearConversation threadId={threadId} disabled={isGenerating} />
      </div>
    </header>
  );
}
