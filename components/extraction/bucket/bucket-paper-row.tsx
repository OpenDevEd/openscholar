"use client";

import { motion, useReducedMotion } from "motion/react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authorsPreview, type AuthorsPreviewInput } from "@/lib/bucket/authors-preview";
import type { BucketItemStatus, BucketSource } from "@/lib/bucket/bucketItem";
import { cn } from "@/lib/utils";
import { SourceChip } from "./source-chip";

export type PaperRowData = AuthorsPreviewInput & {
  title: string;
  source: BucketSource;
  status?: BucketItemStatus;
};

interface BucketPaperRowProps {
  paper: PaperRowData;
  /** When provided, renders a trash button that calls this on click. */
  onRemove?: () => void;
  /** A11y label for the trash button. Defaults to `Remove ${title}`. */
  removeLabel?: string;
  /** Optional data-* attribute for callers (e.g. paper id, source key). */
  dataAttrs?: Record<`data-${string}`, string | number | undefined>;
  className?: string;
}

export function BucketPaperRow({
  paper,
  onRemove,
  removeLabel,
  dataAttrs,
  className,
}: BucketPaperRowProps) {
  const status = paper.status ?? "ready";
  const reduceMotion = useReducedMotion();

  return (
    <motion.li
      {...dataAttrs}
      data-paper-source={paper.source}
      data-paper-status={status}
      data-paper-readonly={onRemove ? undefined : "true"}
      layout={reduceMotion ? false : "position"}
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "group flex min-w-0 max-w-full flex-col gap-2 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:bg-accent/40",
        className,
      )}
    >
      <p className="line-clamp-2 break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]">
        {paper.title}
      </p>
      <div className="flex items-center gap-2">
        <SourceChip source={paper.source} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {authorsPreview(paper)}
          {status !== "ready" && (
            <>
              {" · "}
              {status === "uploading" && (
                <span className="inline-flex items-center gap-1 align-middle">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  uploading
                </span>
              )}
              {status === "failed" && <span>upload failed</span>}
            </>
          )}
        </span>
        {onRemove ? (
          <Button
            size="icon"
            variant="ghost"
            onClick={onRemove}
            aria-label={removeLabel ?? `Remove ${paper.title}`}
            className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
    </motion.li>
  );
}
