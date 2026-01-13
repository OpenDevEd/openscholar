"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { FileText, Clock, Globe } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { formatNumber, formatTimeAgo, getIdColor } from "@/lib/format";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { CountryFlag } from "@/components/ui/country-flag";
import { COUNTRIES } from "@/lib/constants";
import { motion, AnimatePresence } from "motion/react";

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
  searchId: string;
  query: string;
  count: number;
  field?: string;
  dateRange?: DateRange;
  yearRange?: [number, number];
  selectedRegions?: string[];
  language?: string;
  createdAt: string;
  isActive: boolean;
  isCollapsed: boolean;
  onClick?: () => void;
}

export function SearchHistoryTab({
  searchId,
  query,
  count,
  field,
  dateRange,
  yearRange,
  selectedRegions,
  language,
  createdAt,
  isActive,
  isCollapsed,
  onClick,
}: SearchHistoryTabProps) {
  const idColor = getIdColor(searchId);
  const timeAgo = formatTimeAgo(createdAt);
  const truncatedQuery = query.length > 40 ? query.slice(0, 40) + "..." : query;

  const getFilterBadges = () => {
    const badges: {
      type: 'field' | 'date' | 'regions' | 'language';
      icon: React.ComponentType<{ className?: string }> | null;
      content?: string;
      countries?: string[];
      countryCount?: number;
    }[] = [];

    if (field) {
      badges.push({
        type: 'field',
        icon: FileText,
        content: field
      });
    }

    if (yearRange && yearRange[0] !== yearRange[1]) {
      badges.push({
        type: 'date',
        icon: Clock,
        content: `${yearRange[0]}-${yearRange[1]}`
      });
    } else if (dateRange?.from) {
      const from = format(dateRange.from, "MMM yyyy");
      const to = dateRange.to ? format(dateRange.to, "MMM yyyy") : "now";
      badges.push({
        type: 'date',
        icon: Clock,
        content: `${from}-${to}`
      });
    }

    if (selectedRegions && selectedRegions.length > 0) {
      const countries = selectedRegions.filter(id => id.length === 2 && COUNTRIES[id]).slice(0, 2);
      if (countries.length > 0) {
        badges.push({
          type: 'regions',
          icon: null,
          countries,
          countryCount: selectedRegions.filter(id => id.length === 2 && COUNTRIES[id]).length
        });
      }
    }

    if (language) {
      badges.push({
        type: 'language',
        icon: Globe,
        content: language.toUpperCase()
      });
    }

    return {
      visibleBadges: badges.slice(0, 2), // Reduced from 3 to 2
      overflowCount: Math.max(0, badges.length - 2),
      totalCount: badges.length
    };
  };

  const { visibleBadges, overflowCount, totalCount } = getFilterBadges();

  // Build detailed tooltip content
  const getTooltipContent = () => {
    const filterDetails: string[] = [];
    
    if (field) {
      filterDetails.push(`Field: ${field}`);
    }
    if (yearRange && yearRange[0] !== yearRange[1]) {
      filterDetails.push(`Year: ${yearRange[0]}-${yearRange[1]}`);
    } else if (dateRange?.from) {
      const from = format(dateRange.from, "MMM dd, yyyy");
      const to = dateRange.to ? format(dateRange.to, "MMM dd, yyyy") : "now";
      filterDetails.push(`Date: ${from} - ${to}`);
    }
    if (selectedRegions && selectedRegions.length > 0) {
      const countryCount = selectedRegions.filter(id => id.length === 2 && COUNTRIES[id]).length;
      filterDetails.push(`Regions: ${countryCount} countr${countryCount > 1 ? 'ies' : 'y'}`);
    }
    if (language) {
      filterDetails.push(`Language: ${language.toUpperCase()}`);
    }

    return {
      fullQuery: query,
      timeAgo,
      filterDetails,
      totalCount
    };
  };

  const tooltipInfo = getTooltipContent();

  const buttonContent = (
    <Button
      variant="ghost"
      {...(onClick && { onClick })}
      className={cn(
        "group relative flex w-full overflow-hidden",
        "hover:bg-sidebar-accent transition-colors duration-200",
        isActive && "bg-sidebar-accent/70",
        isCollapsed 
          ? "flex-col items-center justify-center px-2 py-1.5 gap-1 h-auto" 
          : "flex-row items-center px-2 py-1.5 gap-1.5 h-auto"
      )}
    >
      {isCollapsed ? (
        <div className="flex flex-col items-center gap-1">
          <motion.span
            layoutId={`count-badge-${searchId}`}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="text-[9px] px-1 py-0.5 rounded-full shrink-0 font-medium"
            style={{
              backgroundColor: idColor.bg,
              color: idColor.text,
              border: `1px solid ${idColor.border}`,
              borderRadius: '9999px'
            }}
          >
            {formatNumber(count)}
          </motion.span>
        </div>
      ) : (
        <div className="flex items-center w-full gap-1.5 min-w-0 text-left">
          <span 
            className="truncate text-xs font-medium text-sidebar-foreground flex-1 min-w-0 text-left"
          >
            {truncatedQuery}
          </span>
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
            className="text-[9px] px-1 py-0.5 rounded-full shrink-0 font-medium"
            style={{
              backgroundColor: idColor.bg,
              color: idColor.text,
              border: `1px solid ${idColor.border}`,
              borderRadius: '9999px'
            }}
          >
            {formatNumber(count)}
          </motion.span>
        </div>
      )}
    </Button>
  );

  // Wrap in tooltip for expanded state to show details on hover
  if (!isCollapsed) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          {buttonContent}
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="space-y-1.5">
            <p className="font-medium text-sm break-words">{tooltipInfo.fullQuery}</p>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {formatNumber(count)} results • {tooltipInfo.timeAgo}
              </p>
              {tooltipInfo.filterDetails.length > 0 && (
                <div className="pt-1 border-t border-border/50">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Filters:</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {tooltipInfo.filterDetails.map((detail, idx) => (
                      <li key={idx}>• {detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Collapsed state tooltip
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        {buttonContent}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <div className="space-y-1.5">
          <p className="font-medium text-sm">{query}</p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(count)} results{totalCount > 0 ? ` • ${totalCount} filter${totalCount > 1 ? 's' : ''}` : ''} • {timeAgo}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}