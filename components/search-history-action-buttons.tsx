"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Copy, BookmarkPlus, Search, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchHistoryActionButtonsProps {
  query: string;
  searchId?: string;
  index?: number;
  variant?: "compact" | "full";
  isLoading?: boolean;
  canDelete?: boolean;
  onCopy: (query: string) => void;
  onBookmark: (index: number) => void;
  onSearch: (query: string) => void;
  onDelete?: (index: number, query: string) => void;
  className?: string;
}

export function SearchHistoryActionButtons({
  query,
  index,
  variant = "compact",
  isLoading = false,
  canDelete = true,
  onCopy,
  onBookmark,
  onSearch,
  onDelete,
  className,
}: SearchHistoryActionButtonsProps) {
  const ta = useTranslations("accessibility");

  return (
    <div
      className={cn(
        "flex items-center gap-1 transition-opacity duration-200",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "text-muted-foreground hover:text-primary hover:bg-primary/10",
          variant === "compact" ? "h-7 w-7" : "h-8 w-8"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onCopy(query);
        }}
        title={ta("copyQuery")}
      >
        <Copy className={cn(variant === "compact" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "text-muted-foreground hover:text-amber-600 hover:bg-amber-50",
          variant === "compact" ? "h-7 w-7" : "h-8 w-8"
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (index !== undefined) onBookmark(index);
        }}
        disabled={!query.trim()}
        title={ta("saveAsBookmark")}
      >
        <BookmarkPlus className={cn(variant === "compact" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "text-muted-foreground hover:text-primary hover:bg-primary/10",
          variant === "compact" ? "h-7 w-7" : "h-8 w-8"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSearch(query);
        }}
        disabled={isLoading}
        title={ta("searchWithQuery")}
      >
        {isLoading ? (
          <Loader2 className={cn("animate-spin", variant === "compact" ? "h-3 w-3" : "h-3.5 w-3.5")} />
        ) : (
          <Search className={cn(variant === "compact" ? "h-3 w-3" : "h-3.5 w-3.5")} />
        )}
      </Button>

      {canDelete && onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
            variant === "compact" ? "h-7 w-7" : "h-8 w-8"
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (index !== undefined) onDelete(index, query);
          }}
          title={ta("removeFromHistory")}
        >
          <Trash2 className={cn(variant === "compact" ? "h-3 w-3" : "h-3.5 w-3.5")} />
        </Button>
      )}
    </div>
  );
}
