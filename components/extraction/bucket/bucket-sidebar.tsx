"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { Loader2, Package, PanelRightClose, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sidebarSpring, hoverSpring } from "@/lib/ui/sidebar-motion";
import { useIsMobile } from "@/lib/hooks";
import {
  useBucketSidebarStore,
  getBucketSidebarDimensions,
} from "@/lib/store";
import { useBucketStore } from "@/lib/store/bucket";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { SourceChip } from "./source-chip";
import { AnimatedCount } from "./animated-count";

function capacityTint(readyCount: number, limit: number): string {
  if (readyCount >= limit) return "text-destructive";
  if (readyCount >= Math.floor(limit * 0.9))
    return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

function authorsPreview(item: BucketItem): string {
  const authors = item.authors.slice(0, 3).join(", ") || "Unknown";
  return item.year ? `${authors} · ${item.year}` : authors;
}

const PANEL_ID = "bucket-sidebar-panel";

function useReadyCount(): number {
  return useBucketStore((s) =>
    s.order.reduce((n, k) => {
      const item = s.items[k];
      return item?.status === "ready" ? n + (item.paperCount ?? 1) : n;
    }, 0),
  );
}

type SliverProps = {
  onExpand: () => void;
  sliverRef: React.RefObject<HTMLButtonElement | null>;
  readyCount: number;
  limit: number;
};

function BucketSidebarSliver({
  onExpand,
  sliverRef,
  readyCount,
  limit,
}: SliverProps) {
  const tint = capacityTint(readyCount, limit);
  return (
    <motion.button
      ref={sliverRef}
      type="button"
      onClick={onExpand}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      transition={hoverSpring}
      aria-expanded={false}
      aria-controls={PANEL_ID}
      aria-label={`Open bucket — ${readyCount} of ${limit} papers staged`}
      className={cn(
        "absolute inset-0 flex flex-col items-center gap-3 py-4 px-1",
        "text-muted-foreground hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Package className="h-4 w-4 shrink-0" />
      <AnimatedCount
        value={readyCount}
        total={limit}
        tint={tint}
        className="flex-col items-center gap-0 text-[11px] leading-tight"
      />
      <span className="sr-only" aria-live="polite">
        {readyCount} of {limit} papers staged
      </span>
    </motion.button>
  );
}

type PanelProps = {
  onCollapse: () => void;
  limit: number;
};

function BucketSidebarPanel({ onCollapse, limit }: PanelProps) {
  const order = useBucketStore((s) => s.order);
  const itemsMap = useBucketStore((s) => s.items);
  const remove = useBucketStore((s) => s.remove);
  const clear = useBucketStore((s) => s.clear);

  const items = order
    .map((k) => itemsMap[k])
    .filter((v): v is BucketItem => Boolean(v));

  const readyCount = items.reduce(
    (n, i) => (i.status === "ready" ? n + (i.paperCount ?? 1) : n),
    0,
  );
  const atCap = readyCount >= limit;
  const nearCap = !atCap && readyCount >= Math.floor(limit * 0.9);
  const tint = capacityTint(readyCount, limit);

  return (
    <section
      id={PANEL_ID}
      role="region"
      aria-labelledby="bucket-sidebar-title"
      className="flex h-full flex-col"
    >
      <header className="flex flex-col gap-2 border-b border-border/50 p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2
              id="bucket-sidebar-title"
              className="text-sm font-semibold text-foreground"
            >
              Bucket
            </h2>
            <p
              data-testid="bucket-sidebar-capacity"
              className={cn("mt-0.5 text-xs", tint)}
            >
              <AnimatedCount
                value={readyCount}
                total={limit}
                tint={tint}
                className="text-xs"
              />{" "}
              <span className="text-muted-foreground">papers ready to submit</span>
            </p>
          </div>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={hoverSpring}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onCollapse}
                  aria-label="Collapse bucket sidebar"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <PanelRightClose className="h-4 w-4" />
                </Button>
              </motion.div>
            </TooltipTrigger>
            <TooltipContent side="left">Collapse bucket</TooltipContent>
          </Tooltip>
        </div>
        {(nearCap || atCap) && (
          <div
            role="status"
            className={cn(
              "rounded-md p-2 text-xs",
              atCap
                ? "bg-destructive/10 text-destructive"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            {atCap
              ? "You've hit the per-job cap. Remove items before submitting."
              : "Approaching the per-job cap."}
          </div>
        )}
      </header>

      <ScrollArea className="flex-1 min-h-0 px-4">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            The bucket is empty. Add papers from any tab.
          </p>
        ) : (
          <ul className="space-y-2 py-4">
            {items.map((item) => (
              <li
                key={item.bucketKey}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3"
              >
                <SourceChip source={item.source} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {authorsPreview(item)}
                  </p>
                  {item.status !== "ready" && (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {item.status === "uploading" && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          uploading
                        </>
                      )}
                      {item.status === "failed" && <span>upload failed</span>}
                    </div>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove(item.bucketKey)}
                  aria-label={`Remove ${item.title}`}
                  className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <footer className="flex items-center justify-start border-t border-border/50 p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => clear()}
          disabled={items.length === 0}
        >
          Clear all
        </Button>
      </footer>
    </section>
  );
}

export function BucketSidebar() {
  const isMobile = useIsMobile();
  const hasHydrated = useBucketSidebarStore((s) => s._hasHydrated);
  const isCollapsed = useBucketSidebarStore((s) => s.isCollapsed);
  const toggle = useBucketSidebarStore((s) => s.toggle);
  const readyCount = useReadyCount();
  const limit = useQuery(api.extraction.bucket.queries.getMyPaperLimit) ?? 1000;
  const sliverRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "b"
      ) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(() => {
    if (isCollapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      toggle();
      requestAnimationFrame(() => sliverRef.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCollapsed, toggle]);

  if (!hasHydrated || isMobile) return null;

  const { expandedWidth, collapsedWidth } =
    getBucketSidebarDimensions(isCollapsed);
  const translateX = isCollapsed ? -(expandedWidth - collapsedWidth) : 0;

  return (
    <div
      className="h-full relative overflow-hidden"
      style={{
        width: isCollapsed ? collapsedWidth : expandedWidth,
        transition: `width ${sidebarSpring.stiffness}ms ease-out`,
      }}
    >
      <motion.aside
        role="complementary"
        aria-label="Staged papers bucket"
        className={cn(
          "h-full flex flex-col overflow-hidden absolute right-0 top-0 bottom-0",
          "bg-background/95 dark:bg-background/90",
          "border-l border-border/50",
        )}
        initial={false}
        animate={{ x: translateX }}
        transition={sidebarSpring}
        style={{ width: expandedWidth }}
      >
        {isCollapsed ? (
          <div className="relative h-full" style={{ width: collapsedWidth }}>
            <BucketSidebarSliver
              onExpand={toggle}
              sliverRef={sliverRef}
              readyCount={readyCount}
              limit={limit}
            />
          </div>
        ) : (
          <BucketSidebarPanel onCollapse={toggle} limit={limit} />
        )}
      </motion.aside>
    </div>
  );
}
