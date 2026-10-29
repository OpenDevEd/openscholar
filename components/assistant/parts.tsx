"use client";

// Small pieces the assistant's panel and its sheets share.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Text that AI Elements' shimmer sweeps across while work runs. It holds still when motion is
 * reduced. Inline, so a line it's in still ends in an ellipsis when it's cut.
 */
export function WorkingText({ children }: { children: string }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <span className="text-muted-foreground">{children}</span>;
  return (
    <Shimmer as="span" duration={1.4} className="inline">
      {children}
    </Shimmer>
  );
}

export function IconButton({ label, shortcut, icon, onClick, small }: { label: string; shortcut?: string; icon: ReactNode; onClick?: () => void; small?: boolean }) {
  return (
    <TooltipHint label={shortcut ? `${label}  ${shortcut}` : label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn("flex shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground", small ? "size-7" : "size-8")}
      >
        {icon}
      </button>
    </TooltipHint>
  );
}

