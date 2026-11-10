"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { RorIcon } from "@/components/icons/author-service-icons";
import { OptionPicker } from "@/components/shared/option-picker";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { searchOpenAlexRecords } from "@/app/actions/openalex-lookup";
import type { LookupEntity } from "@/lib/openalex/autocomplete";
import { OpenAlexLimitedError, unlessLimited } from "@/lib/openalex/limited";
import { useSearchSource } from "@/lib/search/use-search-source";

type Option = { id: string; name: string; detail?: string; ror?: string };

/**
 * A filter picked from OpenAlex's autocomplete, for things there are too many
 * of to list: authors, funders, journals, institutions. `lookup` says which, and keeps their names.
 */
export function OpenAlexLookupFilter({
  selected,
  onChange,
  lookup,
  labels,
  icons,
  after,
  onPicked,
  also,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  lookup: {
    entity: LookupEntity;
    useNames: (ids: readonly string[]) => Record<string, string>;
    remember: (names: Record<string, string>) => void;
    /** An option made from the words typed, for what OpenAlex has no record of. Listed first, so the records load in under it. */
    typed?: (query: string) => Option | null;
  };
  labels: { label: string; placeholder: string; searchPlaceholder: string; typeToSearch: string; unavailable: string };
  /** What each chip shows before its name, such as a country's flag. */
  icons?: Record<string, React.ReactNode>;
  /** What each chip shows after its name, such as a link to the record elsewhere. */
  after?: Record<string, React.ReactNode>;
  /** The record just picked, with its detail line, for a caller that keeps more than its ID. */
  onPicked?: (option: Option) => void;
  /** Records from another register, listed after OpenAlex's; one OpenAlex already lists, by its ROR ID or its name, is left out. */
  also?: { key: string; search: (query: string) => Promise<Option[]> };
}) {
  const tf = useTranslations("searchFilters");
  const tToast = useTranslations("toast");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim());
  const source = useSearchSource();
  const results = useSWR(query ? [`${lookup.entity}-search`, source, query] : null, () => unlessLimited(searchOpenAlexRecords(lookup.entity, query, source)), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const elsewhere = useSWR(also && query ? [`${also.key}-search`, query] : null, () => also!.search(query), { revalidateOnFocus: false, keepPreviousData: true });
  const savedNames = lookup.useNames(selected);
  // The typed option follows the keys, not the debounce, so Enter picks what the box says.
  const text = search.trim();
  const typed = text ? lookup.typed?.(text) : null;
  const found = query ? (results.data ?? []) : [];
  const known = new Set(found.flatMap((option) => [option.name.toLowerCase(), ...(option.ror ? [option.ror] : [])]));
  const more = query && also ? (elsewhere.data ?? []).filter((option) => !known.has(option.name.toLowerCase()) && !(option.ror && known.has(option.ror))) : [];
  // A record named exactly as typed takes the typed row's place at the top: the words typed are then no record of their own.
  const listed = [...found, ...more];
  const exact = typed && listed.find((option) => option.name.trim().toLowerCase() === typed.name.trim().toLowerCase());
  const first = exact || typed;
  // Each institution with a ROR ID says so in its row, as its chip does once picked, whichever register found it.
  // Records found for words since changed can't be picked until the answer to what's typed is in: Enter never takes
  // one from the last search. The row of words as typed always can.
  const stale = !!text && (text !== query || results.isValidating || elsewhere.isValidating);
  const options = [...(first ? [first] : []), ...listed.filter((option) => option !== exact)].map((option) => ({
    ...option,
    ...(option.ror && { mark: <RorIcon className="ms-1 opacity-80" /> }),
    ...(stale && option !== typed && { disabled: true }),
  }));
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
      icons={icons}
      after={after}
      onSearch={setSearch}
      // From the first key until both registers have answered the words in the box.
      busy={stale}
      onToggle={(id) => {
        if (selected.includes(id)) return onChange(selected.filter((one) => one !== id));
        onChange([...selected, id]);
        const picked = options.find((option) => option.id === id);
        if (picked) onPicked?.(picked);
        // Saved as it is picked, so chips for this search never have to look the name up.
        lookup.remember({ [id]: names[id] });
      }}
    />
  );
}
