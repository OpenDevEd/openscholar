"use client";

import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** The icon tile at the start of a list row. */
export const LIST_TILE =
  "flex size-10 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/30 text-primary";

/**
 * Toolbar filters sit quietly on the card instead of looking like form fields.
 * A select's value takes the free space, so a wide select still reads from the left.
 */
export const LIST_FILTER = "border-transparent bg-muted/40 shadow-none *:data-[slot=select-value]:flex-1";

/**
 * The view switch at the top of a list card. A count shows only once it is
 * known and fades in, so a loading list never says 0.
 */
export function ListViewTabs<T extends string>({ label, value, onChange, tabs }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: ReactNode; icon: ReactNode; count?: ReactNode }[];
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {tabs.map((tab) => (
        <Button
          key={tab.value}
          size="sm"
          variant="ghost"
          aria-pressed={value === tab.value}
          className={cn("gap-2 text-muted-foreground", value === tab.value && "bg-muted text-foreground")}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && <span className="fade-enter text-xs tabular-nums text-muted-foreground">{tab.count}</span>}
        </Button>
      ))}
    </div>
  );
}

export function ListSearch({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Search aria-hidden className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input className={cn("h-8 w-44 pl-8 text-xs", LIST_FILTER, className)} {...props} />
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
