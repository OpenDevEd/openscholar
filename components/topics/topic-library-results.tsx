"use client";
import useSWRInfinite from "swr/infinite";
import {parseAsString, useQueryState} from "nuqs";
import {Search} from "lucide-react";
import {readTopicPublications} from "@/app/actions/topic-publications";
import {PublicationListItem} from "@/components/evidence-libraries/publication-list-item";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Spinner} from "@/components/ui/spinner";
export function TopicLibraryResults({topicId}: {topicId: string}) {
  const [query, setQuery] = useQueryState("libraryQuery", parseAsString.withDefault(""));
  const results = useSWRInfinite((index, previous) => index > 0 && !previous?.nextCursor ? null : ["topic-publications", topicId, query, previous?.nextCursor ?? null] as const,
    ([, id, search, cursor]) => readTopicPublications(id, search, cursor));
  const papers = results.data?.flatMap(page => page.papers) ?? [];
  const unavailable = results.data?.some(page => page.unavailableCount);
  const updating = results.data?.some(page => page.updating);
  const more = results.data?.at(-1)?.nextCursor;
  const complete = results.data?.at(-1)?.complete && !unavailable;
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-6">
      <p className="text-sm text-muted-foreground" aria-live="polite">{papers.length} {complete ? "publications" : "publications loaded"}</p>
      <div className="relative w-full sm:w-72"><Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search library publications" placeholder="Search publications" className="pl-9" value={query} maxLength={200} onChange={event => void setQuery(event.target.value)} /></div>
    </div>
    {(results.error || unavailable || updating) && <div role="alert" className="flex flex-wrap items-center gap-3 px-6 py-4 text-sm"><span>{results.error ? "Publications could not be loaded." : updating ? "Publication groups are updating. Refresh shortly." : "Some library locations are unavailable. Available locations are shown."}</span><Button variant="outline" size="sm" onClick={async () => {await results.setSize(1); await results.mutate();}}>Try again</Button></div>}
    {results.isLoading && <div className="flex min-h-48 items-center justify-center"><Spinner aria-label="Loading library publications" /></div>}
    {papers.map(paper => <PublicationListItem key={paper.id} publication={paper} locations={paper.locations} />)}
    {!results.isLoading && !results.error && !papers.length && <p className="p-6 text-sm text-muted-foreground">{more ? "No matches on this page. Continue loading publications." : query ? "No publications match your search." : "No published Evidence Library records use this topic yet."}</p>}
    {more && <div className="flex justify-center p-3"><Button variant="ghost" disabled={results.isValidating} onClick={() => void results.setSize(results.size + 1)}>{results.isValidating && <Spinner />}Show more</Button></div>}
  </div>;
}
