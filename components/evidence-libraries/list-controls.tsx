"use client";

import type { ComponentProps, ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The icon tile at the start of a list row. */
export const LIST_TILE =
  "flex size-10 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/30 text-primary";

/** Toolbar filters sit quietly on the card instead of looking like form fields. */
export const LIST_FILTER = "border-transparent bg-muted/40 shadow-none";

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
