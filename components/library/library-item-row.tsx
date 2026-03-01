"use client";

import { useTranslations } from "next-intl";
import { Star, MoreHorizontal, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { OA_STATUS_COLORS } from "@/lib/constants";
import type { Doc } from "@/convex/_generated/dataModel";

interface LibraryItemRowProps {
  item: Doc<"libraryItems">;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRemove: (item: Doc<"libraryItems">) => void;
}

export function LibraryItemRow({
  item,
  isExpanded,
  onToggleExpand,
  onRemove,
}: LibraryItemRowProps) {
  const t = useTranslations("libraryPage");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleExpand();
    }
  };

  const handleMenuTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleMenuTriggerKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
  };

  const doiUrl = item.doi
    ? item.doi.startsWith("http")
      ? item.doi
      : `https://doi.org/${item.doi}`
    : null;

  return (
    <div className="border-b border-border/40 last:border-b-0">
      {/* Compact row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
          "hover:bg-sidebar-accent/40 dark:hover:bg-sidebar-accent/20",
          isExpanded && "bg-sidebar-accent/30 dark:bg-sidebar-accent/15",
        )}
      >
        {/* Rating stars (display-only, compact) */}
        <div className="flex items-center gap-px shrink-0">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              className={cn(
                "h-3 w-3",
                s <= item.rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/25",
              )}
            />
          ))}
        </div>

        {/* Title */}
        <span className="text-sm font-medium truncate min-w-0 flex-1">
          {item.title}
        </span>

        {/* Authors */}
        {item.authors && (
          <span className="text-xs text-muted-foreground truncate max-w-[150px] hidden sm:block">
            {item.authors}
          </span>
        )}

        {/* Publication year */}
        {item.publicationYear && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:block">
            {item.publicationYear}
          </span>
        )}

        {/* Journal */}
        {item.journal && (
          <span className="text-xs text-muted-foreground truncate max-w-[120px] hidden md:block">
            {item.journal}
          </span>
        )}

        {/* Citations */}
        {item.citedByCount !== undefined && item.citedByCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 hidden md:block">
            {t("citations", { count: item.citedByCount })}
          </span>
        )}

        {/* OA badge */}
        {item.oaStatus && item.oaStatus !== "closed" && OA_STATUS_COLORS[item.oaStatus] && (
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 hidden lg:inline-flex",
              OA_STATUS_COLORS[item.oaStatus],
            )}
          >
            {item.oaStatus}
          </span>
        )}

        {/* Three-dot menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleMenuTriggerClick}
              onKeyDown={handleMenuTriggerKeyDown}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item);
              }}
              className="text-destructive focus:text-destructive"
            >
              {t("removeFromLibrary")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 space-y-2">
              {/* Mobile-only metadata */}
              <div className="flex flex-wrap items-center gap-2 sm:hidden text-xs text-muted-foreground">
                {item.authors && <span>{item.authors}</span>}
                {item.publicationYear && <span>{item.publicationYear}</span>}
                {item.journal && <span>{item.journal}</span>}
                {item.citedByCount !== undefined && item.citedByCount > 0 && (
                  <span>{t("citations", { count: item.citedByCount })}</span>
                )}
                {item.oaStatus && item.oaStatus !== "closed" && OA_STATUS_COLORS[item.oaStatus] && (
                  <span
                    className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                      OA_STATUS_COLORS[item.oaStatus],
                    )}
                  >
                    {item.oaStatus}
                  </span>
                )}
              </div>

              {item.abstract && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.abstract}
                </p>
              )}
              {doiUrl && (
                <a
                  href={doiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("viewFullPaper")}
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
