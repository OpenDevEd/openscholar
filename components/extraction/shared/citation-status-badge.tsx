"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import type { CitationStatus } from "@/lib/extraction/citations";

const citationKeyMap: Record<CitationStatus, "grounded" | "bestEffort" | "insufficientEvidence" | "extractionError"> = {
  grounded: "grounded",
  best_effort: "bestEffort",
  insufficient_evidence: "insufficientEvidence",
  extraction_error: "extractionError",
};

export function CitationStatusBadge({ status }: { status?: CitationStatus }) {
  const tc = useTranslations("common");
  if (!status || !(status in citationKeyMap)) return null;

  return (
    <Badge variant="outline" className="text-2xs font-medium">
      {tc(citationKeyMap[status])}
    </Badge>
  );
}

export function ReviewStatusBadge({
  label,
  state,
}: {
  label: string | null;
  state?: string;
}) {
  if (!label || !state || state === "unreviewed") return null;

  return (
    <Badge variant="outline" className="text-2xs font-medium">
      {label}
    </Badge>
  );
}
