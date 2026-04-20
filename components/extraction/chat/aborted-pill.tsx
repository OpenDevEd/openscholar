"use client";

import { StopCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Inline indicator shown next to an assistant message whose stream was
 * user-stopped (plans/chat-stop-streaming/02-aborted-ui-state.md § Surface B).
 * Distinct from ChatErrorAlert — a stop is user-initiated, not a failure.
 */
export function AbortedPill() {
  const t = useTranslations("extraction");
  return (
    <span
      role="status"
      data-message-state="aborted"
      aria-label={t("chatAbortedPillAria")}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
    >
      <StopCircleIcon className="size-3" aria-hidden="true" />
      {t("chatAbortedPillLabel")}
    </span>
  );
}
