import type { BucketSource } from "@/lib/bucket/bucketItem";
import {
  BUCKET_SOURCE_LABELS,
  SOURCE_COLOR_VAR,
  SOURCE_ICON,
} from "@/lib/bucket/source-labels";
import { cn } from "@/lib/utils";

export function SourceChip({
  source,
  className,
}: {
  source: BucketSource;
  className?: string;
}) {
  const SourceIcon = SOURCE_ICON[source];
  return (
    <span
      data-source={source}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-background px-2 py-0.5 text-2xs font-medium text-muted-foreground shrink-0",
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex" style={{ color: `var(${SOURCE_COLOR_VAR[source]})` }}>
        <SourceIcon className="size-3" />
      </span>
      {BUCKET_SOURCE_LABELS[source]}
    </span>
  );
}
