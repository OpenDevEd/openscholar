"use client";

/**
 * Query Evolution Component
 * Displays query history as an expandable mini-list in the sidebar tooltip
 * Matches sidebar's minimal, subtle aesthetic
 */

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/format";
import { ChevronRight, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { QueryHistoryEntry } from "@/lib/types/search.types";
import { QueryText } from "@/components/ui/query-text";

interface QueryEvolutionProps {
  queryHistory: QueryHistoryEntry[];
  currentQuery: string;
  className?: string;
}

/**
 * Truncates a query string for display
 */
function truncateQuery(query: string, maxLength: number = 20): string {
  if (query.length <= maxLength) return query;
  return query.slice(0, maxLength) + "...";
}

/**
 * QueryEvolution - Expandable query history display
 * 
 * Collapsed: Shows a preview of query progression
 * Expanded: Shows full timeline with timestamps
 */
export function QueryEvolution({
  queryHistory,
  currentQuery,
  className,
}: QueryEvolutionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render if there's only one or no queries
  if (!queryHistory || queryHistory.length <= 1) {
    return null;
  }

  // Get queries in reverse chronological order (newest first)
  const sortedHistory = [...queryHistory].reverse();
  const previewQueries = sortedHistory.slice(1, 3);
  const remainingCount = sortedHistory.length - 2;

  return (
    <div className={cn("pt-2 border-t border-border/30", className)}>
      {/* Collapsed Preview / Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-start gap-1.5 text-left group",
          "hover:bg-muted/30 -mx-1 px-1 py-0.5 rounded transition-colors"
        )}
      >
        <motion.span
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="mt-0.5 text-muted-foreground/60"
        >
          <ChevronRight className="h-3 w-3" />
        </motion.span>

        {isExpanded ? (
          <span className="text-[10px] text-muted-foreground font-medium">
            Query Evolution
          </span>
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-1 text-[10px] text-muted-foreground">
            {previewQueries.map((entry, idx) => (
              <React.Fragment key={idx}>
                <span className="truncate max-w-[80px]" title={entry.query}>
                  "{truncateQuery(entry.query, 15)}"
                </span>
                {idx < previewQueries.length - 1 && (
                  <span className="text-muted-foreground/40 shrink-0 rotate-180">→</span>
                )}
              </React.Fragment>
            ))}
            {remainingCount > 0 && (
              <span className="text-muted-foreground/60 shrink-0">
                +{remainingCount}
              </span>
            )}
          </div>
        )}
      </button>

      {/* Expanded Timeline */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 ml-1.5 pl-4 space-y-1.5">
              {sortedHistory.map((entry, idx) => {
                const isCurrent = entry.query === currentQuery;
                const isLast = idx === sortedHistory.length - 1;
                
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className={cn(
                      "relative flex items-start gap-2",
                      // Dot - centered at -8px from item edge
                      "before:absolute before:-left-2 before:top-1.5",
                      "before:w-1.5 before:h-1.5 before:-translate-x-1/2 before:rounded-full before:z-10",
                      isCurrent
                        ? "before:bg-foreground"
                        : "before:bg-muted-foreground"
                    )}
                  >
                    {/* Connecting line to next dot - starts at current dot center, ends at next dot center */}
                    {!isLast && (
                      <div className="absolute -left-2 top-[9px] bottom-[-15px] w-px bg-border/40 -translate-x-1/2" />
                    )}
                    <div className="flex-1 min-w-0">
                      <QueryText 
                        query={entry.query}
                        className={cn(
                          "text-[10px] break-words leading-relaxed",
                          isCurrent && "font-medium"
                        )}
                      />
                      <span className="text-[9px] pl-2 text-muted-foreground/50">
                        {formatTimeAgo(entry.timestamp)}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
