"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
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
  /** When false, actions are hidden until the parent <article> is hovered/focused. */
  alwaysVisible?: boolean;
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

function ActionButton({
  label,
  onClick,
  disabled,
  dataAction,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  dataAction: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          data-action={dataAction}
          className="size-7 text-muted-foreground hover:text-foreground"
        >
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function MessageActions({
  message,
  isLastAssistant,
  threadId,
  alwaysVisible = false,
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
    <div
      data-streaming={isStreaming}
      className={cn(
        "flex items-center gap-0.5 transition-opacity duration-150",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100",
      )}
    >
      <ActionButton
        label={t("chatCopyMessage")}
        onClick={handleCopy}
        disabled={isStreaming}
        dataAction="copy"
      >
        <CopyIcon className="size-3.5" />
      </ActionButton>
      {showRetry && (
        <ActionButton
          label={t("chatRetryResponse")}
          onClick={handleRetry}
          disabled={isStreaming}
          dataAction="retry"
        >
          <RefreshCwIcon className="size-3.5" />
        </ActionButton>
      )}
    </div>
  );
}
