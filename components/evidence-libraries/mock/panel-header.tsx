"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Same look as `CommandCenterHeader` (icon tile, title, description) but with a
 * free right-hand slot for actions instead of the fixed count pill.
 */
export function PanelHeader({
  icon: Icon,
  title,
  description,
  eyebrow,
  children,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Small mono line under the description, such as a public address. */
  eyebrow?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative px-4 md:px-6 py-5 border-b border-border/40", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          <div className="relative shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 shadow-sm md:h-12 md:w-12">
              <Icon className="h-5 w-5 text-primary md:h-6 md:w-6" />
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground md:text-2xl">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
            {eyebrow ? (
              <p className="mt-0.5 text-xs font-mono text-muted-foreground">{eyebrow}</p>
            ) : null}
          </div>
        </div>
        {children ? (
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
