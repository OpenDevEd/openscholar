"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { getIdColor } from "@/lib/format";
import type { SearchResult } from "@/lib/types/search.types";
import { SearchTooltipContent } from "@/components/search-tooltip-content";
import { motion, AnimatePresence } from "motion/react";
import { countActiveFilters, type FilterParams } from "@/lib/filters";
import { QueryText } from "@/components/ui/query-text";
import { useLocale, useFormatter, useNow } from "next-intl";

// Spring animation config consistent with sidebar
const springConfig = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
};

// Layout animation config - no bounce, critically damped
const layoutConfig = {
  type: "spring" as const,
  stiffness: 200,
  damping: 100,
  mass: 1,
};

interface SearchHistoryTabProps {
  id: string;
  searchId: string;
  query: string;
  count: number;
  filters: FilterParams;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  isCollapsed: boolean;
  /** The search, for its query history in the tooltip. */
  search?: SearchResult;
  onClick?: () => void;
  index?: number;
}

export function SearchHistoryTab({
  id,
  searchId,
  query,
  count,
  filters,
  createdAt,
  updatedAt,
  isActive,
  isCollapsed,
  search,
  onClick,
  index = 0,
}: SearchHistoryTabProps) {
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow();
  const idColor = getIdColor(searchId);
  const timeAgo = format.relativeTime(new Date(createdAt), now);

  // Use shared filter counting logic
  const totalCount = countActiveFilters(filters);

  const buttonContent = (
    <motion.div
      className="w-full overflow-hidden"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.2,
        delay: index * 0.04,
        ease: [0.32, 0.72, 0, 1]
      }}
    >
      <Button
        variant="ghost"
        {...(onClick && { onClick })}
        className={cn(
          "group relative flex w-full overflow-hidden",
          "hover:bg-sidebar-accent transition-colors duration-200",
          isActive && "bg-sidebar-accent/80",
          isCollapsed
            ? "flex-col items-center justify-center px-2 py-1.5 gap-1 h-auto"
            : "flex-row items-center px-3 py-1.5 gap-1.5 h-auto",
          isActive && "nav-active"
        )}
      >
        <AnimatePresence>
          {isActive && !isCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gradient-to-r from-[oklch(0.70_0.17_54)] to-transparent pointer-events-none"
            />
          )}
        </AnimatePresence>
        
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-1 relative z-10">
            <motion.span
              layoutId={`count-badge-${searchId}`}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="text-[9px] px-1 py-0.5 rounded-full shrink-0 font-medium badge-glow"
              style={{
                backgroundColor: idColor.bg,
                color: idColor.text,
                border: `1px solid ${idColor.border}`,
                borderRadius: '9999px'
              }}
            >
              {format.number(count, count >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : undefined)}
            </motion.span>
          </div>
        ) : (
          <motion.div 
            className="flex items-center w-full gap-1.5 min-w-0 overflow-hidden text-left relative z-10"
            whileHover={{ x: 2 }}
            whileTap={{ x: 1, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            <QueryText 
              query={query}
              className="truncate text-xs font-medium flex-1 w-0 min-w-0 text-left transition-colors duration-200"
            />
            <AnimatePresence>
              {totalCount > 0 && (
                <motion.span
                  key={`filter-count-${searchId}`}
                  layoutId={`filter-count-${searchId}`}
                  className="text-[9px] px-1 py-0.5 rounded shrink-0 font-medium opacity-60"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 0.6, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={springConfig}
                >
                  {totalCount}
                </motion.span>
              )}
            </AnimatePresence>
            <motion.span
              layoutId={`count-badge-${searchId}`}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="text-[9px] px-1 py-0.5 rounded-full shrink-0 font-medium badge-glow"
              style={{
                backgroundColor: idColor.bg,
                color: idColor.text,
                border: `1px solid ${idColor.border}`,
                borderRadius: '9999px'
              }}
            >
              {format.number(count, count >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : undefined)}
            </motion.span>
          </motion.div>
        )}
      </Button>
    </motion.div>
  );

  return (
    <Tooltip delayDuration={isCollapsed ? 0 : 300}>
      <TooltipTrigger asChild>
        {buttonContent}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="w-80 bg-background text-foreground border shadow-lg p-0 max-h-96 overflow-y-auto"
        arrowClassName="bg-background fill-background"
      >
        <div className="p-3">
          <SearchTooltipContent
            id={id || searchId}
            query={query}
            count={count}
            filters={filters}
            createdAt={createdAt}
            updatedAt={updatedAt || createdAt}
            search={search}
          />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}