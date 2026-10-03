"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircleIcon,
  BanIcon,
  ChevronRightIcon,
  ClockIcon,
  CoinsIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  WifiOffIcon,
  type AppIcon,
} from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getProviderIcon } from "@/components/icons/provider-icons";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import type { AIProvider } from "@/lib/types/ai.types";
import {
  parseChatError,
  type ChatErrorClass,
  type ChatErrorEnvelope,
} from "@/lib/errors/taxonomy";
import type { ChatModelRow } from "./chat-model-types";

interface ChatErrorAlertProps {
  rawError: string;
  onRetry: () => void;
  canRetry?: boolean;
  /**
   * Active chat model. When provided, the retry button surfaces the
   * provider glyph + model name — matching the hover-tooltip on the
   * regular per-message retry action so the user knows *which* model
   * they're about to hit again.
   */
  chatModelId?: Id<"models"> | null;
  models: ChatModelRow[];
}

const ICONS: Partial<Record<ChatErrorClass, AppIcon>> = {
  rate_limit: ClockIcon,
  insufficient_credits: CoinsIcon,
  model_unavailable: SlidersHorizontalIcon,
  auth: ShieldIcon,
  moderation: ShieldAlertIcon,
  context_too_long: BanIcon,
  network: WifiOffIcon,
  provider_5xx: AlertCircleIcon,
  regenerate_failed: RefreshCwIcon,
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
  canRetry = true,
  chatModelId,
  models,
}: ChatErrorAlertProps) {
  const t = useTranslations("extraction");
  const tErrors = useTranslations("errors");
  const envelope = parseChatError(rawError);
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
  const variant = NON_DESTRUCTIVE.has(envelope.class)
    ? "default"
    : "destructive";
  const role = variant === "destructive" ? "alert" : "status";
  const showDiagnostics = shouldShowDiagnostics(envelope);
  const showTechnicalDetails = showDiagnostics && envelope.message.length > 0;
  const backendReason = showDiagnostics ? backendReasonFor(envelope, t) : null;

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
      <AlertTitle>{titleFor(envelope, tErrors)}</AlertTitle>
      <AlertDescription>
        <span className="mb-2 block">{bodyFor(envelope, tErrors)}</span>
        {backendReason ? (
          <span
            className="mb-2 block text-xs text-muted-foreground"
            data-error-backend-reason
          >
            <span className="font-medium">
              {t("chatErrorBackendReasonLabel")}
            </span>{" "}
            {backendReason}
          </span>
        ) : null}
        {envelope.class === "insufficient_credits" &&
        envelope.creditEstimate ? (
          <CreditEstimateRow estimate={envelope.creditEstimate} />
        ) : null}
        <ActionRow
          envelope={envelope}
          onRetry={onRetry}
          canRetry={canRetry}
          activeModel={activeModel}
        />
        {showTechnicalDetails ? (
          <Collapsible className="mt-2" data-error-technical-details>
            <CollapsibleTrigger className="group/details flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]/details:rotate-90" />
              {t("chatErrorShowDetails")}
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
              <pre
                className="whitespace-pre-wrap break-words pt-1 pl-4.5 text-xs text-muted-foreground"
                data-error-technical-message
              >
                {envelope.message}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function CreditEstimateRow({
  estimate,
}: {
  estimate: NonNullable<ChatErrorEnvelope["creditEstimate"]>;
}) {
  const t = useTranslations("extraction");
  const progress = Math.max(
    0,
    Math.min(100, (estimate.available / Math.max(1, estimate.required)) * 100),
  );

  return (
    <div
      className="mb-3 rounded-md border border-destructive/20 bg-background/60 p-2.5"
      data-error-credit-estimate
      data-credit-required={String(estimate.required)}
      data-credit-available={String(estimate.available)}
      data-credit-deficit={String(estimate.deficit)}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">
          {t("chatErrorCreditsBalance")}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {t("chatErrorCreditsCurrentVsEstimate", {
            current: estimate.available,
            estimate: estimate.required,
          })}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-destructive/15"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-destructive/70"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t("chatErrorCreditsDeficit", { deficit: estimate.deficit })}
      </p>
    </div>
  );
}

function ActionRow({
  envelope,
  onRetry,
  canRetry,
  activeModel,
}: {
  envelope: ChatErrorEnvelope;
  onRetry: () => void;
  canRetry: boolean;
  activeModel: ActiveModel | null;
}) {
  // Stopped responses are a successful user action, not a failed response to
  // replay. Every other inline chat error exposes retry when the parent says
  // the target message is retryable.
  if (envelope.class === "aborted") {
    return null;
  }
  if (!canRetry) {
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

  const ProviderIcon = activeModel
    ? getProviderIcon(activeModel.provider)
    : null;
  const ariaLabel = activeModel
    ? t("chatRetryResponseWith", { model: activeModel.label })
    : t("chatRetryResponse");

  return (
    <Button
      type="button"
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
  const target = useMemo(
    () => (retryAfterMs ? Date.now() + retryAfterMs : null),
    [retryAfterMs],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [target]);
  if (target === null) return null;
  return Math.max(0, target - now);
}

function titleFor(
  envelope: ChatErrorEnvelope,
  t: ReturnType<typeof useTranslations<"errors">>,
): string {
  return t(`title.${envelope.class}` as never);
}

function bodyFor(
  envelope: ChatErrorEnvelope,
  t: ReturnType<typeof useTranslations<"errors">>,
): string {
  return t(`body.${envelope.class}` as never);
}

function backendReasonFor(
  envelope: ChatErrorEnvelope,
  t: ReturnType<typeof useTranslations<"extraction">>,
): string | null {
  if (envelope.class === "aborted") return null;
  if (!envelope.message) return null;
  if (/^(response failed|unknown error)$/i.test(envelope.message.trim())) {
    return t("chatErrorNoBackendReason");
  }
  return envelope.message;
}

function shouldShowDiagnostics(envelope: ChatErrorEnvelope): boolean {
  return (
    envelope.class !== "aborted" && envelope.class !== "insufficient_credits"
  );
}
