"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface SearchHistoryTabProps {
  searchId: string;
  query: string;
  count: number;
  isActive: boolean;
  isCollapsed: boolean;
  onClick?: () => void;
}

export function SearchHistoryTab({
  searchId,
  query,
  count,
  isActive,
  isCollapsed,
  onClick,
}: SearchHistoryTabProps) {
  const truncatedQuery = query.length > 30 ? query.slice(0, 30) + "..." : query;

  const content = (
    <Button
      variant="ghost"
      {...(onClick && { onClick })}
      className={cn(
        "group relative flex items-center transition-all duration-200 w-full",
        "hover:bg-sidebar-accent",
        isActive && "bg-sidebar-accent/70",
        isCollapsed ? "justify-center p-3 h-12" : "px-3 py-2.5 gap-3 h-auto"
      )}
    >
      {/* Active indicator - vertical bar on left side for expanded state */}
      {isActive && !isCollapsed && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full" />
      )}

      {/* Active indicator - dot for collapsed state */}
      {isActive && isCollapsed && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary rounded-full" />
      )}

      {/* Search icon */}
      <Search className={cn(
        "flex-shrink-0 transition-colors",
        isCollapsed ? "h-5 w-5" : "h-4 w-4",
        isActive ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"
      )} />

      {/* Query text (expanded state only) */}
      {!isCollapsed && (
        <>
          <span className="flex-1 truncate text-sm text-sidebar-foreground">
            {truncatedQuery}
          </span>
          
          {/* Count badge */}
          <span className={cn(
            "text-xs px-2 py-0.5 rounded-full shrink-0",
            isActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}>
            {count}
          </span>
        </>
      )}
    </Button>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{query}</p>
            <p className="text-xs text-muted-foreground">{count} results</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
