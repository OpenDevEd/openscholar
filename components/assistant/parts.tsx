"use client";

// Small pieces the assistant's panel and its sheets share.

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Text that a light sweeps across while work runs. It never drops below the muted
 * text colour, so the words stay readable mid-sweep; it holds still when motion is reduced.
 */
export function WorkingText({ children }: { children: string }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <span className="text-muted-foreground">{children}</span>;
  return (
    <motion.span
      className="bg-[linear-gradient(90deg,var(--muted-foreground)_0%,var(--muted-foreground)_38%,var(--foreground)_50%,var(--muted-foreground)_62%,var(--muted-foreground)_100%)] bg-[length:250%_100%] bg-clip-text text-transparent"
      animate={{ backgroundPosition: ["100% 0%", "-150% 0%"] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
    >
      {children}
    </motion.span>
  );
}

export function IconButton({ label, shortcut, icon, onClick, small }: { label: string; shortcut?: string; icon: ReactNode; onClick?: () => void; small?: boolean }) {
  return (
    <TooltipHint label={shortcut ? `${label}  ${shortcut}` : label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn("flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground", small ? "size-7" : "size-8")}
      >
        {icon}
      </button>
    </TooltipHint>
  );
}
