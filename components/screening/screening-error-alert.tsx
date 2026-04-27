"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertCircleIcon,
  BanIcon,
  ClockIcon,
  CoinsIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  classifyUnknownError,
  type ChatErrorClass,
  type ChatErrorEnvelope,
} from "@/lib/errors/taxonomy";

interface ScreeningError {
  paperId: string;
  error: string;
}

interface ScreeningErrorAlertProps {
  errors: ScreeningError[];
  onRetry: () => void;
  canRetry?: boolean;
}

/**
 * Surface order: pick the worst class present in the batch so the alert
 * conveys the most actionable issue. Insufficient_credits beats every
 * other class because it has a specific top-up CTA. Auth and rate_limit
 * follow because they're recoverable but block work.
 */
const CLASS_PRIORITY: ReadonlyArray<ChatErrorClass> = [
  "insufficient_credits",
  "auth",
  "rate_limit",
  "moderation",
  "context_too_long",
  "model_unavailable",
  "provider_5xx",
  "network",
  "unknown",
];

const ICONS: Partial<Record<ChatErrorClass, LucideIcon>> = {
  rate_limit: ClockIcon,
  insufficient_credits: CoinsIcon,
  model_unavailable: SlidersHorizontalIcon,
  auth: ShieldIcon,
  moderation: ShieldAlertIcon,
  context_too_long: BanIcon,
  network: WifiOffIcon,
  provider_5xx: AlertCircleIcon,
  unknown: AlertCircleIcon,
};

function pickWorstEnvelope(
  errors: ScreeningError[],
): ChatErrorEnvelope | null {
  if (errors.length === 0) return null;
  const envelopes: ChatErrorEnvelope[] = errors.map((e) => {
    const classified = classifyUnknownError(e.error);
    return {
      version: 1,
      class: classified.code,
      message: classified.message,
      ...(classified.httpStatus !== undefined
        ? { httpStatus: classified.httpStatus }
        : {}),
    };
  });
  for (const cls of CLASS_PRIORITY) {
    const found = envelopes.find((e) => e.class === cls);
    if (found) return found;
  }
  return envelopes[0];
}

export function ScreeningErrorAlert({
  errors,
  onRetry,
  canRetry = true,
}: ScreeningErrorAlertProps) {
  const tErrors = useTranslations("errors");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const envelope = useMemo(() => pickWorstEnvelope(errors), [errors]);

  if (!envelope) return null;

  const Icon = ICONS[envelope.class] ?? AlertCircleIcon;

  return (
    <Alert
      variant="destructive"
      data-screening-error="true"
      data-error-code={envelope.class}
      data-action="retry-batch"
    >
      <Icon className="size-4" aria-hidden="true" />
      <AlertTitle>{tErrors(`title.${envelope.class}` as never)}</AlertTitle>
      <AlertDescription>
        <span className="mb-2 block">
          {tErrors(`body.${envelope.class}` as never)}
        </span>
        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetry}
              data-action="retry-batch-button"
            >
              <RefreshCwIcon className="size-3.5" aria-hidden="true" />
              {tc("retry")}
            </Button>
          )}
          {envelope.class === "insufficient_credits" && (
            <Button
              asChild
              type="button"
              size="sm"
              variant="outline"
              data-action="open-billing"
            >
              <Link href="/settings/billing">
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                {tToast("openBilling")}
              </Link>
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
