"use client";

// The pieces of a "?" beside a label: a small button that opens what the label means, where the page
// would otherwise explain itself in a sentence. A report's details (components/reports/field-help.tsx)
// and the screening pages build their help from these, so a "?" looks and opens the same everywhere.

import type { ComponentProps, ReactNode } from "react";
import { CircleHelp, type AppIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The "?" button. Give it an `aria-label` that says what it explains, such as "About Criteria". */
export function HelpButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="ghost" size="icon-xs" {...props} className={cn("-my-1 size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-primary", className)}>
      <CircleHelp className="size-3.5" />
    </Button>
  );
}

/** The popover a "?" opens. On a phone it is never wider than the window: 20rem is, on a narrow one and at large text. */
export const HELP_POPOVER = "w-80 p-0 font-normal text-foreground max-sm:max-w-(--radix-popover-content-available-width)";

/** A fact in a "?"'s popover, as a small chip. */
export function HelpFact({ icon: Icon, children }: { icon?: AppIcon; children: ReactNode }) {
  return (
    // One line high when it fits, and taller when its words wrap: the box always holds its text, and the icon stays on the first line.
    <span className="inline-flex min-h-6 max-w-full items-start gap-1.5 rounded-md bg-inset px-2 py-1 text-xs leading-4 font-medium">
      {Icon ? <Icon className="mt-px size-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">{children}</span>
    </span>
  );
}
