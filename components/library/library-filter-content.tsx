"use client";

import { useEffect, useMemo, useState } from "react";
import { subMonths, subWeeks, subYears } from "date-fns";
import { Calendar as CalendarIcon, FolderOpen, Hash, SlidersHorizontal, Star } from "lucide-react";
import { DateRange } from "react-day-picker";
import { useFormatter, useTranslations } from "next-intl";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { FilterSection } from "@/components/shared/filter-section";
import { RatingStarsDisplay } from "@/components/ui/filter-display";
import { MIN_YEAR, getYearRangePresets } from "@/lib/constants";
import {
  dateToParam,
  parseDateParam,
  type LibrarySortBy,
  type LibrarySortOrder,
} from "@/lib/library/search-params";
import { cn } from "@/lib/utils";

interface LibraryFilterContentProps {
  minRating: number | undefined;
  maxRating: number | undefined;
  onRatingChange: (min: number | undefined, max: number | undefined) => void;
  savedFrom: string | null;
  savedTo: string | null;
  onSavedRangeChange: (from: string | null, to: string | null) => void;
  yearFrom: number | null;
  yearTo: number | null;
  onYearRangeChange: (from: number | null, to: number | null) => void;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  collections:
    | Array<{ _id: string; name: string; itemCount: number }>
    | undefined;
  onManageCollections: () => void;
  sortBy: LibrarySortBy;
  sortOrder: LibrarySortOrder;
  onSortByChange: (value: LibrarySortBy) => void;
  onSortOrderChange: (value: LibrarySortOrder) => void;
  isMobile: boolean;
}

