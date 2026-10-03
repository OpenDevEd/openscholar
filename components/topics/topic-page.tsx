"use client";

import { useRatedPapers } from "@/lib/research/reads";
import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { ArrowUpRight, BookOpen, ChevronRight, Copy, Network } from "lucide-react";
import { toast } from "sonner";
import { readTopic, readTopicWorks } from "@/app/actions/topics";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { PaperCard } from "@/components/paper-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FocusMode } from "@/components/ui/focus-mode";
import { downloadLibraryItem, downloadLibraryEssentialItem } from "@/lib/library/download-handlers";
import { useUIStore } from "@/lib/store";
import type { TopicNode } from "@/lib/topics/catalog";
import { topicHref } from "@/lib/topics/links";
import { TopicLibraryResults, useTopicLibraryResults } from "./topic-library-results";
import { ListEmpty, ListLoading, ListSearch, ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { buildShareableUrl } from "@/lib/search-params";
import { OpenAlexLimitedError, unlessLimited } from "@/lib/openalex/limited";

export function TopicPage({ topic, path, related, detail: initialDetail }: { topic: TopicNode; path: TopicNode[]; related: TopicNode[]; detail: Awaited<ReturnType<typeof readTopic>> | null }) {
  const t = useTranslations("topics");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const locale = useLocale();
  const [tab, setTab] = useState<"libraries" | "openalex">("libraries");
  const library = useTopicLibraryResults(topic.id);
  const [showRelated, setShowRelated] = useState(false);
  // The server sends the saved description; the browser only asks when that failed.
  const detail = useSWR(["topic", topic.id], ([, id]) => readTopic(id), {fallbackData: initialDetail ?? undefined, revalidateOnMount: !initialDetail, revalidateOnFocus: false});
  const works = useSWRInfinite((_page, previous) => {
    if (tab !== "openalex" || (previous && !previous.meta.next_cursor)) return null;
    return ["topic-works", topic.id, previous?.meta.next_cursor ?? "*"] as const;
  }, ([, id, cursor]) => unlessLimited(readTopicWorks(id, cursor)));
  // A paper is shown once its rating is read, so its card opens at its final size.
  const rated = useRatedPapers(works.data?.flatMap(page => page.results) ?? []);
  const papers = rated.papers;
  const loadingPapers = works.isLoading || rated.loading;
  const total = works.data?.[0]?.meta.count ?? 0;
  const isFocusModeOpen = useUIStore(state => state.isFocusModeOpen);

  return <LibraryPageShell icon={Network} title={topic.name} backHref="/topics" backLabel={t("back")} actions={<>
    <Button variant="outline" size="sm" className={BAR_ACTION} onClick={async () => {
      try { await navigator.clipboard.writeText(location.href); toast.success(t("linkCopied")); }
      catch { toast.error(t("copyFailed")); }
    }}><Copy aria-hidden /><span className={BAR_LABEL}>{t("copyLink")}</span></Button>
    <Button variant="outline" size="sm" className={BAR_ACTION} asChild><a href={`https://openalex.org/${topic.id}`} target="_blank" rel="noreferrer"><OpenAlexIcon className="size-4 shrink-0" /><span className={BAR_LABEL}>OpenAlex</span><ArrowUpRight aria-hidden className="@max-3xl:hidden" /></a></Button>
  </>} tabs={<ListViewTabs label={t("publicationsView")} value={tab} onChange={setTab} tabs={[
    {value: "libraries", label: tc("evidenceLibraries"), icon: <BookOpen aria-hidden className="size-3.5" />, count: library.count},
    {value: "openalex", label: "OpenAlex", icon: <OpenAlexIcon className="size-3.5 shrink-0" />, count: detail.data?.worksCount.toLocaleString(locale)},
  ]} />} filters={tab === "libraries" && <ListSearch aria-label={t("searchLibrary")} placeholder={t("searchPlaceholder")} value={library.query} maxLength={200} onChange={event => void library.setQuery(event.target.value)} />} filtersInCard intro={
    <div className="space-y-4 p-4 sm:p-6">
      <nav aria-label={t("classification")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {path.map((node, index) => <span key={node.id} className="inline-flex items-center gap-2">
          {index > 0 && <ChevronRight aria-hidden className="size-3" />}
          <Link href={topicHref(node.id, node.name)} className="hover:text-primary">{node.name}</Link>
        </span>)}
      </nav>
      {detail.data?.description && <p className="max-w-4xl text-sm leading-relaxed">{detail.data.description}</p>}
      {!detail.data && !detail.error && <Spinner aria-label={t("loadingDescription")} className="size-4 text-muted-foreground" />}
      {detail.error && <div role="alert" className="flex items-center gap-2 text-sm text-muted-foreground">{t("descriptionFailed")}<Button size="sm" variant="ghost" onClick={() => void detail.mutate()}>{t("tryAgain")}</Button></div>}
      {!!detail.data?.keywords.length && <div className="flex flex-wrap gap-2" aria-label={t("keywords")}>{detail.data.keywords.map(keyword => <Link key={keyword} href={buildShareableUrl("", { q: keyword })} className="rounded-md bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{keyword}</Link>)}</div>}
      {!!related.length && <div>
        <Button variant="ghost" size="sm" className="-ml-3" aria-expanded={showRelated} onClick={() => setShowRelated(value => !value)}><Network aria-hidden />{showRelated ? t("hideRelated") : t("related")}<span className="text-muted-foreground">{related.length}</span></Button>
        {showRelated && <div className="mt-2 grid gap-1 sm:grid-cols-2">{related.map(node => <Link className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted/30 hover:text-primary" key={node.id} href={`/topics/${node.id}`}>{node.name}<ArrowUpRight aria-hidden className="size-3.5 shrink-0" /></Link>)}</div>}
      </div>}
    </div>
  }>
    {/* Keyed by tab, so the new list fades in instead of popping. */}
    <div key={tab} className="fade-enter">
    {tab === "libraries" ? <TopicLibraryResults state={library} /> : <div>
        <FocusMode isOpen={isFocusModeOpen} onClose={() => useUIStore.getState().setIsFocusModeOpen(false)} papers={papers} onDownloadItem={downloadLibraryItem} onDownloadEssentialItem={downloadLibraryEssentialItem} />
        {works.error && <div role="alert" className="flex items-center gap-3 p-6 text-sm">{works.error instanceof OpenAlexLimitedError ? tToast("tooManyRequestsDescription") : t("publicationsFailed")}<Button variant="outline" size="sm" onClick={() => void works.mutate()}>{t("tryAgain")}</Button></div>}
        {loadingPapers && !papers.length && <ListLoading label={t("loadingPublications")} />}
        {papers.length > 0 && <div className="space-y-4 p-4 sm:p-6">
          {papers.map((paper, index) => <PaperCard key={paper.id} result={paper} resultIndex={index} viewMode="list-simple" onDownloadItem={downloadLibraryItem} onDownloadEssentialItem={downloadLibraryEssentialItem} />)}
        </div>}
        {!loadingPapers && !works.error && !papers.length && <ListEmpty icon={OpenAlexIcon}>{t("noOpenAlex")}</ListEmpty>}
        {works.data?.at(-1)?.meta.next_cursor && <div className="flex items-center justify-between gap-3 border-t border-border/50 px-6 py-3">
          <span className="text-sm text-muted-foreground">{t("progress", { loaded: papers.length, total })}</span>
          <Button variant="ghost" size="sm" disabled={works.isValidating} onClick={() => void works.setSize(works.size + 1)}>{works.isValidating && <Spinner />}{t("showMore")}</Button>
        </div>}
    </div>}
    </div>
  </LibraryPageShell>;
}
