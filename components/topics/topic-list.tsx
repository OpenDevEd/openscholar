"use client";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {parseAsString, useQueryState} from "nuqs";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import {ArrowUpRight, Network, SearchX} from "lucide-react";
import {useConvex} from "convex/react";
import {api} from "@/convex/_generated/api";
import {LibraryPageShell} from "@/components/evidence-libraries/library-page-shell";
import {LIST_FILTER, LIST_TILE, ListEmpty, ListLoading, ListSearch} from "@/components/evidence-libraries/list-controls";
import {cn} from "@/lib/utils";
import {Button} from "@/components/ui/button";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
export function TopicList() {
  const t = useTranslations("topics");
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
  const [domain, setDomain] = useQueryState("domain", parseAsString.withDefault("all"));
  const [field, setField] = useQueryState("field", parseAsString.withDefault("all"));
  const [subfield, setSubfield] = useQueryState("subfield", parseAsString.withDefault("all"));
  // Reads go straight to Convex over the open connection and run in parallel.
  const convex = useConvex();
  const directory = (args: {parent?: string | null; query?: string; ancestor?: string; cursor: string | null; limit: number}) => convex.query(api.topics.catalog.directory, args);
  const domains = useSWR("topic-domains", () => directory({parent: null, cursor: null, limit: 100}));
  const fields = useSWR(domains.data ? ["topic-fields", domain] : null, async () => {
    const parents = domain === "all" ? domains.data!.nodes.map(node => node.id) : [domain];
    return (await Promise.all(parents.map(parent => directory({parent, cursor: null, limit: 100})))).flatMap(page => page.nodes);
  });
  // A subfield link arrives without its field, so its subfield is then the only choice.
  const subfields = useSWR(["topic-subfields", field, field === "all" ? subfield : "all"], ([, parent, only]) =>
    parent !== "all" ? directory({parent, cursor: null, limit: 100}).then(page => page.nodes) : only !== "all" ? convex.query(api.topics.catalog.resolve, {ids: [only]}) : []);
  const ancestor = subfield !== "all" ? subfield : field !== "all" ? field : domain !== "all" ? domain : undefined;
  const results = useSWRInfinite((index, previous) => index > 0 && !previous?.nextCursor ? null : ["topic-directory", search, ancestor ?? null, previous?.nextCursor ?? null] as const,
    ([, query, ancestor, cursor]) => directory({query, ancestor: ancestor ?? undefined, cursor, limit: 30}));
  const topics = results.data?.flatMap(page => page.nodes) ?? [];
  const more = results.data?.at(-1)?.nextCursor;
  const clear = () => {void setSearch(""); void setDomain("all"); void setField("all"); void setSubfield("all");};
  return <LibraryPageShell icon={Network} title={t("title")} description={t("description")}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4">
      <ListSearch aria-label={t("find")} placeholder={t("findPlaceholder")} className="w-56" value={search} maxLength={200} onChange={event => void setSearch(event.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        {(search || ancestor) && <span className="fade-enter inline-flex"><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clear}>{t("clearFilters")}</Button></span>}
        <Select value={domain} onValueChange={value => {void setDomain(value); void setField("all"); void setSubfield("all");}}><SelectTrigger size="sm" aria-label={t("domain")} className={cn("w-44", LIST_FILTER)}><SelectValue placeholder={t("allDomains")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allDomains")}</SelectItem>{domains.data?.nodes.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
        <Select value={field} onValueChange={value => {void setField(value); void setSubfield("all");}}><SelectTrigger size="sm" aria-label={t("field")} className={cn("w-48", LIST_FILTER)}><SelectValue placeholder={t("allFields")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allFields")}</SelectItem>{fields.data?.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
        <Select value={subfield} disabled={!subfields.data?.length} onValueChange={value => void setSubfield(value)}><SelectTrigger size="sm" aria-label={t("subfield")} className={cn("w-48", LIST_FILTER)}><SelectValue placeholder={t("allSubfields")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allSubfields")}</SelectItem>{subfields.data?.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
      </div>
    </div>
    {(results.error || domains.error || fields.error || subfields.error) && <div role="alert" className="flex items-center gap-3 p-6 text-sm">{t("loadFailed")}<Button variant="outline" onClick={() => {void results.mutate(); void domains.mutate(); void fields.mutate(); void subfields.mutate();}}>{t("tryAgain")}</Button></div>}
    {results.isLoading && <ListLoading label={t("loading")} />}
    {!!topics.length && <ul className="divide-y divide-border/50">{topics.map(topic => <li key={topic.id} className="fade-enter"><Link href={`/topics/${topic.id}`} className="group flex items-center gap-3 p-4 hover:bg-muted/15">
      <div className={cn(LIST_TILE, "mr-1 shrink-0")}><Network aria-hidden className="size-5" /></div>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium group-hover:underline">{topic.name}</p><p className="truncate text-xs text-muted-foreground">{topic.path.slice(0, -1).join(" / ")}</p></div>
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link></li>)}</ul>}
    {!results.isLoading && !results.error && !topics.length && <ListEmpty icon={SearchX}>{t("noMatches")}</ListEmpty>}
    {more && <div className="flex justify-center p-3"><Button variant="ghost" size="sm" disabled={results.isValidating} onClick={() => void results.setSize(results.size + 1)}>{t("showMore")}</Button></div>}
  </LibraryPageShell>;
}
