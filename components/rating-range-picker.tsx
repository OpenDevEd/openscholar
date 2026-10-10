"use client";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Star } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const STOPS = [0, 1, 2, 3, 4, 5];

/**
 * The rating range as a slider over its six stops. The stars inside the range
 * light up, so the range reads at a glance without a second copy in words.
 * Search adds the "only rated papers" switch; the library always filters.
 */
export function RatingRangePicker({
  ratingRange,
  onRatingRangeChange,
  onlyRatedPapers = true,
  onOnlyRatedChange,
}: {
  ratingRange: [number, number];
  onRatingRangeChange: (range: [number, number]) => void;
  onlyRatedPapers?: boolean;
  /** Shows the "only rated papers" switch. */
  onOnlyRatedChange?: (checked: boolean) => void;
}) {
  const tf = useTranslations("searchFilters");
  const [from, to] = ratingRange;

  return (
    <div className="space-y-4">
      {onOnlyRatedChange && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {tf("onlyShowRated")}
            </label>
            <p className="text-xs text-subtle-foreground">
              {tf("hideUnrated")}
            </p>
          </div>
          <Switch
            checked={onlyRatedPapers}
            onCheckedChange={onOnlyRatedChange}
          />
        </div>
      )}

      {(!onOnlyRatedChange || onlyRatedPapers) && (
        <div className="space-y-2">
          <Slider
            value={ratingRange}
            onValueChange={([low, high]) => onRatingRangeChange([low!, high!])}
            min={0}
            max={5}
            step={1}
          />
          {/* Each stop is as wide as a thumb, so its star sits under the thumb resting on it. */}
          <div className="flex justify-between">
            {STOPS.map((stop) => {
              const inside = stop >= from && stop <= to;
              return (
                <span
                  key={stop}
                  className={cn(
                    "flex w-4 flex-col items-center gap-0.5 text-2xs tabular-nums",
                    inside ? "text-foreground" : "text-muted-foreground/60",
                  )}
                >
                  <Star
                    className={cn(
                      "size-3",
                      inside && stop > 0 ? "fill-rating text-rating" : "text-muted-foreground/40",
                    )}
                  />
                  {stop}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
