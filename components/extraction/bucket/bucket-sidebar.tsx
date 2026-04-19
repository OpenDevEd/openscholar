"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import {
  Package,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
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
import { useBucketStore, type AllClearSnapshot } from "@/lib/store/bucket";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { bucketCleared } from "@/lib/toast/bucket";
import { BucketPaperRow } from "./bucket-paper-row";
import { AnimatedCount } from "./animated-count";

type CapacityState = "normal" | "near" | "at";

function capacityState(readyCount: number, limit: number): CapacityState {
  if (readyCount >= limit) return "at";
  if (readyCount >= Math.floor(limit * 0.9)) return "near";
  return "normal";
}

const CAPACITY_TINT: Record<CapacityState, string> = {
  normal: "text-foreground",
  near: "text-amber-600 dark:text-amber-400",
  at: "text-destructive",
};

const PANEL_ID = "bucket-sidebar-panel";

function useReadyCount(): number {
  return useBucketStore((s) =>
    s.order.reduce((n, k) => {
      const item = s.items[k];
      return item?.status === "ready" ? n + (item.paperCount ?? 1) : n;
    }, 0),
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
  const restoreFromSnapshot = useBucketStore((s) => s.restoreFromSnapshot);

  const items = order
    .map((k) => itemsMap[k])
    .filter((v): v is BucketItem => Boolean(v));

  const readyCount = items.reduce(
    (n, i) => (i.status === "ready" ? n + (i.paperCount ?? 1) : n),
    0,
  );
  const state = capacityState(readyCount, limit);
  const atCap = state === "at";
  const nearCap = state === "near";
  const tint = CAPACITY_TINT[state];

  const handleClearAll = () => {
    const snapshot: AllClearSnapshot = {
      items: { ...itemsMap },
      order: [...order],
    };
    clear();
    bucketCleared(readyCount, snapshot, restoreFromSnapshot);
  };

  return (
    <section
      id={PANEL_ID}
      role="region"
      aria-labelledby="bucket-sidebar-title"
      className="flex h-full flex-col"
    >
      <header className="flex flex-col gap-2 border-b border-border/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2
              id="bucket-sidebar-title"
              className="text-sm font-semibold text-foreground"
            >
              Bucket
            </h2>
            <p
              data-testid="bucket-sidebar-capacity"
              data-capacity-state={state}
              className={cn("mt-0.5 text-xs", tint)}
            >
              <AnimatedCount
                value={readyCount}
                total={limit}
                tint={tint}
                className="text-xs"
              />{" "}
              <span className="font-medium text-muted-foreground">
                papers ready to submit
              </span>
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
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <PanelRightClose className="h-4 w-4" />
                </Button>
              </motion.div>
            </TooltipTrigger>
            <TooltipContent side="left">
              Collapse bucket (⌘⇧B)
            </TooltipContent>
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

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            The bucket is empty. Add papers from any tab.
          </p>
        ) : (
          <ul className="w-full space-y-2 py-4">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <BucketPaperRow
                  key={item.bucketKey}
                  paper={item}
                  onRemove={() => remove(item.bucketKey)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-start border-t border-border/50 p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearAll}
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
  // Right-side sidebar: motion.aside anchors to the LEFT edge of its
  // slot and slides RIGHT by (expanded - collapsed) when collapsing,
  // hiding itself entirely past the right viewport edge. The sliver
  // (separate element below) lives at the slot's left edge and is
  // always visible when collapsed. Mirrors filter-sidebar's pattern
  // but reflected for right-side mounting.
  const translateX = isCollapsed ? expandedWidth - collapsedWidth : 0;
  const tint = CAPACITY_TINT[capacityState(readyCount, limit)];

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
          "h-full flex flex-col overflow-hidden absolute left-0 top-0 bottom-0",
          "bg-background/95 dark:bg-background/90",
          "border-l border-border/50",
        )}
        initial={false}
        animate={{ x: translateX }}
        transition={sidebarSpring}
        style={{ width: expandedWidth }}
      >
        <BucketSidebarPanel onCollapse={toggle} limit={limit} />
      </motion.aside>

      <AnimatePresence>
        {isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute top-0 bottom-0 left-0 z-20 flex flex-col items-center gap-3 py-4",
              "bg-background/95 dark:bg-background/90",
              "border-l border-border/50",
            )}
            style={{ width: collapsedWidth }}
          >
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={hoverSpring}
                >
                  <Button
                    ref={sliverRef}
                    variant="outline"
                    size="icon"
                    onClick={toggle}
                    aria-expanded={false}
                    aria-controls={PANEL_ID}
                    aria-label={`Open bucket — ${readyCount} of ${limit} papers staged`}
                    className="h-9 w-9 shadow-sm"
                  >
                    <PanelRightOpen className="h-4 w-4" />
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent side="left">
                Open bucket (⌘⇧B)
              </TooltipContent>
            </Tooltip>

            <div className="mt-1 flex flex-col items-center gap-1 text-muted-foreground">
              <Package className="h-4 w-4" />
              <AnimatedCount
                value={readyCount}
                total={limit}
                showTotal={false}
                tint={tint || "text-foreground"}
                className="text-sm"
              />
            </div>

            <span className="sr-only" aria-live="polite">
              {readyCount} of {limit} papers staged
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
