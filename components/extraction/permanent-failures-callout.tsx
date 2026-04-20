"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Known body keys; must stay in lockstep with the `extraction.retry
// .permanent.body.*` namespace in messages/*.json.
type PermanentBodyKey =
  | "pdf_invalid"
  | "paper_not_found"
  | "moderation"
  | "context_too_long"
  | "llm_content_refusal"
  | "schema_validation"
  | "auth"
  | "cancelled"
  | "unknown";

const KNOWN_BODY_CODES = new Set<PermanentBodyKey>([
  "pdf_invalid",
  "paper_not_found",
  "moderation",
  "context_too_long",
  "llm_content_refusal",
  "schema_validation",
  "auth",
  "cancelled",
  "unknown",
]);

function toBodyKey(code: string): PermanentBodyKey {
  return KNOWN_BODY_CODES.has(code as PermanentBodyKey)
    ? (code as PermanentBodyKey)
    : "unknown";
}

export interface PermanentFailuresCalloutProps {
  /**
   * Per-code count of permanent failures. Iteration order is
   * count-desc / code-asc (produced by `summarizeRetryable`). The
   * callout renders entries in that order.
   */
  breakdown: Record<string, number>;
}

/**
 * Plan-05 permanent-failures callout.
 *
 * Shown beneath <RetrySummary> when a job has non-retryable failures
 * (e.g. invalid PDFs, moderation blocks). Lists each code with its
 * localized label + count and a dismiss affordance.
 *
 * The callout is dismissible in-session only (no persistence) — on
 * next page load the user sees it again, which is the right
 * trade-off for a rare affordance that should stay discoverable.
 */
export function PermanentFailuresCallout({
  breakdown,
}: PermanentFailuresCalloutProps) {
  const t = useTranslations("extraction.retry.permanent");
  const [dismissed, setDismissed] = useState(false);

  const entries = Object.entries(breakdown);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);

  if (dismissed || total === 0) return null;

  return (
    <div
      role="note"
      data-permanent-total={total}
      className="flex items-start justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
    >
      <div className="flex items-start gap-2">
        <CircleAlert
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-medium">{t("title", { count: total })}</p>
          <ul className="space-y-0.5 text-muted-foreground">
            {entries.map(([code, count]) => {
              const bodyKey = toBodyKey(code);
              return (
                <li key={code} data-permanent-code={code}>
                  {count} ×{" "}
                  {bodyKey === "pdf_invalid"
                    ? t("body.pdf_invalid")
                    : bodyKey === "paper_not_found"
                      ? t("body.paper_not_found")
                      : bodyKey === "moderation"
                        ? t("body.moderation")
                        : bodyKey === "context_too_long"
                          ? t("body.context_too_long")
                          : bodyKey === "llm_content_refusal"
                            ? t("body.llm_content_refusal")
                            : bodyKey === "schema_validation"
                              ? t("body.schema_validation")
                              : bodyKey === "auth"
                                ? t("body.auth")
                                : bodyKey === "cancelled"
                                  ? t("body.cancelled")
                                  : t("body.unknown")}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setDismissed(true)}
        data-action="dismiss"
        aria-label={t("dismiss")}
        className="h-6 w-6 shrink-0 p-0"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  );
}
