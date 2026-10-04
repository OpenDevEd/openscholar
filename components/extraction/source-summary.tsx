"use client";

import { useMemo, type ComponentType, type SVGProps } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BookOpen,
  FileUp,
  Folder,
  Layers,
  Search,
} from "@/components/icons";
import { useTranslations } from "next-intl";

import { useBucketStore } from "@/lib/store/bucket";
import { BUCKET_SOURCE_LABELS } from "@/lib/bucket/source-labels";
import type { BucketSource } from "@/lib/bucket/bucketItem";
import { AnimatedCount } from "./bucket/animated-count";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { cn } from "@/lib/utils";

const SOURCE_KEYS: BucketSource[] = [
  "history",
  "library",
  "collection",
  "zotero",
  "upload",
];

const SOURCE_ICONS: Record<BucketSource, ComponentType<SVGProps<SVGSVGElement>>> = {
  history: Search,
  library: BookOpen,
  collection: Folder,
  zotero: ZoteroIcon,
  upload: FileUp,
};

// Static class strings so Tailwind's JIT captures all 10 at build time.
// Dynamic `bg-chart-${n}` would be purged.
const CHIP_TINT: Record<BucketSource, string> = {
  history: "bg-chart-1/10 border-chart-1/30",
  library: "bg-chart-2/10 border-chart-2/30",
  collection: "bg-chart-3/10 border-chart-3/30",
  zotero: "bg-chart-4/10 border-chart-4/30",
  upload: "bg-chart-5/10 border-chart-5/30",
};

const ICON_TINT: Record<BucketSource, string> = {
  history: "text-chart-1",
  library: "text-chart-2",
  collection: "text-chart-3",
  zotero: "text-chart-4",
  upload: "text-chart-5",
};

export function SourceSummary() {
  const t = useTranslations("extraction");
  const order = useBucketStore((s) => s.order);
  const items = useBucketStore((s) => s.items);
  const prefersReduced = useReducedMotion();

  const counts = useMemo(() => {
    const tally: Record<BucketSource, number> = {
      history: 0,
      library: 0,
      collection: 0,
      zotero: 0,
      upload: 0,
    };
    for (const key of order) {
      const item = items[key];
      if (!item || item.status !== "ready") continue;
      // Per-source tally sums paperCount (default 1) rather than row
      // count, so a saved-search entry of N papers shows up as N, not 1.
      tally[item.source] += item.paperCount ?? 1;
    }
    return tally;
  }, [order, items]);

  const active = SOURCE_KEYS.filter((k) => counts[k] > 0);
  const total = active.reduce((n, k) => n + counts[k], 0);

  if (total === 0) return null;

  const srSummary = active
    .map((k) => `${counts[k]} ${BUCKET_SOURCE_LABELS[k]}`)
    .join(", ");

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      initial={prefersReduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Layers
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
        <AnimatedCount
          value={total}
          total={total}
          showTotal={false}
          className="text-sm text-foreground"
        />
        <span className="text-muted-foreground">
          {t("papersStagedSuffix", { count: total })}
        </span>
      </span>

      <span aria-hidden="true" className="h-4 w-px bg-border/60" />

      <div className="flex flex-wrap items-center gap-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {active.map((source) => {
            const Icon = SOURCE_ICONS[source];
            return (
              <motion.span
                key={source}
                layout={!prefersReduced}
                initial={
                  prefersReduced
                    ? false
                    : { opacity: 0, y: 4, scale: 0.96 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  scale: 0.94,
                  transition: { duration: 0.15 },
                }}
                transition={{
                  type: "spring",
                  stiffness: 420,
                  damping: 32,
                  mass: 0.6,
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
                  CHIP_TINT[source],
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("size-3", ICON_TINT[source])}
                />
                <AnimatedCount
                  value={counts[source]}
                  total={counts[source]}
                  showTotal={false}
                  className="text-xs text-foreground"
                />
                <span className="text-muted-foreground">
                  {BUCKET_SOURCE_LABELS[source]}
                </span>
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>

      <span className="sr-only">{srSummary}</span>
    </motion.div>
  );
}
