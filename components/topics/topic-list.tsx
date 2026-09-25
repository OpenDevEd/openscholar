"use client";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {parseAsString, useQueryState} from "nuqs";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import {ArrowUpRight, Network, Search} from "lucide-react";
import {useConvex} from "convex/react";
import {api} from "@/convex/_generated/api";
import {LibraryPageShell} from "@/components/evidence-libraries/library-page-shell";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Spinner} from "@/components/ui/spinner";
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
    <div className="flex flex-wrap items-center gap-3 border-b border-border/50 p-4 sm:px-6">
      <div className="relative min-w-0 flex-[1_1_260px]"><Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={t("find")} placeholder={t("findPlaceholder")} className="pl-9" value={search} maxLength={200} onChange={event => void setSearch(event.target.value)} /></div>
      <Select value={domain} onValueChange={value => {void setDomain(value); void setField("all"); void setSubfield("all");}}><SelectTrigger aria-label={t("domain")} className="w-full sm:w-48"><SelectValue placeholder={t("allDomains")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allDomains")}</SelectItem>{domains.data?.nodes.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
      <Select value={field} onValueChange={value => {void setField(value); void setSubfield("all");}}><SelectTrigger aria-label={t("field")} className="w-full sm:w-56"><SelectValue placeholder={t("allFields")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allFields")}</SelectItem>{fields.data?.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
      <Select value={subfield} disabled={!subfields.data?.length} onValueChange={value => void setSubfield(value)}><SelectTrigger aria-label={t("subfield")} className="w-full sm:w-56"><SelectValue placeholder={t("allSubfields")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allSubfields")}</SelectItem>{subfields.data?.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
    </div>
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground sm:px-6"><span aria-live="polite">{t(more ? "countLoaded" : "count", {count: topics.length})}</span>{(search || ancestor) && <Button variant="ghost" size="sm" onClick={clear}>{t("clearFilters")}</Button>}</div>
    {(results.error || domains.error || fields.error || subfields.error) && <div role="alert" className="flex items-center gap-3 p-6 text-sm">{t("loadFailed")}<Button variant="outline" onClick={() => {void results.mutate(); void domains.mutate(); void fields.mutate(); void subfields.mutate();}}>{t("tryAgain")}</Button></div>}
    {results.isLoading && <div className="flex min-h-40 items-center justify-center"><Spinner aria-label={t("loading")} className="size-6 text-primary" /></div>}
    {topics.map(topic => <Link key={topic.id} href={`/topics/${topic.id}`} className="group flex items-center gap-4 border-b border-border/50 px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/20 sm:px-6"><Network aria-hidden className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="font-semibold group-hover:text-primary">{topic.name}</p><p className="mt-1 text-sm text-muted-foreground">{topic.path.slice(0, -1).join(" / ")}</p></div><ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground" /></Link>)}
    {!results.isLoading && !results.error && !topics.length && <p className="p-6 text-sm text-muted-foreground">{t("noMatches")}</p>}
    {more && <div className="flex justify-center p-3"><Button variant="ghost" size="sm" disabled={results.isValidating} onClick={() => void results.setSize(results.size + 1)}>{t("showMore")}</Button></div>}
  </LibraryPageShell>;
}
