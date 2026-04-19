"use client";

import { useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useBucketStore } from "@/lib/store/bucket";
import { useTranslations } from "next-intl";
import { summarizeChatSources } from "@/lib/bucket/chat-source-stats";

/**
 * Chat-mode step-2 warning. Chat has no PDF/RAG path; answers come from
 * abstracts alone. When any staged paper is missing an abstract, surface
 * the count so the user can decide whether to pick different papers.
 */
export function AbstractMissingBanner() {
  const t = useTranslations("extraction");
  const order = useBucketStore((s) => s.order);
  const items = useBucketStore((s) => s.items);

  const { concretePapers, missingAbstractPapers } = useMemo(
    () => summarizeChatSources(order.flatMap((key) => (items[key] ? [items[key]] : []))),
    [order, items],
  );

  if (missingAbstractPapers === 0) return null;

  return (
    <Alert
      role="status"
      data-missing-count={missingAbstractPapers}
      data-total-count={concretePapers}
      className="mb-4"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{t("abstractMissingTitle")}</AlertTitle>
      <AlertDescription>
        {t("abstractMissingDescription", {
          missing: missingAbstractPapers,
          total: concretePapers,
        })}
      </AlertDescription>
    </Alert>
  );
}
