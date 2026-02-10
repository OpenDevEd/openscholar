import { Badge } from "@/components/ui/badge";
import type { CitationStatus } from "@/lib/extraction/citations";

const citationLabels: Record<CitationStatus, string> = {
  grounded: "Grounded",
  best_effort: "Best effort",
  insufficient_evidence: "Insufficient evidence",
  extraction_error: "Extraction error",
};

export function CitationStatusBadge({ status }: { status?: CitationStatus }) {
  if (!status || !(status in citationLabels)) return null;

  return (
    <Badge variant="outline" className="text-2xs font-medium">
      {citationLabels[status]}
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
