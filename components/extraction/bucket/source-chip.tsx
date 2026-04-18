import type { BucketSource } from "@/lib/bucket/bucketItem";
import {
  BUCKET_SOURCE_LABELS,
  SOURCE_COLOR_VAR,
} from "@/lib/bucket/source-labels";
import { cn } from "@/lib/utils";

export function SourceChip({
  source,
  className,
}: {
  source: BucketSource;
  className?: string;
}) {
  return (
    <span
      data-source={source}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0",
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `var(${SOURCE_COLOR_VAR[source]})` }}
        aria-hidden="true"
      />
      {BUCKET_SOURCE_LABELS[source]}
    </span>
  );
}
