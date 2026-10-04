"use client";

import { useTranslations } from "next-intl";
import { searchFunders } from "@/app/actions/funders";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import { rememberFunderNames, useFunderNames } from "@/lib/openalex/use-funder-names";

const FUNDERS = { key: "funder", search: searchFunders, useNames: useFunderNames, remember: rememberFunderNames };

/** Funders from OpenAlex's autocomplete; there are too many to list. */
export function FunderFilter({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const tf = useTranslations("searchFilters");
  return (
    <OpenAlexLookupFilter
      selected={selected}
      onChange={onChange}
      lookup={FUNDERS}
      labels={{ label: tf("funders"), placeholder: tf("anyFunder"), searchPlaceholder: tf("searchFunders"), typeToSearch: tf("typeToSearchFunders"), unavailable: tf("fundersUnavailable") }}
    />
  );
}
