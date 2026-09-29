"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { searchFunders } from "@/app/actions/funders";
import { OptionPicker } from "@/components/shared/option-picker";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { rememberFunderNames, useFunderNames } from "@/lib/openalex/use-funder-names";

/** Funders from OpenAlex's autocomplete; there are too many to list. */
export function FunderFilter({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const tf = useTranslations("searchFilters");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim());
  const results = useSWR(query ? ["funder-search", query] : null, () => searchFunders(query), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const savedNames = useFunderNames(selected);
  const options = query ? (results.data ?? []) : [];
  const names = {
    ...savedNames,
    ...Object.fromEntries(options.map((option) => [option.id, option.name])),
  };

  return (
    <OptionPicker
      label={tf("funders")}
      placeholder={tf("anyFunder")}
      selectedText={tf("nSelected", { count: selected.length })}
      searchPlaceholder={tf("searchFunders")}
      emptyText={
        !query
          ? tf("typeToSearchFunders")
          : results.error
            ? tf("fundersUnavailable")
            : results.isLoading
              ? tf("searching")
              : tf("nothingFound")
      }
      removeLabel={(name) => tf("removeChoice", { name })}
      options={options}
      selected={selected}
      names={names}
      onSearch={setSearch}
      onToggle={(id) => {
        if (selected.includes(id)) return onChange(selected.filter((one) => one !== id));
        onChange([...selected, id]);
        // Saved as it is picked, so chips for this search never have to look the name up.
        rememberFunderNames({ [id]: names[id] });
      }}
    />
  );
}
