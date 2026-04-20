"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import {
  AlertCircleIcon,
  BanIcon,
  ClockIcon,
  CoinsIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getProviderIcon } from "@/components/icons/provider-icons";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import type { AIProvider } from "@/lib/types/ai.types";
import {
  isRetryable,
  parseChatError,
  requiresAdminAction,
  requiresUserEdit,
  type ChatErrorClass,
  type ChatErrorEnvelope,
} from "@/lib/errors/taxonomy";

interface ChatErrorAlertProps {
  rawError: string;
  onRetry: () => void;
  /**
   * Active chat model. When provided, the retry button surfaces the
   * provider glyph + model name — matching the hover-tooltip on the
   * regular per-message retry action so the user knows *which* model
   * they're about to hit again.
   */
  chatModelId?: Id<"models"> | null;
}

const ICONS: Partial<Record<ChatErrorClass, LucideIcon>> = {
  rate_limit: ClockIcon,
  insufficient_credits: CoinsIcon,
  model_unavailable: SlidersHorizontalIcon,
  auth: ShieldIcon,
  moderation: ShieldAlertIcon,
  context_too_long: BanIcon,
  network: WifiOffIcon,
  provider_5xx: AlertCircleIcon,
  aborted: SquareIcon,
  unknown: AlertCircleIcon,
};

/**
 * Classes that render as a quiet informational note rather than a
 * destructive error — the user aborted the response, or the response is
 * fine but we need to show a transient status.
 */
const NON_DESTRUCTIVE: ReadonlySet<ChatErrorClass> = new Set(["aborted"]);

type ActiveModel = {
  label: string;
  provider: AIProvider;
};

export function ChatErrorAlert({
  rawError,
  onRetry,
  chatModelId,
}: ChatErrorAlertProps) {
  const t = useTranslations("extraction");
  const envelope = parseChatError(rawError);

  // Dedup'd with the composer's model picker & MessageActions —
  // Convex shares the subscription.
  const models = useQuery(api.chat.model.listChatModels, {});
  const activeModel = useMemo<ActiveModel | null>(() => {
    if (!chatModelId || !models) return null;
    const found = models.find((m) => m._id === chatModelId);
    if (!found) return null;
    return {
      label: stripProviderPrefix(found.name),
      provider: found.provider as AIProvider,
    };
  }, [chatModelId, models]);

  if (!envelope) return null;

  const Icon = ICONS[envelope.class] ?? AlertCircleIcon;
  const variant = NON_DESTRUCTIVE.has(envelope.class) ? "default" : "destructive";
  const role = variant === "destructive" ? "alert" : "status";

  return (
    <Alert
      variant={variant}
      role={role}
      className="mt-2 self-start"
      data-message-error="true"
      data-error-code={envelope.class}
      data-http-status={envelope.httpStatus}
    >
      <Icon className="size-4" aria-hidden="true" />
      <AlertTitle>{titleFor(envelope, t)}</AlertTitle>
      <AlertDescription>
        <span className="mb-2 block">{bodyFor(envelope, t)}</span>
        <ActionRow
          envelope={envelope}
          onRetry={onRetry}
          activeModel={activeModel}
        />
        {envelope.message && envelope.class === "unknown" ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline">
              {t("chatErrorShowDetails")}
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {envelope.message}
            </pre>
          </details>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function ActionRow({
  envelope,
  onRetry,
  activeModel,
}: {
  envelope: ChatErrorEnvelope;
  onRetry: () => void;
  activeModel: ActiveModel | null;
}) {
  const t = useTranslations("extraction");

  if (requiresUserEdit(envelope)) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("chatErrorActionEditPrompt")}
      </span>
    );
  }
  if (requiresAdminAction(envelope)) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("chatErrorActionContactAdmin")}
      </span>
    );
  }
  // Aborts are taxonomy-retryable but the user explicitly stopped — don't
  // surface a one-click retry that contradicts their intent.
  if (envelope.class === "aborted" || !isRetryable[envelope.class]) {
    return null;
  }
  return (
    <RetryButton
      envelope={envelope}
      onRetry={onRetry}
      activeModel={activeModel}
    />
  );
}

function RetryButton({
  envelope,
  onRetry,
  activeModel,
}: {
  envelope: ChatErrorEnvelope;
  onRetry: () => void;
  activeModel: ActiveModel | null;
}) {
  const t = useTranslations("extraction");
  const remaining = useCountdown(envelope.retryAfterMs);
  const disabled = remaining !== null && remaining > 0;

  const ProviderIcon = activeModel ? getProviderIcon(activeModel.provider) : null;
  const ariaLabel = activeModel
    ? t("chatRetryResponseWith", { model: activeModel.label })
    : t("chatRetryResponse");

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onRetry}
      disabled={disabled}
      aria-label={ariaLabel}
      data-action="retry-inline"
      className="h-8 gap-2"
    >
      <RefreshCwIcon className="size-3.5" aria-hidden="true" />
      {disabled ? (
        <CountdownLabel remaining={remaining!} />
      ) : activeModel && ProviderIcon ? (
        <span className="flex items-baseline gap-1.5">
          <span className="opacity-70">{t("chatRetryWithPrefix")}</span>
          <span className="flex items-center gap-1 font-semibold tracking-tight">
            <ProviderIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {activeModel.label}
          </span>
        </span>
      ) : (
        ariaLabel
      )}
    </Button>
  );
}

function CountdownLabel({ remaining }: { remaining: number }) {
  const t = useTranslations("extraction");
  return <>{t("chatErrorRetryIn", { seconds: Math.ceil(remaining / 1000) })}</>;
}

function useCountdown(retryAfterMs: number | undefined): number | null {
  const [target] = useState<number | null>(() =>
    retryAfterMs ? Date.now() + retryAfterMs : null,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [target]);
  if (target === null) return null;
  return Math.max(0, target - now);
}

function titleFor(
  envelope: ChatErrorEnvelope,
  t: ReturnType<typeof useTranslations<"extraction">>,
): string {
  return t(`chatErrorTitle.${envelope.class}` as never);
}

function bodyFor(
  envelope: ChatErrorEnvelope,
  t: ReturnType<typeof useTranslations<"extraction">>,
): string {
  return t(`chatErrorBody.${envelope.class}` as never);
}
