"use client";

import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { cn } from "@/lib/utils";

/** The icon tile at the start of a list row. */
export const LIST_TILE =
  "flex size-10 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-inset text-primary";

/**
 * Toolbar filters sit quietly on the card instead of looking like form fields.
 * Every filter shares the search box's small text. A select's value takes the
 * free space, so a wide select still reads from the left.
 */
export const LIST_FILTER = "border-transparent bg-inset text-xs shadow-none md:text-xs *:data-[slot=select-value]:flex-1";

/**
 * The view switch at the top of a list card. A count shows only once it is
 * known and fades in, so a loading list never says 0.
 */
export function ListViewTabs<T extends string>({ label, value, onChange, tabs }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  /** `count` null: still being read, its place held so the tab doesn't widen when it arrives. */
  tabs: { value: T; label: ReactNode; icon: ReactNode; count?: ReactNode | null }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {tabs.map((tab) => (
        <Button
          key={tab.value}
          size="sm"
          variant="ghost"
          aria-pressed={value === tab.value}
          className={cn("h-auto min-h-8 shrink gap-2 whitespace-normal py-1 text-muted-foreground", value === tab.value && "bg-muted text-foreground")}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon}
          {tab.label}
          {tab.count === null ? <span aria-hidden className="invisible text-xs tabular-nums">0</span>
            : tab.count !== undefined && <span className="fade-enter text-xs tabular-nums text-muted-foreground">{tab.count}</span>}
        </Button>
      ))}
    </div>
  );
}

export function ListSearch({ className, box, ...props }: ComponentProps<typeof Input> & { /** Where the box sits in its row: its width and how it grows. */ box?: string }) {
  return (
    <div className={cn("relative", box)}>
      <Search aria-hidden className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input className={cn("h-8 w-44 ps-8 text-xs", LIST_FILTER, className)} {...props} />
    </div>
  );
}

// Loading and empty share one frame, so a list does not jump when loading ends.
const LIST_STATE = {
  regular: "flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center",
  compact: "flex min-h-32 flex-col items-center justify-center gap-2 p-4 text-center",
};

export function ListLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={LIST_STATE[compact ? "compact" : "regular"]}>
      <Spinner aria-label={label} className={compact ? "size-5 text-primary" : "size-6 text-primary"} />
    </div>
  );
}

/** Two lines' lengths for each placeholder row, so a column of them reads as a list and not as one block. */
const ROW_LINES = [["w-2/5", "w-1/4"], ["w-1/2", "w-1/5"], ["w-1/3", "w-1/4"], ["w-3/5", "w-1/6"]] as const;

/**
 * A list's rows while they load, in the place the rows will take: as many as will come and each a real row's height,
 * so the rows replace them without the list moving. `icon` draws the square a row starts with.
 */
export function ListRowsSkeleton({ rows, height, label, icon = true, className }: { rows: number; height: number; label: string; icon?: boolean; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("divide-y divide-border-subtle", className)}>
      {Array.from({ length: rows }, (_, at) => (
        <div key={at} style={{ height }} className="flex items-center gap-3 px-4">
          {icon ? <SkeletonBar className="size-8 shrink-0 rounded-lg" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className={ROW_LINES[at % ROW_LINES.length]![0]} />
            <SkeletonBar className={cn("h-2.5", ROW_LINES[at % ROW_LINES.length]![1])} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** What a list says when it has nothing to show, in the same frame as its loading state. */
export function ListEmpty({ icon: Icon, children, description, action, compact = false }: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn(LIST_STATE[compact ? "compact" : "regular"], "fade-enter")}>
      <div aria-hidden className={cn("flex items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 text-primary ring-1 ring-primary/10", compact ? "size-9" : "size-11")}>
        <Icon className={compact ? "size-4" : "size-5"} />
      </div>
      <div className="max-w-sm space-y-1">
        <p className={cn("text-sm", description ? "font-medium text-foreground" : "text-muted-foreground")}>{children}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
