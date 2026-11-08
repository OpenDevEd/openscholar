"use client";

import { Fragment } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Star } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { CountryFlag } from "@/components/ui/country-flag";
import { getAllFilterItems, type FilterItem, type FilterParams, type FilterT } from "@/lib/filters";
import { getRegionDisplayName } from "@/lib/i18n/region-names";
import { useFunderNames, useInstitutionNames, useJournalNames } from "@/lib/openalex/use-record-names";
import { useAuthorNames } from "@/lib/openalex/use-author-names";
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
  valuesOnly = false,
  className,
}: {
  filters: FilterParams;
  size?: "default" | "compact";
  /** One row that scrolls sideways, for rows that share the line with actions. */
  singleLine?: boolean;
  /** Each chip's value beside its icon, its name said only to screen readers: for a line read at a glance, where the full card is a hover away. */
  valuesOnly?: boolean;
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
  const authors = useAuthorNames(filters.authors ?? []);
  const journals = useJournalNames(filters.journals ?? []);
  const institutions = useInstitutionNames(filters.institutions ?? []);
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const items = getAllFilterItems(
    filters,
    t as FilterT,
    (date, options) => format.dateTime(date, options as Parameters<typeof format.dateTime>[1]),
    {
      researchAreas,
      funders,
      authors,
      journals,
      institutions,
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
          <FilterChip item={item} compact={size === "compact"} singleLine={singleLine} valuesOnly={valuesOnly} />
        </li>
      ))}
    </ul>
  );
}

/** Filters whose value is a paper's ID. The ID alone says nothing, so these keep their name beside it. */
const NAMED_BY_ID = new Set<FilterItem["type"]>(["cites", "citedBy", "relatedTo", "similarTo"]);

function FilterChip({ item, compact, singleLine, valuesOnly }: { item: FilterItem; compact: boolean; singleLine: boolean; valuesOnly: boolean }) {
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
        {item.label !== item.displayValue ? <span className={valuesOnly && !NAMED_BY_ID.has(item.type) ? "sr-only" : "text-muted-foreground"}>{item.label} </span> : null}
        {item.ratingRange ? <RatingStars range={item.ratingRange} label={item.displayValue} /> : item.places ? (
          // Each country with its flag in front, as countries read everywhere in the app; a region by its name.
          item.places.map((place, index) => (
            <Fragment key={place.id}>
              {index > 0 && ", "}
              <span className="whitespace-nowrap">{place.country && <CountryFlag countryCode={place.id} className="me-1 h-[1em] w-[1.33em] align-[-0.125em]" />}{place.name}</span>
            </Fragment>
          ))
        ) : item.displayValue}
      </span>
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
