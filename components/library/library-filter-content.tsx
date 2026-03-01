"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Star, Calendar, Hash, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FilterSection } from "@/components/shared/filter-section";
import { cn } from "@/lib/utils";
import { LibrarySearchBar } from "./library-search-bar";

interface LibraryFilterContentProps {
  rawSearch: string;
  onSearchChange: (value: string) => void;
  minRating: number | undefined;
  onMinRatingChange: (rating: number | undefined) => void;
  savedPreset: string | null;
  onSavedPresetChange: (preset: string | null) => void;
  yearFrom: number | null;
  yearTo: number | null;
  onYearFromChange: (year: number | null) => void;
  onYearToChange: (year: number | null) => void;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  collections:
    | Array<{ _id: string; name: string; itemCount: number }>
    | undefined;
  onManageCollections: () => void;
  isMobile: boolean;
}

export function LibraryFilterContent({
  rawSearch,
  onSearchChange,
  minRating,
  onMinRatingChange,
  savedPreset,
  onSavedPresetChange,
  yearFrom,
  yearTo,
  onYearFromChange,
  onYearToChange,
  collectionId,
  onCollectionChange,
  collections,
  onManageCollections,
  isMobile,
}: LibraryFilterContentProps) {
  const t = useTranslations("libraryPage");

  // Local year range state (commit on blur)
  const [localYearFrom, setLocalYearFrom] = useState(
    yearFrom?.toString() ?? ""
  );
  const [localYearTo, setLocalYearTo] = useState(yearTo?.toString() ?? "");
  const yearFromRef = useRef<HTMLInputElement>(null);
  const yearToRef = useRef<HTMLInputElement>(null);

  // Keep local state in sync with URL params when they change externally
  useEffect(() => {
    if (document.activeElement !== yearFromRef.current) {
      setLocalYearFrom(yearFrom?.toString() ?? "");
    }
  }, [yearFrom]);

  useEffect(() => {
    if (document.activeElement !== yearToRef.current) {
      setLocalYearTo(yearTo?.toString() ?? "");
    }
  }, [yearTo]);

  const commitYearFrom = (value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    if (parsed !== null && (parsed < 1900 || parsed > 2100 || isNaN(parsed))) {
      setLocalYearFrom(yearFrom?.toString() ?? "");
      return;
    }
    onYearFromChange(parsed);
  };

  const commitYearTo = (value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    if (parsed !== null && (parsed < 1900 || parsed > 2100 || isNaN(parsed))) {
      setLocalYearTo(yearTo?.toString() ?? "");
      return;
    }
    onYearToChange(parsed);
  };

  const handleStarClick = (starValue: number) => {
    if (minRating === starValue) {
      onMinRatingChange(undefined);
    } else {
      onMinRatingChange(starValue);
    }
  };

  return (
    <div className={cn("space-y-4 p-4", !isMobile && "pt-15")}>
      {/* Search bar */}
      <LibrarySearchBar value={rawSearch} onChange={onSearchChange} />

      {/* Rating filter */}
      <FilterSection
        title={t("ratingFilter")}
        icon={Star}
        isActive={minRating !== undefined}
        onClear={
          minRating !== undefined
            ? () => onMinRatingChange(undefined)
            : undefined
        }
      >
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t("ratingFilter")}
        >
          {[1, 2, 3, 4, 5].map((starValue) => {
            const isActive =
              minRating !== undefined && starValue <= minRating;
            const isSelected = minRating === starValue;
            return (
              <Tooltip key={starValue} delayDuration={300}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleStarClick(starValue)}
                    className={cn(
                      "p-0.5 rounded transition-colors hover:scale-110",
                      isSelected && "ring-1 ring-primary/30 rounded-sm"
                    )}
                    aria-label={
                      isSelected ? t("clearRatingFilter") : `${starValue}+`
                    }
                  >
                    <Star
                      className={cn(
                        "h-4 w-4 transition-colors",
                        isActive
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/40 hover:text-amber-300"
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {isSelected ? t("clearRatingFilter") : `${starValue}+`}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </FilterSection>

      {/* Date saved presets */}
      <FilterSection
        title={t("filterDateSaved")}
        icon={Calendar}
        isActive={savedPreset !== null}
        onClear={
          savedPreset !== null ? () => onSavedPresetChange(null) : undefined
        }
      >
        <div className="flex items-center gap-1">
          {(["week", "month", "year"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() =>
                onSavedPresetChange(savedPreset === preset ? null : preset)
              }
              className={cn(
                "text-xs px-2.5 py-1.5 rounded-md transition-colors",
                savedPreset === preset
                  ? "text-primary bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              {t(
                preset === "week"
                  ? "filterLastWeek"
                  : preset === "month"
                    ? "filterLastMonth"
                    : "filterLastYear"
              )}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Year range */}
      <FilterSection
        title={t("filterYearRange")}
        icon={Hash}
        isActive={yearFrom !== null || yearTo !== null}
        onClear={
          yearFrom !== null || yearTo !== null
            ? () => {
                onYearFromChange(null);
                onYearToChange(null);
              }
            : undefined
        }
      >
        <div className="flex items-center gap-1.5">
          <Input
            ref={yearFromRef}
            type="number"
            placeholder={t("filterYearFrom")}
            value={localYearFrom}
            onChange={(e) => setLocalYearFrom(e.target.value)}
            onBlur={(e) => commitYearFrom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="h-7 w-[72px] text-xs"
            min={1900}
            max={2100}
          />
          <span className="text-xs text-muted-foreground">-</span>
          <Input
            ref={yearToRef}
            type="number"
            placeholder={t("filterYearTo")}
            value={localYearTo}
            onChange={(e) => setLocalYearTo(e.target.value)}
            onBlur={(e) => commitYearTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="h-7 w-[72px] text-xs"
            min={1900}
            max={2100}
          />
        </div>
      </FilterSection>

      {/* Collection filter */}
      <FilterSection
        title={t("filterCollection")}
        icon={FolderOpen}
        isActive={collectionId !== null}
        onClear={
          collectionId !== null ? () => onCollectionChange(null) : undefined
        }
      >
        <Select
          value={collectionId ?? ""}
          onValueChange={(v) => onCollectionChange(v || null)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder={t("allCollections")} />
          </SelectTrigger>
          <SelectContent>
            {collections?.map((c) => (
              <SelectItem key={c._id} value={c._id} className="text-xs">
                <span className="flex items-center gap-2">
                  {c.name}
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-4 px-1"
                  >
                    {c.itemCount}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onManageCollections}
          className="mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("manageCollections")}
        </button>
      </FilterSection>
    </div>
  );
}
