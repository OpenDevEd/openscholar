"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, RefreshCwIcon } from "@/components/icons";
import {
  MessageAction,
  MessageActions as MessageActionsBar,
} from "@/components/ai-elements/message";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppToast } from "@/lib/toast";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { cn } from "@/lib/utils";
import type { UIMessage } from "@convex-dev/agent/react";
import type { ChatModelRow } from "./chat-model-types";
import { getChatMessageText } from "@/lib/chat/message-text";
import { normalizeChatMarkdownForClipboard } from "@/lib/chat/markdown-render";

interface ChatUIMessage {
  status: UIMessage["status"];
  role: UIMessage["role"];
  parts?: UIMessage["parts"];
  text?: string;
}

interface MessageActionsProps {
  message: ChatUIMessage;
  isLastAssistant: boolean;
  /** Currently-selected chat model. Used to label the regenerate button. */
  chatModelId: Id<"models"> | null;
  models: ChatModelRow[];
  /** When false, actions are hidden until the message is hovered/focused. */
  alwaysVisible?: boolean;
  onRetry: () => void;
}

export function MessageActions({
  message,
  isLastAssistant,
  chatModelId,
  models,
  alwaysVisible = false,
  onRetry,
}: MessageActionsProps) {
  const t = useTranslations("extraction");
  const appToast = useAppToast();

  const isGenerating =
    message.status === "pending" || message.status === "streaming";
  const copyText = normalizeChatMarkdownForClipboard(
    getChatMessageText(message),
  );
  const canCopy = copyText.trim().length > 0;

  const activeModel = useMemo(
    () => models.find((m) => m._id === chatModelId) ?? null,
    [chatModelId, models],
  );
  const retryLabel = activeModel
    ? t("chatRetryResponseWith", { model: stripProviderPrefix(activeModel.name) })
    : t("chatRetryResponse");

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(copyText)
      .then(() => {
        toast.success(t("chatCopied"));
      })
      .catch(() => {
        appToast.clipboard.copyFailed(t("chatCopyMessage"));
      });
  }, [appToast, copyText, t]);

  return (
    <MessageActionsBar
      data-streaming={isGenerating}
      data-active-model={activeModel?.provider ?? ""}
      className={cn(
        "gap-0.5 transition-opacity duration-150",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
      )}
    >
      {canCopy ? (
        <MessageAction
          tooltip={t("chatCopyMessage")}
          onClick={handleCopy}
          disabled={isGenerating}
          data-action="copy"
          className="text-muted-foreground hover:text-foreground"
        >
          <CopyIcon className="size-3.5" />
        </MessageAction>
      ) : null}
      {isLastAssistant ? (
        <MessageAction
          tooltip={retryLabel}
          onClick={onRetry}
          disabled={isGenerating}
          data-action="retry"
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCwIcon className="size-3.5" />
        </MessageAction>
      ) : null}
    </MessageActionsBar>
  );
}
