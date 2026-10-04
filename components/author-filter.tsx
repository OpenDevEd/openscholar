"use client";

import { useTranslations } from "next-intl";
import { searchAuthors } from "@/app/actions/openalex-authors";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import { rememberAuthorNames, useAuthorNames } from "@/lib/openalex/use-author-names";

const AUTHORS = { key: "author", search: searchAuthors, useNames: useAuthorNames, remember: rememberAuthorNames };

/** Authors from OpenAlex's autocomplete. A result card adds one too, when its name is clicked. */
export function AuthorFilter({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const tf = useTranslations("searchFilters");
  return (
    <OpenAlexLookupFilter
      selected={selected}
      onChange={onChange}
      lookup={AUTHORS}
      labels={{ label: tf("authors"), placeholder: tf("anyAuthor"), searchPlaceholder: tf("searchAuthors"), typeToSearch: tf("typeToSearchAuthors"), unavailable: tf("authorsUnavailable") }}
    />
  );
}