export function LibraryFilterContent({
  minRating,
  maxRating,
  onRatingChange,
  savedFrom,
  savedTo,
  onSavedRangeChange,
  yearFrom,
  yearTo,
  onYearRangeChange,
  collectionId,
  onCollectionChange,
  collections,
  onManageCollections,
  sortBy,
  sortOrder,
  onSortByChange,
  onSortOrderChange,
  isMobile,
}: LibraryFilterContentProps) {
  const t = useTranslations("libraryPage");
  const tf = useTranslations("searchFilters");
  const tc = useTranslations("common");
  const format = useFormatter();

  const currentYear = new Date().getFullYear();
  const ratingRange: [number, number] = [minRating ?? 1, maxRating ?? 5];
  const isRatingActive = minRating !== undefined || maxRating !== undefined;
  const isSavedDateActive = savedFrom !== null || savedTo !== null;
  const isYearActive = yearFrom !== null || yearTo !== null;
  const isCollectionActive = collectionId !== null;
  const isSortActive = sortBy !== "savedAt" || sortOrder !== "desc";

  const sortOptions: Array<{ value: LibrarySortBy; label: string }> = useMemo(
    () => [
      { value: "savedAt", label: t("sortDateSaved") },
      { value: "rating", label: t("sortRating") },
      { value: "publicationYear", label: t("sortPublicationYear") },
      { value: "citedByCount", label: tf("filterCitedBy") },
      { value: "title", label: t("sortTitle") },
    ],
    [t, tf],
  );

  const savedDateRange = useMemo<DateRange | undefined>(() => {
    const from = parseDateParam(savedFrom);
    const to = parseDateParam(savedTo);
    if (!from && !to) return undefined;
    return { from, to };
  }, [savedFrom, savedTo]);

  const [isSavedDateOpen, setIsSavedDateOpen] = useState(false);
  const [tempSavedDateRange, setTempSavedDateRange] = useState<DateRange | undefined>(
    savedDateRange,
  );

  useEffect(() => {
    if (!isSavedDateOpen) {
      setTempSavedDateRange(savedDateRange);
    }
  }, [isSavedDateOpen, savedDateRange]);

  const commitSavedDateRange = (range: DateRange | undefined) => {
    onSavedRangeChange(
      range?.from ? dateToParam(range.from) : null,
      range?.to ? dateToParam(range.to) : null,
    );
  };

  const handleSavedDateOpenChange = (open: boolean) => {
    if (open) {
      setTempSavedDateRange(savedDateRange);
    } else {
      commitSavedDateRange(tempSavedDateRange);
    }
    setIsSavedDateOpen(open);
  };

  const applySavedPreset = (preset: "week" | "month" | "year") => {
    const end = new Date();
    const start =
      preset === "week"
        ? subWeeks(end, 1)
        : preset === "month"
          ? subMonths(end, 1)
          : subYears(end, 1);

    onSavedRangeChange(dateToParam(start), dateToParam(end));
  };

  const effectiveYearRange: [number, number] = [
    yearFrom ?? MIN_YEAR,
    yearTo ?? currentYear,
  ];
  const [yearInputFrom, setYearInputFrom] = useState(`${effectiveYearRange[0]}`);
  const [yearInputTo, setYearInputTo] = useState(`${effectiveYearRange[1]}`);

  useEffect(() => {
    setYearInputFrom(`${effectiveYearRange[0]}`);
    setYearInputTo(`${effectiveYearRange[1]}`);
  }, [effectiveYearRange]);

  const commitYearRange = (range: [number, number]) => {
    const normalizedStart = Math.max(MIN_YEAR, Math.min(currentYear, range[0]));
    const normalizedEnd = Math.max(normalizedStart, Math.min(currentYear, range[1]));

    if (normalizedStart === MIN_YEAR && normalizedEnd === currentYear) {
      onYearRangeChange(null, null);
      return;
    }

    onYearRangeChange(normalizedStart, normalizedEnd);
  };

  const handleRatingRangeChange = (nextRange: number[]) => {
    const nextMin = nextRange[0];
    const nextMax = nextRange[1];
    if (nextMin <= 1 && nextMax >= 5) {
      onRatingChange(undefined, undefined);
      return;
    }
    onRatingChange(nextMin, nextMax);
  };

  const formatDate = (date: Date) =>
    format.dateTime(date, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const savedDateLabel = (() => {
    if (savedDateRange?.from && savedDateRange?.to) {
      return `${formatDate(savedDateRange.from)} → ${formatDate(savedDateRange.to)}`;
    }
    if (savedDateRange?.from) {
      return `${tc("from")} ${formatDate(savedDateRange.from)}`;
    }
    if (savedDateRange?.to) {
      return `${tc("to")} ${formatDate(savedDateRange.to)}`;
    }
    return tf("chooseDateRange");
  })();

  const yearRangeLabel = isYearActive
    ? `${effectiveYearRange[0]} → ${effectiveYearRange[1]}`
    : tf("filterByYearRange");

  return (
    <div className={cn("space-y-4 p-4", !isMobile && "pt-15")}>
      <FilterSection
        title={t("filterDateSaved")}
        icon={CalendarIcon}
        isActive={isSavedDateActive}
        onClear={isSavedDateActive ? () => onSavedRangeChange(null, null) : undefined}
      >
        <div className="space-y-3">
          <Popover open={isSavedDateOpen} onOpenChange={handleSavedDateOpenChange}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full h-10 justify-start text-left font-normal",
                  isSavedDateActive
                    ? "border-sidebar-primary/50"
                    : "border-dashed border-muted-foreground/30",
                )}
              >
                <CalendarIcon className="mr-3 h-4 w-4 text-muted-foreground" />
                <span className="truncate text-sm">{savedDateLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={savedDateRange?.from}
                selected={tempSavedDateRange}
                onSelect={setTempSavedDateRange}
                numberOfMonths={2}
                captionLayout="dropdown"
              />
            </PopoverContent>
          </Popover>

          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => applySavedPreset("week")}>
              {t("filterLastWeek")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => applySavedPreset("month")}>
              {t("filterLastMonth")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => applySavedPreset("year")}>
              {t("filterLastYear")}
            </Button>
          </div>
        </div>
      </FilterSection>

      <FilterSection
        title={t("filterYearRange")}
        icon={Hash}
        isActive={isYearActive}
        onClear={isYearActive ? () => onYearRangeChange(null, null) : undefined}
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "w-full h-10 justify-start text-left font-normal",
                isYearActive
                  ? "border-sidebar-primary/50"
                  : "border-dashed border-muted-foreground/30",
              )}
            >
              <Hash className="mr-3 h-4 w-4 text-muted-foreground" />
              <span className="truncate text-sm">{yearRangeLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4" align="start">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {tc("from")}
                  </label>
                  <Input
                    type="number"
                    min={MIN_YEAR}
                    max={currentYear}
                    value={yearInputFrom}
                    onChange={(event) => setYearInputFrom(event.target.value)}
                    onBlur={() =>
                      commitYearRange([
                        Number.parseInt(yearInputFrom || `${MIN_YEAR}`, 10) || MIN_YEAR,
                        effectiveYearRange[1],
                      ])
                    }
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {tc("to")}
                  </label>
                  <Input
                    type="number"
                    min={MIN_YEAR}
                    max={currentYear}
                    value={yearInputTo}
                    onChange={(event) => setYearInputTo(event.target.value)}
                    onBlur={() =>
                      commitYearRange([
                        effectiveYearRange[0],
                        Number.parseInt(yearInputTo || `${currentYear}`, 10) || currentYear,
                      ])
                    }
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="px-1">
                  <Slider
                    value={effectiveYearRange}
                    onValueChange={(value) =>
                      commitYearRange([value[0], value[1]])
                    }
                    min={MIN_YEAR}
                    max={currentYear}
                    step={1}
                    className="w-full"
                  />
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>{MIN_YEAR}</span>
                    <span>{currentYear}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {getYearRangePresets().map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => commitYearRange(preset.range)}
                    >
                      {tf(preset.key)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </FilterSection>

      <FilterSection
        title={t("ratingFilter")}
        icon={Star}
        isActive={isRatingActive}
        onClear={isRatingActive ? () => onRatingChange(undefined, undefined) : undefined}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-background/70 px-3 py-2.5">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{tc("from")}</p>
              <RatingStarsDisplay range={[ratingRange[0], ratingRange[0]]} size="sm" />
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs font-medium text-muted-foreground">{tc("to")}</p>
              <RatingStarsDisplay range={[ratingRange[1], ratingRange[1]]} size="sm" />
            </div>
          </div>

          <div className="px-2">
            <Slider
              value={ratingRange}
              onValueChange={handleRatingRangeChange}
              min={1}
              max={5}
              step={1}
              className="w-full"
            />
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
          </div>
        </div>
      </FilterSection>

      <FilterSection
        title={t("filterCollection")}
        icon={FolderOpen}
        isActive={isCollectionActive}
        onClear={isCollectionActive ? () => onCollectionChange(null) : undefined}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onCollectionChange(null)}
              className={cn(
                "inline-flex items-center rounded-xl border px-3 py-2 text-sm transition-colors",
                collectionId === null
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/70 text-muted-foreground hover:text-foreground",
              )}
            >
              {t("allCollections")}
            </button>

            {collections?.map((collection) => {
              const isActive = collectionId === collection._id;
              return (
                <button
                  key={collection._id}
                  type="button"
                  onClick={() => onCollectionChange(collection._id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "border-primary/30 bg-primary/10 text-foreground"
                      : "border-border/60 bg-background/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="max-w-[150px] truncate">{collection.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {collection.itemCount}
                  </span>
                </button>
              );
            })}
          </div>

          {!collections?.length && (
            <p className="text-sm text-muted-foreground">{t("noCollections")}</p>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onManageCollections}
            className="w-full"
          >
            {t("manageCollections")}
          </Button>
        </div>
      </FilterSection>

      <FilterSection
        title={t("sortBy")}
        icon={SlidersHorizontal}
        isActive={isSortActive}
        onClear={
          isSortActive
            ? () => {
                onSortByChange("savedAt");
                onSortOrderChange("desc");
              }
            : undefined
        }
      >
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(value) => onSortByChange(value as LibrarySortBy)}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSortOrderChange(sortOrder === "asc" ? "desc" : "asc")}
            className="min-w-[120px]"
          >
            {sortOrder === "asc" ? t("sortAscending") : t("sortDescending")}
          </Button>
        </div>
      </FilterSection>
    </div>
  );
}
