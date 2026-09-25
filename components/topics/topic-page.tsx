"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { ArrowUpRight, BookOpen, ChevronRight, Copy, Network } from "lucide-react";
import { toast } from "sonner";
import { readTopic, readTopicWorks } from "@/app/actions/topics";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { PaperCard } from "@/components/paper-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FocusMode } from "@/components/ui/focus-mode";
import { downloadLibraryItem, downloadLibraryEssentialItem } from "@/lib/library/download-handlers";
import { useUIStore } from "@/lib/store";
import type { TopicNode } from "@/lib/topics/catalog";
import { topicHref } from "@/lib/topics/links";
import { TopicLibraryResults } from "./topic-library-results";
import { buildShareableUrl } from "@/lib/search-params";

export function TopicPage({ topic, path, related, detail: initialDetail }: { topic: TopicNode; path: TopicNode[]; related: TopicNode[]; detail: Awaited<ReturnType<typeof readTopic>> | null }) {
  const t = useTranslations("topics");
  const tc = useTranslations("common");
  const [tab, setTab] = useState("libraries");
  const [showRelated, setShowRelated] = useState(false);
  // The server sends the saved description; the browser only asks when that failed.
  const detail = useSWR(["topic", topic.id], ([, id]) => readTopic(id), {fallbackData: initialDetail ?? undefined, revalidateOnMount: !initialDetail, revalidateOnFocus: false});
  const works = useSWRInfinite((_page, previous) => {
    if (tab !== "openalex" || (previous && !previous.meta.next_cursor)) return null;
    return ["topic-works", topic.id, previous?.meta.next_cursor ?? "*"] as const;
  }, ([, id, cursor]) => readTopicWorks(id, cursor));
  const papers = works.data?.flatMap(page => page.results) ?? [];
  const total = works.data?.[0]?.meta.count ?? 0;
  const isFocusModeOpen = useUIStore(state => state.isFocusModeOpen);

  return <LibraryPageShell icon={Network} title={topic.name} backHref="/topics" backLabel={t("back")} actions={<>
    <Button variant="outline" size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(location.href); toast.success(t("linkCopied")); }
      catch { toast.error(t("copyFailed")); }
    }}><Copy aria-hidden />{t("copyLink")}</Button>
    <Button variant="outline" size="sm" asChild><a href={`https://openalex.org/${topic.id}`} target="_blank" rel="noreferrer"><OpenAlexIcon className="size-4 shrink-0" />OpenAlex<ArrowUpRight aria-hidden /></a></Button>
  </>}>
    <div className="space-y-4 p-4 sm:p-6">
      <nav aria-label={t("classification")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {path.map((node, index) => <span key={node.id} className="inline-flex items-center gap-2">
          {index > 0 && <ChevronRight aria-hidden className="size-3" />}
          <Link href={topicHref(node.id, node.name)} className="hover:text-primary">{node.name}</Link>
        </span>)}
      </nav>
      {detail.data?.description && <p className="max-w-4xl text-sm leading-relaxed">{detail.data.description}</p>}
      {detail.isLoading && <Spinner aria-label={t("loadingDescription")} className="size-4 text-muted-foreground" />}
      {detail.error && <div role="alert" className="flex items-center gap-2 text-sm text-muted-foreground">{t("descriptionFailed")}<Button size="sm" variant="ghost" onClick={() => void detail.mutate()}>{t("tryAgain")}</Button></div>}
      {!!detail.data?.keywords.length && <div className="flex flex-wrap gap-2" aria-label={t("keywords")}>{detail.data.keywords.map(keyword => <Link key={keyword} href={buildShareableUrl("", { q: keyword })} className="rounded-md bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{keyword}</Link>)}</div>}
      {!!related.length && <div>
        <Button variant="ghost" size="sm" className="-ml-3" aria-expanded={showRelated} onClick={() => setShowRelated(value => !value)}><Network aria-hidden />{showRelated ? t("hideRelated") : t("related")}<span className="text-muted-foreground">{related.length}</span></Button>
        {showRelated && <div className="mt-2 grid gap-1 sm:grid-cols-2">{related.map(node => <Link className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted/30 hover:text-primary" key={node.id} href={`/topics/${node.id}`}>{node.name}<ArrowUpRight aria-hidden className="size-3.5 shrink-0" /></Link>)}</div>}
      </div>}
    </div>
    <Tabs value={tab} onValueChange={setTab} className="gap-0">
      <div className="border-y border-border/50 px-4 py-3 sm:px-6">
        <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="libraries" className="h-9 flex-none px-3 after:hidden data-[state=active]:bg-muted data-[state=active]:shadow-none"><BookOpen aria-hidden />{tc("evidenceLibraries")}</TabsTrigger>
          <TabsTrigger value="openalex" className="h-9 flex-none px-3 after:hidden data-[state=active]:bg-muted data-[state=active]:shadow-none"><OpenAlexIcon className="size-4 shrink-0" />OpenAlex</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="libraries" className="m-0">
        <TopicLibraryResults topicId={topic.id} />
      </TabsContent>
      <TabsContent value="openalex" className="m-0">
        <FocusMode isOpen={isFocusModeOpen} onClose={() => useUIStore.getState().setIsFocusModeOpen(false)} papers={papers} onDownloadItem={downloadLibraryItem} onDownloadEssentialItem={downloadLibraryEssentialItem} />
        {works.error && <div role="alert" className="flex items-center gap-3 p-6 text-sm">{t("publicationsFailed")}<Button variant="outline" size="sm" onClick={() => void works.mutate()}>{t("tryAgain")}</Button></div>}
        {works.isLoading && <div className="flex min-h-48 items-center justify-center"><Spinner aria-label={t("loadingPublications")} className="size-6 text-primary" /></div>}
        {papers.length > 0 && <div className="space-y-4 p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">{t("openAlexCount", { count: total })}</p>
          {papers.map((paper, index) => <PaperCard key={paper.id} result={paper} resultIndex={index} viewMode="list-simple" onDownloadItem={downloadLibraryItem} onDownloadEssentialItem={downloadLibraryEssentialItem} />)}
        </div>}
        {!works.isLoading && !works.error && !papers.length && <p className="p-6 text-sm text-muted-foreground">{t("noOpenAlex")}</p>}
        {works.data?.at(-1)?.meta.next_cursor && <div className="flex items-center justify-between gap-3 border-t border-border/50 px-6 py-3">
          <span className="text-sm text-muted-foreground">{t("progress", { loaded: papers.length, total })}</span>
          <Button variant="ghost" size="sm" disabled={works.isValidating} onClick={() => void works.setSize(works.size + 1)}>{works.isValidating && <Spinner />}{t("showMore")}</Button>
        </div>}
      </TabsContent>
    </Tabs>
  </LibraryPageShell>;
}
