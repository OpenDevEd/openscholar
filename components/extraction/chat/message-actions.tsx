"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import {
  MessageAction,
  MessageActions as MessageActionsContainer,
} from "@/components/ai-elements/message";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";
import type { UIMessage } from "@convex-dev/agent/react";

interface ChatUIMessage {
  status: UIMessage["status"];
  role: UIMessage["role"];
  parts?: UIMessage["parts"];
  text?: string;
}

interface MessageActionsProps {
  message: ChatUIMessage;
  isLastAssistant: boolean;
  threadId: string;
}

function extractText(message: ChatUIMessage): string {
  if (message.text) return message.text;
  if (!message.parts) return "";
  return message.parts
    .filter(
      (p): p is Extract<UIMessage["parts"][number], { type: "text" }> =>
        p.type === "text",
    )
    .map((p) => p.text)
    .join("\n");
}

export function MessageActions({
  message,
  isLastAssistant,
  threadId,
}: MessageActionsProps) {
  const t = useTranslations("extraction");
  const appToast = useAppToast();
  const regenerate = useMutation(api.chat.messages.regenerateLastAssistant);

  const isStreaming = message.status === "streaming";
  const isFailed = message.status === "failed";
  const showRetry = isLastAssistant || isFailed;

  const handleCopy = useCallback(() => {
    const text = extractText(message);
    if (!text) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.success(t("chatCopied"));
      })
      .catch(() => {
        appToast.clipboard.copyFailed(t("chatCopyMessage"));
      });
  }, [message, appToast, t]);

  const handleRetry = useCallback(() => {
    void regenerate({ threadId }).catch((err) => {
      appToast.error(t("chatFailedMessage"));
      console.error("retry failed", err);
    });
  }, [regenerate, threadId, appToast, t]);

  return (
    <MessageActionsContainer data-streaming={isStreaming}>
      <MessageAction
        tooltip={t("chatCopyMessage")}
        aria-label={t("chatCopyMessage")}
        onClick={handleCopy}
        disabled={isStreaming}
        data-streaming={isStreaming}
        data-action="copy"
      >
        <CopyIcon className="size-3.5" />
      </MessageAction>
      {showRetry && (
        <MessageAction
          tooltip={t("chatRetryResponse")}
          aria-label={t("chatRetryResponse")}
          onClick={handleRetry}
          disabled={isStreaming}
          data-streaming={isStreaming}
          data-action="retry"
        >
          <RefreshCwIcon className="size-3.5" />
        </MessageAction>
      )}
    </MessageActionsContainer>
  );
}
