"use client";

// The institutions a person was at, picked from OpenAlex's and ROR's records or typed, each with its country's flag and
// ROR's mark. A report's details form and the profile setup share it.

import { useTranslations } from "next-intl";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import { RorLink } from "@/components/papers/paper-entities";
import { CountryFlag } from "@/components/ui/country-flag";
import { findRor } from "@/app/actions/people-lookup";
import { countryOfPlace } from "@/lib/reports/places";
import type { Affiliation } from "@/lib/reports/report";

const typedId = (name: string) => `typed:${name}`;

/** An affiliation's chip: OpenAlex's institution by its ID, one only ROR knows by its ROR ID, or the name as typed. */
export const chipOf = (a: Affiliation) => a.id ?? (a.ror ? `ror:${a.ror}` : typedId(a.name));

/** An author's places, from OpenAlex's institutions, from ROR's for one OpenAlex doesn't know, or as typed, each with its country's flag. */
export function AffiliationPicker({ value, onChange }: { value: Affiliation[]; onChange: (a: Affiliation[]) => void }) {
  const t = useTranslations("people");
  const ids = value.map(chipOf);
  const names = Object.fromEntries(value.map((a) => [chipOf(a), a.name]));
  return (
    <OpenAlexLookupFilter
      selected={ids}
      onChange={(next) => onChange(value.filter((a) => next.includes(chipOf(a))))}
      onPicked={(option) => {
        if (option.id.startsWith("typed:")) return onChange([...value, { id: null, name: option.name, country: "" }]);
        // One only ROR found is kept by its ROR ID; OpenAlex's by its own ID, with the ROR ID it has.
        const ror = option.ror ?? (option.id.startsWith("ror:") ? option.id.slice(4) : undefined);
        onChange([...value, { id: option.id.startsWith("ror:") ? null : option.id, name: option.name, country: countryOfPlace(option.detail), ...(ror && { ror }) }]);
      }}
      icons={Object.fromEntries(value.filter((a) => a.country).map((a) => [chipOf(a), <CountryFlag key={a.name} countryCode={a.country} />]))}
      after={Object.fromEntries(
        value.filter((a) => a.ror).map((a) => [
          chipOf(a),
          <RorLink key="ror" ror={a.ror!} label={t("onRor", { name: a.name })} />,
        ]),
      )}
      lookup={{
        entity: "institutions",
        useNames: () => names,
        remember: () => {},
        typed: (query) => ({ id: typedId(query), name: query, detail: t("asTyped") }),
      }}
      also={{
        key: "ror",
        search: async (query) => (await findRor(query)).map((o) => ({ id: `ror:${o.ror}`, name: o.name, detail: o.place, ror: o.ror, aliases: o.aliases })),
      }}
      labels={{ label: t("affiliations"), placeholder: t("addInstitution"), searchPlaceholder: t("findInstitution"), typeToSearch: t("typeInstitution"), unavailable: t("institutionsDown") }}
    />
  );
}

