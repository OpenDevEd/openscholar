"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCloseFocus } from "@/components/focus-mode/close-context";
import { CountryFlag } from "@/components/ui/country-flag";
import { TooltipHint } from "@/components/ui/tooltip";
import { useCountryFilter } from "@/hooks/use-country-filter";
import { getRegionDisplayName } from "@/lib/i18n/region-names";
import { useSearchOptional } from "@/lib/search/provider";
import { buildShareableUrl } from "@/lib/search-params";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { cn } from "@/lib/utils";

/**
 * The flag of the country an institution is in, as a control: it narrows the page's search to works from institutions
 * there (the sidebar's Institution location), or starts that search where the page has none, as an author's name does.
 */
export function CountryFilterFlag({ code, className }: { code: string; className?: string }) {
  const t = useTranslations("searchFilters");
  const locale = useLocale();
  const router = useWorkspaceRouter();
  const closeFocus = useCloseFocus();
  const canFilter = Boolean(useSearchOptional());
  const { selectedValues, handleSelectionChange } = useCountryFilter("selectedRegions");
  const country = getRegionDisplayName(code, locale);
  const pressed = canFilter && selectedValues.includes(code);
  const label = t("filterByInstitutionCountry", { country });
  return (
    <TooltipHint label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={(event) => {
          // It sits inside cards and rows that open on a click of their own.
          event.stopPropagation();
          // Either way the paper sheet it sits in closes: the search behind it changes, or the page does.
          closeFocus();
          if (!canFilter) return router.push(buildShareableUrl("", { reg: [code] }));
          handleSelectionChange(pressed ? selectedValues.filter((value) => value !== code) : [...selectedValues, code]);
        }}
        className={cn("inline-flex shrink-0 rounded-[3px] outline-offset-2 transition-[box-shadow] hover:ring-2 hover:ring-primary/40 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:ring-2 aria-pressed:ring-primary", className)}
      >
        <CountryFlag countryCode={code} />
      </button>
    </TooltipHint>
  );
}
