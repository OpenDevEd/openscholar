"use client";
import { useFormatter, useTranslations } from "next-intl";
import useSWRInfinite from "swr/infinite";
import { searchIndexAuthors, type IndexAuthor } from "@/app/actions/author-card";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { ArrowUpRight } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { LogoMark } from "@/components/logo";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { Spinner } from "@/components/ui/spinner";
import Link from "@/components/workspace-link";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { unlessLimited } from "@/lib/openalex/limited";
import { SEARCH_SOURCE_NAMES } from "@/lib/search/source";
import { useSearchSource } from "@/lib/search/use-search-source";
import { cn } from "@/lib/utils";
import { AuthorAvatar } from "./author-avatar";

/** One author from the index, as a profile's row reads, with their counts in place of a headline. */
function AuthorRow({ author, showId = true }: { author: IndexAuthor; showId?: boolean }) {
  const format = useFormatter();
  const t = useTranslations("entityCards");
  return (
    <li className="fade-enter">
      <Link href={`/authors/${author.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <AuthorAvatar className="me-1 size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          {/* Several people, or several unpaired records of one, can share a name: its ID tells them apart. */}
          <p className="flex min-w-0 items-baseline gap-2"><span className="truncate text-sm font-medium group-hover:underline">{author.name}</span>{showId && <code className="hidden shrink-0 text-3xs font-normal text-muted-foreground sm:inline">{author.id}</code>}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {author.country && <CountryFlag countryCode={author.country} className="shrink-0" />}
            <span className="truncate">{author.institution ?? t("noInstitution")}</span>
          </p>
        </div>
        <div className="hidden shrink-0 grid-cols-[4.5rem_5.5rem] text-end sm:grid">
          <div>
            <p className="text-sm font-medium tabular-nums">{format.number(author.works)}</p>
            <p className="text-3xs text-muted-foreground">{t("papers")}</p>
          </div>
          <div>
            <p className="text-sm font-medium tabular-nums">{format.number(author.citations)}</p>
            <p className="text-3xs text-muted-foreground">{t("citations")}</p>
          </div>
        </div>
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

// ponytail: mock snapshot of whole-person numbers from our index (2026-11-05). The real build reads these on the server, cached, per source.
const EXAMPLES: IndexAuthor[] = [
  { id: "A5015565298", name: "Esther Duflo", institution: "Massachusetts Institute of Technology", country: "US", works: 355, citations: 68230, largest: 274 },
  { id: "A5035981377", name: "John Allan Hattie", institution: "The University of Melbourne", country: "AU", works: 625, citations: 38570, largest: 584 },
  { id: "A5075388625", name: "Linda Darling-Hammond", institution: "Learning Policy Institute", country: "US", works: 466, citations: 66007, largest: 408 },
  { id: "A5067184382", name: "Jennifer Doudna", institution: "University of California, Berkeley", country: "US", works: 694, citations: 104554, largest: 550 },
  { id: "A5108093963", name: "Geoffrey E. Hinton", institution: "Google (United States)", country: "US", works: 506, citations: 594057, largest: 466 },
];

/** Real authors under the search box, each opening their page: what a search finds, before anything is typed. */
function ExampleAuthors() {
  const t = useTranslations("authorPages");
  return (
    <section aria-label={t("authorExamplesLabel")} className="border-t border-border-subtle">
      <p className="px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground">{t("authorExamplesLabel")}</p>
      <ul className="divide-y divide-border-subtle">{EXAMPLES.map((author) => <AuthorRow key={author.id} author={author} showId={false} />)}</ul>
    </section>
  );
}

/** Authors in the active source that match the search, below the profiles that do. One that has a profile shows there alone. */
export function IndexAuthors({ search, profiled, examples }: { search: string; profiled: ReadonlySet<string>; examples: boolean }) {
  const source = useSearchSource();
  const t = useTranslations("authorPages");
  const typed = search.trim();
  const debounced = useDebouncedValue(typed);
  // Clearing the box goes back at once.
  const query = typed ? debounced : "";
  const pages = useSWRInfinite(
    (page, previous: { more: boolean } | null) => (query && (!previous || previous.more) ? (["index-authors", query, page + 1, source] as const) : null),
    ([, value, page, reading]) => unlessLimited(searchIndexAuthors(value, page, reading)),
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );
  const seen = new Set<string>();
  const authors = (pages.data ?? []).flatMap((page) => page.authors).filter((author) => {
    if (seen.has(author.id) || profiled.has(author.id)) return false;
    seen.add(author.id);
    return true;
  });
  const more = pages.data?.at(-1)?.more;
  const SourceIcon = source === "openalex" ? OpenAlexIcon : LogoMark;
  // One frame slides between the examples and the answer, and the examples stay, dimmed, until it's in, so the card never empties between them.
  const answered = !!query && (!!pages.data || !!pages.error);
  return (
    <AutoHeight>
      {examples && !answered ? <div inert={!!typed} className={cn("transition-opacity duration-200", typed && "opacity-50")}><ExampleAuthors /></div> : query ? (
        <section aria-label={t("authorsIn", { source: SEARCH_SOURCE_NAMES[source] })} className="border-t border-border-subtle">
          <p className="flex items-center gap-2 px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground">
            <SourceIcon className="size-3.5 shrink-0" />
            {t("authorsIn", { source: SEARCH_SOURCE_NAMES[source] })}
          </p>
          {!pages.data && pages.isLoading && <ListLoading compact label={t("searchingAuthors")} />}
          {pages.error && <p className="px-4 py-3 text-sm text-muted-foreground">{t("couldNotSearchAuthors")}</p>}
          {pages.data && !authors.length && <p className="fade-enter px-4 py-3 text-sm text-muted-foreground">{t("noAuthorsMatchYourSearch")}</p>}
          {!!authors.length && <ul key={query} className="divide-y divide-border-subtle">{authors.map((author) => <AuthorRow key={author.id} author={author} />)}</ul>}
          {more && (
            <div className="flex justify-center border-t border-border-subtle p-3">
              <Button variant="ghost" size="sm" disabled={pages.isValidating} onClick={() => void pages.setSize(pages.size + 1)}>
                {pages.isValidating && <Spinner />}
                {t("showMore")}
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </AutoHeight>
  );
}
