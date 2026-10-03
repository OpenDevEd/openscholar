"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CountryFlag } from "@/components/ui/country-flag";
import { getAllFilterItems, type FilterItem, type FilterParams, type FilterT } from "@/lib/filters";
import { getRegionDisplayName } from "@/lib/i18n/region-names";
import { useFunderNames } from "@/lib/openalex/use-funder-names";
import { topicName } from "@/lib/topics/search";
import { cn } from "@/lib/utils";

/**
 * The active filters of a search as chips: the sidebar card's icon, the filter
 * and its real value. Used wherever a search's filters are listed.
 */
export function FilterChips({
  filters,
  size = "default",
  singleLine = false,
  className,
}: {
  filters: FilterParams;
  size?: "default" | "compact";
  /** One row that scrolls sideways, for rows that share the line with actions. */
  singleLine?: boolean;
  className?: string;
}) {
  const t = useTranslations("searchFilters");
  const tc = useTranslations("common");
  const format = useFormatter();
  const locale = useLocale();
  // Names come from the bundled catalog, so a chip never shows an ID first.
  const researchAreas = Object.fromEntries(
    (filters.researchAreas ?? []).map((id) => [id, topicName(id) ?? id]),
  );
  const funders = useFunderNames(filters.funders ?? []);
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const items = getAllFilterItems(
    filters,
    t as FilterT,
    (date, options) => format.dateTime(date, options as Parameters<typeof format.dateTime>[1]),
    {
      researchAreas,
      funders,
      place: (id) => getRegionDisplayName(id, locale, (key) => (t as FilterT)(key)),
      language: (code) => languageNames.of(code) ?? code,
    },
  );
  if (!items.length) return null;

  return (
    <ul
      aria-label={tc("filters")}
      className={cn("flex", singleLine ? "w-max" : "flex-wrap", size === "compact" ? "gap-1" : "gap-1.5", className)}
    >
      {items.map((item) => (
        <li key={item.key} className={singleLine ? "shrink-0" : "min-w-0 max-w-full"}>
          <FilterChip item={item} compact={size === "compact"} singleLine={singleLine} />
        </li>
      ))}
    </ul>
  );
}

function FilterChip({ item, compact, singleLine }: { item: FilterItem; compact: boolean; singleLine: boolean }) {
  const Icon = item.icon;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "items-start gap-1.5 rounded-md font-normal",
        singleLine ? "whitespace-nowrap" : "max-w-full whitespace-normal",
        compact ? "px-1.5 py-0.5 text-3xs [&>svg]:size-2.5" : "py-1",
      )}
    >
      <Icon className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {item.label !== item.displayValue ? <span className="text-muted-foreground">{item.label} </span> : null}
        {item.ratingRange ? <RatingStars range={item.ratingRange} label={item.displayValue} /> : item.displayValue}
      </span>
      {item.countryCodes?.length ? (
        <span className="flex shrink-0 items-center gap-0.5 self-center" aria-hidden>
          {item.countryCodes.slice(0, 3).map((code) => (
            <CountryFlag key={code} countryCode={code} />
          ))}
        </span>
      ) : null}
    </Badge>
  );
}

function RatingStars({ range: [min, max], label }: { range: [number, number]; label: string }) {
  return (
    <span className="inline-flex gap-0.5 align-middle" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            "size-2.5",
            star >= min && star <= max ? "fill-rating text-rating" : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}
