"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { OptionPicker } from "@/components/shared/option-picker";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { OpenAlexLimitedError, unlessLimited, type OpenAlexLimited } from "@/lib/openalex/limited";

type Option = { id: string; name: string; detail?: string };

/**
 * A filter picked from OpenAlex's autocomplete, for things there are too many
 * of to list: funders, authors. `lookup` finds them and keeps their names.
 */
export function OpenAlexLookupFilter({
  selected,
  onChange,
  lookup,
  labels,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  lookup: {
    key: string;
    search: (query: string) => Promise<Option[] | OpenAlexLimited>;
    useNames: (ids: readonly string[]) => Record<string, string>;
    remember: (names: Record<string, string>) => void;
  };
  labels: { label: string; placeholder: string; searchPlaceholder: string; typeToSearch: string; unavailable: string };
}) {
  const tf = useTranslations("searchFilters");
  const tToast = useTranslations("toast");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim());
  const results = useSWR(query ? [`${lookup.key}-search`, query] : null, () => unlessLimited(lookup.search(query)), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const savedNames = lookup.useNames(selected);
  const options = query ? (results.data ?? []) : [];
  const names = {
    ...savedNames,
    ...Object.fromEntries(options.map((option) => [option.id, option.name])),
  };

  return (
    <OptionPicker
      label={labels.label}
      placeholder={labels.placeholder}
      selectedText={tf("nSelected", { count: selected.length })}
      searchPlaceholder={labels.searchPlaceholder}
      emptyText={
        !query
          ? labels.typeToSearch
          : results.error
            ? results.error instanceof OpenAlexLimitedError ? tToast("tooManyRequestsDescription") : labels.unavailable
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
        lookup.remember({ [id]: names[id] });
      }}
    />
  );
}
