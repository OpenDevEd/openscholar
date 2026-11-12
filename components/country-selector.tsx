"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Globe } from "@/components/icons";
import { OptionPicker } from "@/components/shared/option-picker";
import { CountryFlag } from "@/components/ui/country-flag";
import { COUNTRY_NAME_CHANGES, PLACES, getCountryCodesForRegions } from "@/lib/constants";
import { getRegionDisplayName } from "@/lib/i18n/region-names";

/** Lower case and without accents, so "cote" finds Côte d'Ivoire. */
const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Regions and countries for a search filter. One searchable list, like the
 * other filters: a row says what it is in on its second line, so nothing is
 * indented and it fits a narrow sidebar. Typing finds a place by any part of
 * its name, and a region's name also lists its countries.
 */
export function CountrySelector({
  label,
  placeholder,
  selectedRegions,
  onSelectionChange,
  bypassLimit = false,
}: {
  label: string;
  placeholder: string;
  selectedRegions: string[];
  onSelectionChange: (regions: string[]) => void;
  /** Without it OpenAlex's cap applies: only the first 100 countries are used, and the picker says so. */
  bypassLimit?: boolean;
}) {
  const locale = useLocale();
  const tf = useTranslations("searchFilters");
  const name = (id: string) => getRegionDisplayName(id, locale, (key) => (tf as (key: string) => string)(key));
  const collator = new Intl.Collator(locale);
  const [search, setSearch] = useState("");

  const regions = PLACES.filter((place) => !place.isCountry).map((place) => ({
    id: place.id,
    name: name(place.id),
    group: tf("regionsGroup"),
    detail: place.parents.length
      ? name(place.parents[0])
      : tf("nCountries", { count: getCountryCodesForRegions([place.id], true).totalCount }),
    icon: <Globe aria-hidden className="size-4 shrink-0 text-muted-foreground" />,
    words: place.parents.map(name),
  }));
  const countries = PLACES.filter((place) => place.isCountry)
    .map((place) => ({
      id: place.id,
      name: name(place.id),
      group: tf("countries"),
      detail: place.parents.length ? name(place.parents[0]) : undefined,
      icon: <CountryFlag countryCode={place.id} className="shrink-0" />,
      // The names it had before, and the regions it is in.
      words: [...(COUNTRY_NAME_CHANGES[place.id] ?? []), ...place.parents.map(name)],
    }))
    .sort((a, b) => collator.compare(a.name, b.name));

  // Places named by what is typed come first, then those found by another word: a region's countries, an old name.
  const query = plain(search.trim());
  const all = [...regions, ...countries];
  const options = !query
    ? all
    : [
        ...all.filter((option) => plain(option.name).includes(query) || plain(option.id) === query),
        ...all.filter((option) => !plain(option.name).includes(query) && plain(option.id) !== query && option.words.some((word) => plain(word).includes(query))),
      ];

  const picked = getCountryCodesForRegions(selectedRegions, bypassLimit);
  const hasRegion = selectedRegions.some((id) => PLACES.some((place) => place.id === id && !place.isCountry));

  return (
    <div className="space-y-2">
      <OptionPicker
        label={label}
        placeholder={placeholder}
        selectedText={tf("nSelected", { count: selectedRegions.length })}
        searchPlaceholder={tf("searchCountriesPlaceholder")}
        emptyText={tf("nothingFound")}
        removeLabel={(chosen) => tf("removeChoice", { name: chosen })}
        options={options}
        selected={selectedRegions}
        names={Object.fromEntries(selectedRegions.map((id) => [id, name(id)]))}
        // Each chip shows what its row does: a country its flag, a region the globe.
        icons={Object.fromEntries(all.filter((option) => selectedRegions.includes(option.id)).map((option) => [option.id, option.icon]))}
        onSearch={setSearch}
        onToggle={(id) =>
          onSelectionChange(selectedRegions.includes(id) ? selectedRegions.filter((one) => one !== id) : [...selectedRegions, id])
        }
      />
      {picked.isLimitExceeded ? (
        <p className="text-xs text-warning">{tf("countryLimit")}</p>
      ) : hasRegion && !bypassLimit ? (
        <p className="text-xs text-subtle-foreground">{tf("filteringByCountries", { count: picked.countries.length })}</p>
      ) : null}
    </div>
  );
}
