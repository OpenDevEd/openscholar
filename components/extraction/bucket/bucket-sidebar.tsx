"use client";

import { AnimatePresence, motion } from "motion/react";
import { Package, PanelRightClose } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hoverSpring } from "@/lib/ui/sidebar-motion";
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
import { PaperSidebarShell } from "@/components/extraction/sidebar/paper-sidebar-shell";
import { PAPER_LIMIT } from "@/lib/extraction/limits";

type CapacityState = "normal" | "near" | "at";

function capacityState(readyCount: number, limit: number): CapacityState {
  if (readyCount >= limit) return "at";
  if (readyCount >= Math.floor(limit * 0.9)) return "near";
  return "normal";
}

const CAPACITY_TINT: Record<CapacityState, string> = {
  normal: "text-foreground",
  near: "ink-warning",
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

interface BucketHeaderProps {
  readyCount: number;
  limit: number;
  state: CapacityState;
  tint: string;
  onCollapse: () => void;
}

function BucketHeader({
  readyCount,
  limit,
  state,
  tint,
  onCollapse,
}: BucketHeaderProps) {
  const atCap = state === "at";
  const nearCap = state === "near";
  return (
    <header className="flex flex-col">
      {/* As tall as the page bar, with the same line, so the two top edges meet. */}
      <div className="flex h-[65px] items-center justify-between gap-3 border-b border-sidebar-border px-4">
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
            "mx-4 mt-3 rounded-md p-2 text-xs",
            atCap
              ? "bg-destructive/10 text-destructive"
              : "bg-warning/10 ink-warning",
          )}
        >
          {atCap
            ? "You've hit the per-job cap. Remove items before submitting."
            : "Approaching the per-job cap."}
        </div>
      )}
    </header>
  );
}

function BucketBody() {
  const order = useBucketStore((s) => s.order);
  const itemsMap = useBucketStore((s) => s.items);
  const remove = useBucketStore((s) => s.remove);

  const items = order
    .map((k) => itemsMap[k])
    .filter((v): v is BucketItem => Boolean(v));

  if (items.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        The bucket is empty. Add papers from any tab.
      </p>
    );
  }

  return (
    <ul className="w-full space-y-2 px-4 py-4">
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
  );
}

function BucketFooter() {
  const order = useBucketStore((s) => s.order);
  const itemsMap = useBucketStore((s) => s.items);
  const clear = useBucketStore((s) => s.clear);
  const restoreFromSnapshot = useBucketStore((s) => s.restoreFromSnapshot);
  const itemsLength = order.length;

  const readyCount = order.reduce((n, k) => {
    const item = itemsMap[k];
    return item?.status === "ready" ? n + (item.paperCount ?? 1) : n;
  }, 0);

  const handleClearAll = () => {
    const snapshot: AllClearSnapshot = {
      items: { ...itemsMap },
      order: [...order],
    };
    clear();
    bucketCleared(readyCount, snapshot, restoreFromSnapshot);
  };

  return (
    <div className="flex items-center justify-start p-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClearAll}
        disabled={itemsLength === 0}
      >
        Clear all
      </Button>
    </div>
  );
}

export function BucketSidebar({ paperLimit }: { paperLimit?: number }) {
  const isMobile = useIsMobile();
  const hasHydrated = useBucketSidebarStore((s) => s._hasHydrated);
  const isCollapsed = useBucketSidebarStore((s) => s.isCollapsed);
  const toggle = useBucketSidebarStore((s) => s.toggle);
  const readyCount = useReadyCount();
  const limit = paperLimit ?? PAPER_LIMIT;

  const state = capacityState(readyCount, limit);
  const tint = CAPACITY_TINT[state];
  const { expandedWidth, collapsedWidth } =
    getBucketSidebarDimensions(isCollapsed);

  return (
    <PaperSidebarShell
      panelId={PANEL_ID}
      ariaLabel="Staged papers bucket"
      hidden={!hasHydrated || isMobile}
      expandedWidth={expandedWidth}
      collapsedWidth={collapsedWidth}
      collapse={{
        isCollapsed,
        toggle,
        sliverAriaLabel: `Open bucket — ${readyCount} of ${limit} papers staged`,
        sliverTooltip: "Open bucket (⌘⇧B)",
        shortcut: { meta: true, shift: true, key: "b" },
        sliverFooter: (
          <>
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
          </>
        ),
      }}
      header={
        <BucketHeader
          readyCount={readyCount}
          limit={limit}
          state={state}
          tint={tint}
          onCollapse={toggle}
        />
      }
      body={<BucketBody />}
      footer={<BucketFooter />}
    />
  );
}
