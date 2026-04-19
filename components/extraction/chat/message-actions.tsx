"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
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
import type { Id } from "@/convex/_generated/dataModel";
import { useAppToast } from "@/lib/toast";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { getProviderIcon } from "@/components/icons/provider-icons";
import type { AIProvider } from "@/lib/types/ai.types";
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
  /** Currently-selected chat model. Used to label the regenerate button. */
  chatModelId: Id<"models"> | null;
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
  ariaLabel,
  tooltip,
  onClick,
  disabled,
  dataAction,
  children,
}: {
  ariaLabel: string;
  tooltip: React.ReactNode;
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
          aria-label={ariaLabel}
          data-action={dataAction}
          className="size-7 text-muted-foreground hover:text-foreground"
        >
          {children}
          <span className="sr-only">{ariaLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function MessageActions({
  message,
  isLastAssistant,
  threadId,
  chatModelId,
  alwaysVisible = false,
}: MessageActionsProps) {
  const t = useTranslations("extraction");
  const appToast = useAppToast();
  const regenerate = useMutation(api.chat.messages.regenerateLastAssistant);
  // Convex dedupes identical query subscriptions, so this shares state
  // with the composer's model picker — no extra network round-trip.
  const models = useQuery(api.chat.model.listChatModels, {});

  const isStreaming = message.status === "streaming";
  const isFailed = message.status === "failed";
  const showRetry = isLastAssistant || isFailed;

  const activeModel = useMemo(() => {
    if (!chatModelId || !models) return null;
    const found = models.find((m) => m._id === chatModelId);
    if (!found) return null;
    return {
      label: stripProviderPrefix(found.name),
      provider: found.provider as AIProvider,
    };
  }, [chatModelId, models]);

  const ProviderIcon = useMemo(
    () => (activeModel ? getProviderIcon(activeModel.provider) : null),
    [activeModel],
  );

  const retryLabel = activeModel
    ? t("chatRetryResponseWith", { model: activeModel.label })
    : t("chatRetryResponse");

  const retryTooltip =
    activeModel && ProviderIcon ? (
      <span className="flex items-center gap-2">
        <ProviderIcon className="size-4 shrink-0" aria-hidden />
        <span className="flex items-baseline gap-1">
          <span className="opacity-60">{t("chatRetryWithPrefix")}</span>
          <span className="font-semibold tracking-tight">
            {activeModel.label}
          </span>
        </span>
      </span>
    ) : (
      retryLabel
    );

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
      data-active-model={activeModel?.provider ?? ""}
      className={cn(
        "flex items-center gap-0.5 transition-opacity duration-150",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100",
      )}
    >
      <ActionButton
        ariaLabel={t("chatCopyMessage")}
        tooltip={t("chatCopyMessage")}
        onClick={handleCopy}
        disabled={isStreaming}
        dataAction="copy"
      >
        <CopyIcon className="size-3.5" />
      </ActionButton>
      {showRetry && (
        <ActionButton
          ariaLabel={retryLabel}
          tooltip={retryTooltip}
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
