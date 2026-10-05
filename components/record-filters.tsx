"use client";

import { useTranslations } from "next-intl";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import {
  rememberFunderNames, rememberInstitutionNames, rememberJournalNames,
  useFunderNames, useInstitutionNames, useJournalNames,
} from "@/lib/openalex/use-record-names";

type Props = { selected: string[]; onChange: (ids: string[]) => void };

const FUNDERS = { entity: "funders" as const, useNames: useFunderNames, remember: rememberFunderNames };
const JOURNALS = { entity: "sources" as const, useNames: useJournalNames, remember: rememberJournalNames };
const INSTITUTIONS = { entity: "institutions" as const, useNames: useInstitutionNames, remember: rememberInstitutionNames };

// Picked from OpenAlex's autocomplete: there are too many of each to list.

export function FunderFilter({ selected, onChange }: Props) {
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

export function JournalFilter({ selected, onChange }: Props) {
  const tf = useTranslations("searchFilters");
  return (
    <OpenAlexLookupFilter
      selected={selected}
      onChange={onChange}
      lookup={JOURNALS}
      labels={{ label: tf("journals"), placeholder: tf("anyJournal"), searchPlaceholder: tf("searchJournals"), typeToSearch: tf("typeToSearchJournals"), unavailable: tf("journalsUnavailable") }}
    />
  );
}

export function InstitutionFilter({ selected, onChange }: Props) {
  const tf = useTranslations("searchFilters");
  return (
    <OpenAlexLookupFilter
      selected={selected}
      onChange={onChange}
      lookup={INSTITUTIONS}
      labels={{ label: tf("institutions"), placeholder: tf("anyInstitution"), searchPlaceholder: tf("searchInstitutions"), typeToSearch: tf("typeToSearchInstitutions"), unavailable: tf("institutionsUnavailable") }}
    />
  );
}
