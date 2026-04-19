"use client";

import { useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useBucketStore } from "@/lib/store/bucket";
import { useTranslations } from "next-intl";

/**
 * Chat-mode step-2 warning. Chat has no PDF/RAG path; answers come from
 * abstracts alone. When any staged paper is missing an abstract, surface
 * the count so the user can decide whether to pick different papers.
 */
export function AbstractMissingBanner() {
  const t = useTranslations("extraction");
  const order = useBucketStore((s) => s.order);
  const items = useBucketStore((s) => s.items);

  const { total, missing } = useMemo(() => {
    let total = 0;
    let missing = 0;
    for (const key of order) {
      const item = items[key];
      if (!item) continue;
      if (item.status !== "ready") continue;
      total += 1;
      if (!item.abstract || item.abstract.trim().length === 0) {
        missing += 1;
      }
    }
    return { total, missing };
  }, [order, items]);

  if (missing === 0) return null;

  return (
    <Alert
      role="status"
      data-missing-count={missing}
      data-total-count={total}
      className="mb-4"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{t("abstractMissingTitle")}</AlertTitle>
      <AlertDescription>
        {t("abstractMissingDescription", { missing, total })}
      </AlertDescription>
    </Alert>
  );
}
