"use client";
import useSWRInfinite from "swr/infinite";
import {useTranslations} from "next-intl";
import {parseAsString, useQueryState} from "nuqs";
import {readTopicPublications} from "@/app/actions/topic-publications";
import {PublicationListItem} from "@/components/evidence-libraries/publication-list-item";
import {Button} from "@/components/ui/button";
import {Spinner} from "@/components/ui/spinner";

/** The topic's library publications, loaded by the page so its tab can show the count. */
export function useTopicLibraryResults(topicId: string) {
  const [query, setQuery] = useQueryState("libraryQuery", parseAsString.withDefault(""));
  const results = useSWRInfinite((index, previous) => index > 0 && !previous?.nextCursor ? null : ["topic-publications", topicId, query, previous?.nextCursor ?? null] as const,
    ([, id, search, cursor]) => readTopicPublications(id, search, cursor));
  const papers = results.data?.flatMap(page => page.papers) ?? [];
  const unavailable = results.data?.some(page => page.unavailableCount);
  const complete = results.data?.at(-1)?.complete && !unavailable;
  // Unknown while loading; "10+" while more pages or libraries are still out.
  const count = results.data ? `${papers.length}${complete ? "" : "+"}` : undefined;
  return {query, setQuery, results, papers, unavailable, count};
}

export function TopicLibraryResults({state: {query, results, papers, unavailable}}: {state: ReturnType<typeof useTopicLibraryResults>}) {
  const t = useTranslations("topics");
  const updating = results.data?.some(page => page.updating);
  const more = results.data?.at(-1)?.nextCursor;
  return <div>
    {(results.error || unavailable || updating) && <div role="alert" className="flex flex-wrap items-center gap-3 px-6 py-4 text-sm"><span>{results.error ? t("publicationsFailed") : updating ? t("updating") : t("unavailable")}</span><Button variant="outline" size="sm" onClick={async () => {await results.setSize(1); await results.mutate();}}>{t("tryAgain")}</Button></div>}
    {results.isLoading && <div className="flex min-h-40 items-center justify-center"><Spinner aria-label={t("loadingLibrary")} className="size-6 text-primary" /></div>}
    {papers.map(paper => <PublicationListItem key={paper.id} publication={paper} locations={paper.locations} />)}
    {!results.isLoading && !results.error && !papers.length && <p className="p-6 text-sm text-muted-foreground">{more ? t("noPageMatches") : query ? t("noLibraryMatches") : t("noLibraryRecords")}</p>}
    {more && <div className="flex justify-center p-3"><Button variant="ghost" disabled={results.isValidating} onClick={() => void results.setSize(results.size + 1)}>{results.isValidating && <Spinner />}{t("showMore")}</Button></div>}
  </div>;
}
