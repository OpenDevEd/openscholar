"use client";
import { useFormatter } from "next-intl";
import useSWRInfinite from "swr/infinite";
import { searchIndexAuthors, type IndexAuthor } from "@/app/actions/author-card";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { ArrowUpRight } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { Spinner } from "@/components/ui/spinner";
import Link from "@/components/workspace-link";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { unlessLimited } from "@/lib/openalex/limited";
import { SEARCH_SOURCE_NAMES } from "@/lib/search/source";
import { useSearchSource } from "@/lib/search/use-search-source";
import { AuthorAvatar } from "./author-avatar";

/** One author from the index, as a profile's row reads, with their counts in place of a headline. */
function AuthorRow({ author }: { author: IndexAuthor }) {
  const format = useFormatter();
  return (
    <li className="fade-enter">
      <Link href={`/authors/${author.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <AuthorAvatar className="me-1 size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium group-hover:underline">{author.name}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {author.country && <CountryFlag countryCode={author.country} className="shrink-0" />}
            <span className="truncate">{author.institution ?? "No current institution"}</span>
          </p>
        </div>
        <div className="hidden shrink-0 grid-cols-[4.5rem_5.5rem] text-end sm:grid">
          <div>
            <p className="text-sm font-medium tabular-nums">{format.number(author.works)}</p>
            <p className="text-3xs text-muted-foreground">Papers</p>
          </div>
          <div>
            <p className="text-sm font-medium tabular-nums">{format.number(author.citations)}</p>
            <p className="text-3xs text-muted-foreground">Citations</p>
          </div>
        </div>
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** Authors in the active source that match the search, below the profiles that do. One that has a profile shows there alone. */
export function IndexAuthors({ search, profiled }: { search: string; profiled: ReadonlySet<string> }) {
  const source = useSearchSource();
  const query = useDebouncedValue(search.trim());
  const pages = useSWRInfinite(
    (page, previous: { more: boolean } | null) => (query && (!previous || previous.more) ? (["index-authors", query, page + 1, source] as const) : null),
    ([, value, page, reading]) => unlessLimited(searchIndexAuthors(value, page, reading)),
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );
  if (!query) return null;
  const seen = new Set<string>();
  const authors = (pages.data ?? []).flatMap((page) => page.authors).filter((author) => {
    if (seen.has(author.id) || profiled.has(author.id)) return false;
    seen.add(author.id);
    return true;
  });
  const more = pages.data?.at(-1)?.more;
  const SourceIcon = source === "openalex" ? OpenAlexIcon : LogoMark;
  return (
    <section aria-label={`Authors in ${SEARCH_SOURCE_NAMES[source]}`} className="border-t border-border-subtle">
      <p className="flex items-center gap-2 px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground">
        <SourceIcon className="size-3.5 shrink-0" />
        In {SEARCH_SOURCE_NAMES[source]}
      </p>
      {!pages.data && pages.isLoading && <ListLoading compact label="Searching authors" />}
      {pages.error && <p className="px-4 py-3 text-sm text-muted-foreground">Couldn&apos;t search authors. Try again in a moment.</p>}
      {pages.data && !authors.length && <p className="px-4 py-3 text-sm text-muted-foreground">No authors match.</p>}
      {!!authors.length && <ul className="divide-y divide-border-subtle">{authors.map((author) => <AuthorRow key={author.id} author={author} />)}</ul>}
      {more && (
        <div className="flex justify-center border-t border-border-subtle p-3">
          <Button variant="ghost" size="sm" disabled={pages.isValidating} onClick={() => void pages.setSize(pages.size + 1)}>
            {pages.isValidating && <Spinner />}
            Show more
          </Button>
        </div>
      )}
    </section>
  );
}
