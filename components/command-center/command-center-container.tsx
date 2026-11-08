"use client";

import React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";

interface CommandCenterContainerProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Allow children to render past the card's rounded edges. Set this
   * for pages whose descendants use `position: sticky` / `fixed` and
   * need to escape the card's clip box (e.g. JobCreator's bottom-bar
   * footer). The gradient overlay is rounded independently so the
   * card's visual corners remain clean.
   */
  allowOverflow?: boolean;
  /**
   * Its content comes from the server with the page: it rises in CSS from the first paint
   * (rise-enter), where a script's rise would keep it unseen until the page's code loads.
   */
  serverDrawn?: boolean;
}

/**
 * Shared elevated container for command centers (bookmarks, history, search).
 * Provides consistent styling with a subtle gradient overlay.
 */
export function CommandCenterContainer({
  children,
  className,
  allowOverflow = false,
  serverDrawn = false,
}: CommandCenterContainerProps) {
  const Box = serverDrawn ? "div" : motion.div;
  const rise = serverDrawn ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: subtleSpring };
  return (
    <Box
      {...rise}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={subtleSpring}
      className={cn(
        serverDrawn && "rise-enter",
        "relative rounded-2xl",
        allowOverflow ? "overflow-visible" : "overflow-clip",
        "bg-card",
        "border border-border-subtle",
        "shadow-surface",
        className
      )}
    >
      {/* Subtle gradient overlay — rounded independently so the card
          corners stay clean even when the parent isn't clipping. */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />
      {children}
    </Box>
  );
}
