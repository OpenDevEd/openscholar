"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sidebarSpring, hoverSpring } from "@/lib/ui/sidebar-motion";

interface ShortcutCombo {
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  /** Key as compared via .toLowerCase() === key */
  key: string;
}

interface CollapseConfig {
  isCollapsed: boolean;
  toggle: () => void;
  /** A11y label for the sliver button (e.g. "Open bucket"). */
  sliverAriaLabel: string;
  /** Tooltip text for the sliver button. */
  sliverTooltip: string;
  /** Extra content rendered below the sliver button (count badge, icon). */
  sliverFooter?: ReactNode;
  /** Optional keyboard shortcut to toggle collapse. Esc-to-collapse-when-open is always on. */
  shortcut?: ShortcutCombo;
}

interface PaperSidebarShellProps {
  /** Used for aria-controls + the rendered panel id. */
  panelId: string;
  /** ARIA region label for the panel (e.g. "Staged papers bucket"). */
  ariaLabel: string;
  /** When true, render nothing (e.g. mobile or pre-hydration). */
  hidden?: boolean;
  /** Expanded panel width in px. */
  expandedWidth: number;
  /** Collapsed sliver width in px. */
  collapsedWidth: number;
  /** Collapse behavior. Omit to render an always-expanded sidebar without sliver. */
  collapse?: CollapseConfig;
  /** Header — owns its own padding + border-bottom. The caller renders any collapse button inside. */
  header: ReactNode;
  /** Body — rendered inside a scroll container. */
  body: ReactNode;
  /** Optional footer — renders with a top border. */
  footer?: ReactNode;
  /** Extra className on the outermost wrapper. */
  className?: string;
}

/**
 * Right-side sidebar visual shell shared by the bucket sidebar (job
 * creator) and the chat papers-in-context sidebar. Owns the
 * motion.aside slide animation, the collapsed-state sliver, the
 * keyboard shortcut, the hydration/mobile gate, and the layout glue.
 *
 * Each consumer brings its own header / body / footer content, plus
 * its own collapse store + dimensions. No bucket-specific logic
 * (capacity meter, Clear-all, Zustand) lives here.
 */
export function PaperSidebarShell({
  panelId,
  ariaLabel,
  hidden,
  expandedWidth,
  collapsedWidth,
  collapse,
  header,
  body,
  footer,
  className,
}: PaperSidebarShellProps) {
  const sliverRef = useRef<HTMLButtonElement>(null);
  const isCollapsed = collapse?.isCollapsed ?? false;

  // Collapse keyboard shortcut (e.g. ⌘⇧B). No-op when collapse is unset.
  const shortcut = collapse?.shortcut;
  const toggle = collapse?.toggle;
  useEffect(() => {
    if (!toggle || !shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (shortcut.meta && !(e.metaKey || e.ctrlKey)) return;
      if (shortcut.ctrl && !e.ctrlKey) return;
      if (shortcut.shift && !e.shiftKey) return;
      if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, shortcut]);

  // Esc-to-collapse-when-open. Only active when the sidebar is expanded
  // *and* collapsing is supported.
  useEffect(() => {
    if (!toggle || isCollapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't hijack Esc when the user is typing somewhere — let inputs
      // handle their own dismissal.
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      toggle();
      requestAnimationFrame(() => sliverRef.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, isCollapsed]);

  if (hidden) return null;

  // Right-side sidebar: motion.aside anchors to the LEFT edge of its
  // slot and slides RIGHT by (expanded - collapsed) when collapsing,
  // hiding itself entirely past the right viewport edge. The sliver
  // (separate element) lives at the slot's left edge and is always
  // visible when collapsed. Mirrors filter-sidebar's pattern but
  // reflected for right-side mounting.
  const translateX = isCollapsed ? expandedWidth - collapsedWidth : 0;

  return (
    <div
      className={cn("relative h-full overflow-hidden", className)}
      data-sidebar-shell="true"
      data-collapsed={isCollapsed ? "true" : "false"}
      style={{
        width: isCollapsed ? collapsedWidth : expandedWidth,
        transition: `width ${sidebarSpring.stiffness}ms ease-out`,
      }}
    >
      <motion.aside
        id={panelId}
        role="complementary"
        aria-label={ariaLabel}
        className={cn(
          "absolute bottom-0 left-0 top-0 flex h-full flex-col overflow-hidden",
          "bg-background/95 dark:bg-background/90",
          "border-l border-border/50",
        )}
        initial={false}
        animate={{ x: translateX }}
        transition={sidebarSpring}
        style={{ width: expandedWidth }}
      >
        <section
          aria-label={ariaLabel}
          className="flex h-full flex-col"
          data-sidebar-panel="true"
        >
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {body}
          </div>
          {footer ? (
            <footer className="border-t border-border/50">{footer}</footer>
          ) : null}
        </section>
      </motion.aside>

      {collapse ? (
        <AnimatePresence>
          {isCollapsed ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "absolute bottom-0 left-0 top-0 z-20 flex flex-col items-center gap-3 py-4",
                "bg-background/95 dark:bg-background/90",
                "border-l border-border/50",
              )}
              style={{ width: collapsedWidth }}
              data-sidebar-sliver="true"
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
                      onClick={collapse.toggle}
                      aria-expanded={false}
                      aria-controls={panelId}
                      aria-label={collapse.sliverAriaLabel}
                      className="h-9 w-9 shadow-sm"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                    </Button>
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {collapse.sliverTooltip}
                </TooltipContent>
              </Tooltip>
              {collapse.sliverFooter}
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </div>
  );
}
