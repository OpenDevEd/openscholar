"use client";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {parseAsString, useQueryState} from "nuqs";
import {useState} from "react";
import { ArrowUpRight, SearchX } from "lucide-react";
import {LibraryPageShell} from "@/components/evidence-libraries/library-page-shell";
import {LIST_FILTER, LIST_TILE, ListEmpty, ListSearch} from "@/components/evidence-libraries/list-controls";
import {catalogChildren, catalogNode, searchCatalogTopics} from "@/lib/topics/search";
import {cn} from "@/lib/utils";
import {Button} from "@/components/ui/button";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import { TopicsIcon } from "@/components/section-icons";
const PAGE = 30;
/** Browses the catalog that ships with the app, so choosing and searching never wait on the server. */
export function TopicList() {
  const t = useTranslations("topics");
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
  const [domain, setDomain] = useQueryState("domain", parseAsString.withDefault("all"));
  const [field, setField] = useQueryState("field", parseAsString.withDefault("all"));
  const [subfield, setSubfield] = useQueryState("subfield", parseAsString.withDefault("all"));
  const domains = catalogChildren(null);
  const fields = domain === "all" ? domains.flatMap(node => catalogChildren(node.id)) : catalogChildren(domain);
  // A subfield link arrives without its field, so its subfield is then the only choice.
  const subfields = field !== "all" ? catalogChildren(field) : subfield !== "all" ? [catalogNode(subfield)].filter(node => node !== undefined) : [];
  const ancestor = subfield !== "all" ? subfield : field !== "all" ? field : domain !== "all" ? domain : undefined;
  const matches = searchCatalogTopics(search, ancestor);
  // "Show more" counts for this search only; a new search starts from one page again.
  const listing = `${search}|${ancestor ?? ""}`;
  const [shown, setShown] = useState({listing, count: PAGE});
  const count = shown.listing === listing ? shown.count : PAGE;
  const topics = matches.slice(0, count);
  const more = matches.length > count;
  const clear = () => {void setSearch(""); void setDomain("all"); void setField("all"); void setSubfield("all");};
  return <LibraryPageShell icon={TopicsIcon} title={t("title")} filters={<>
    <ListSearch aria-label={t("find")} placeholder={t("findPlaceholder")} className="w-56" value={search} maxLength={200} onChange={event => void setSearch(event.target.value)} />
    <Select value={domain} onValueChange={value => {void setDomain(value); void setField("all"); void setSubfield("all");}}><SelectTrigger size="sm" aria-label={t("domain")} className={cn("w-40", LIST_FILTER)}><SelectValue placeholder={t("allDomains")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allDomains")}</SelectItem>{domains.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
    <Select value={field} onValueChange={value => {void setField(value); void setSubfield("all");}}><SelectTrigger size="sm" aria-label={t("field")} className={cn("w-44", LIST_FILTER)}><SelectValue placeholder={t("allFields")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allFields")}</SelectItem>{fields.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
    <Select value={subfield} disabled={!subfields.length} onValueChange={value => void setSubfield(value)}><SelectTrigger size="sm" aria-label={t("subfield")} className={cn("w-44", LIST_FILTER)}><SelectValue placeholder={t("allSubfields")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("allSubfields")}</SelectItem>{subfields.map(node => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}</SelectContent></Select>
  </>}>
    {/* Appears when you filter, as the list changes anyway, so the bar never moves. */}
    {(search || ancestor) && <div className="fade-enter flex justify-end border-b border-border/50 px-4 py-2"><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clear}>{t("clearFilters")}</Button></div>}
    {!!topics.length && <ul className="divide-y divide-border/50">{topics.map(topic => <li key={topic.id} className="fade-enter"><Link href={`/topics/${topic.id}`} className="group flex items-center gap-3 p-4 hover:bg-muted/15">
      <div className={cn(LIST_TILE, "mr-1 shrink-0")}><TopicsIcon className="size-5" /></div>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium group-hover:underline">{topic.name}</p><p className="truncate text-xs text-muted-foreground">{topic.path.slice(0, -1).join(" / ")}</p></div>
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link></li>)}</ul>}
    {!topics.length && <ListEmpty icon={SearchX}>{t("noMatches")}</ListEmpty>}
    {more && <div className="flex justify-center p-3"><Button variant="ghost" size="sm" onClick={() => setShown({listing, count: count + PAGE})}>{t("showMore")}</Button></div>}
  </LibraryPageShell>;
}
