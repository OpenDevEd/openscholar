"use client";

import { useTranslations } from "next-intl";
import { searchAuthors } from "@/app/actions/openalex-authors";
import { HelpCircle } from "@/components/icons";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import { TooltipHint } from "@/components/ui/tooltip";
import { authorFilterValue, isAuthorId } from "@/lib/openalex/author-filter";
import { rememberAuthorNames, useAuthorNames } from "@/lib/openalex/use-author-names";

const AUTHORS = { key: "author", search: searchAuthors, useNames: useAuthorNames, remember: rememberAuthorNames };

/**
 * Authors from OpenAlex's autocomplete, and the name typed itself: many authors on a work,
 * organisations above all, have no author record to find. A result card adds one too, when its name is clicked.
 */
export function AuthorFilter({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const tf = useTranslations("searchFilters");
  const typed = (query: string) => {
    const name = authorFilterValue(query);
    return name && !isAuthorId(name) ? { id: name, name, detail: tf("authorByName") } : null;
  };
  // OpenAlex widens within each kind and narrows across the two, which the chips alone don't show.
  const mixed = selected.some(isAuthorId) && selected.some((author) => !isAuthorId(author));
  return (
    <div className="space-y-2">
      <OpenAlexLookupFilter
        selected={selected}
        onChange={onChange}
        lookup={{ ...AUTHORS, typed }}
        labels={{ label: tf("authors"), placeholder: tf("anyAuthor"), searchPlaceholder: tf("searchAuthors"), typeToSearch: tf("typeToSearchAuthors"), unavailable: tf("authorsUnavailable") }}
      />
      {mixed && (
        <p className="text-xs text-subtle-foreground">
          {tf("authorsAndNames")}{" "}
          <TooltipHint label={<span className="block max-w-64">{tf("authorsAndNamesWhy")}</span>}>
            <button
              type="button"
              aria-label={tf("authorsAndNamesWhy")}
              className="inline-flex rounded-sm align-text-bottom text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <HelpCircle aria-hidden className="size-3.5" />
            </button>
          </TooltipHint>
        </p>
      )}
    </div>
  );
}
