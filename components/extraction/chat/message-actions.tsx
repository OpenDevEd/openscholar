"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppToast } from "@/lib/toast";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { getProviderIcon } from "@/components/icons/provider-icons";
import type { AIProvider } from "@/lib/types/ai.types";
import { cn } from "@/lib/utils";
import type { UIMessage } from "@convex-dev/agent/react";
import type { ChatModelRow } from "./chat-model-types";

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
  /** When false, actions are hidden until the parent <article> is hovered/focused. */
  alwaysVisible?: boolean;
  onRetry: () => void;
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
  chatModelId,
  models,
  alwaysVisible = false,
  onRetry,
}: MessageActionsProps) {
  const t = useTranslations("extraction");
  const appToast = useAppToast();

  const isGenerating =
    message.status === "pending" || message.status === "streaming";
  const showRetry = isLastAssistant;
  const copyText = extractText(message);
  const canCopy = copyText.trim().length > 0;

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
    if (!canCopy) return;
    void navigator.clipboard
      .writeText(copyText)
      .then(() => {
        toast.success(t("chatCopied"));
      })
      .catch(() => {
        appToast.clipboard.copyFailed(t("chatCopyMessage"));
      });
  }, [appToast, canCopy, copyText, t]);

  const handleRetry = useCallback(() => {
    onRetry();
  }, [onRetry]);

  return (
    <div
      data-streaming={isGenerating}
      data-active-model={activeModel?.provider ?? ""}
      className={cn(
        "flex items-center gap-0.5 transition-opacity duration-150",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100",
      )}
    >
      {canCopy ? (
        <ActionButton
          ariaLabel={t("chatCopyMessage")}
          tooltip={t("chatCopyMessage")}
          onClick={handleCopy}
          disabled={isGenerating}
          dataAction="copy"
        >
          <CopyIcon className="size-3.5" />
        </ActionButton>
      ) : null}
      {showRetry && (
        <ActionButton
          ariaLabel={retryLabel}
          tooltip={retryTooltip}
          onClick={handleRetry}
          disabled={isGenerating}
          dataAction="retry"
        >
          <RefreshCwIcon className="size-3.5" />
        </ActionButton>
      )}
    </div>
  );
}
