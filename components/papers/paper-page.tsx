"use client";

import { Fragment } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import Link from "@/components/workspace-link";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { IntroGlow, Stat } from "@/components/entity-cards";
import { AuthorNames, InstitutionsLine } from "@/components/paper-card/shared";
import { SimilarPapers } from "@/components/focus-mode/similar-papers";
import { CitationControl } from "@/components/citation-control";
import { SaveControl } from "@/components/library/save-control";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, BookOpen, Calendar, ChevronRight, Copy, FileText, Library, LockOpen, MessageSquare, Users } from "@/components/icons";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { chatAbout } from "@/lib/assistant/place";
import { topicHref } from "@/lib/topics/links";
import { buildShareableUrl } from "@/lib/search-params";
import type { SimilarPaper } from "@/app/actions/similar";
import type { CommunityCopy } from "@/lib/papers/paper-page-data";
import type { PaperResult } from "@/lib/types/search.types";

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md bg-inset px-2 text-xs text-muted-foreground";

/** A paper's own page: what the focus mode sheet shows, at an address search engines and people can open. */
export function PaperPage({ paper, id, similar, communities }: { paper: PaperResult; id: string; similar: SimilarPaper[]; communities: CommunityCopy[] }) {
  const t = useTranslations("paperPage");
  const tc = useTranslations("common");
  const tLabels = useTranslations("labels");
  const tCard = useTranslations("entityCards");
  const tTopics = useTranslations("topics");
  const tAuthors = useTranslations("authorPages");
  const tSimilar = useTranslations("similarPapers");
  const tp = useTranslations("paperCard");
  const title = paper.title ?? paper.display_name ?? "";
  const pdf = paper.best_oa_location?.pdf_url ?? paper.primary_location?.pdf_url ?? paper.open_access?.oa_url ?? null;
  const doi = paper.doi ? (paper.doi.startsWith("http") ? paper.doi : `https://doi.org/${paper.doi}`) : null;
  const journal = paper.primary_location?.source?.display_name;
  const topic = paper.primary_topic;
  const topicPath = topic ? [topic.domain, topic.field, topic.subfield, topic].filter((node): node is { id: string; display_name: string } => !!node) : [];
  const keywords = ((paper as { keywords?: { id: string; display_name: string }[] }).keywords ?? []).slice(0, 8);
  const stats = [
    { value: paper.cited_by_count ?? 0, label: tCard("citations") },
    paper.referenced_works_count ? { value: paper.referenced_works_count, label: t("references") } : null,
    paper.fwci != null ? { value: Number(paper.fwci.toFixed(2)), label: tLabels("fwci") } : null,
  ].filter((stat) => stat !== null);

  return (
    <LibraryPageShell icon={FileText} title={title} actions={<>
      <AskAbout id={id} title={title} />
      <CitationControl paper={paper} compact={false} />
      <SaveControl paper={paper} compact className="max-sm:hidden" />
      <Button variant="outline" size="sm" className={BAR_ACTION} onClick={async () => {
        try { await navigator.clipboard.writeText(location.href); toast.success(t("linkCopied")); }
        catch { toast.error(tTopics("copyFailed")); }
      }}><Copy aria-hidden /><span className={BAR_LABEL}>{tTopics("copyLink")}</span></Button>
      {(pdf ?? doi) && <Button size="sm" className={BAR_ACTION} asChild>
        <a href={(pdf ?? doi)!} target="_blank" rel="noopener noreferrer">
          {pdf ? <FileText aria-hidden /> : <ArrowUpRight aria-hidden />}
          <span className={BAR_LABEL}>{pdf ? t("readPdf") : t("publisherPage")}</span>
        </a>
      </Button>}
    </>} intro={
      <header className="relative isolate overflow-hidden p-5 sm:p-6">
        <IntroGlow />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.5fr)] lg:gap-14">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {paper.publication_year ? <span className={CHIP}><Calendar aria-hidden className="size-3.5" />{paper.publication_year}</span> : null}
              {paper.type ? <span className={`${CHIP} capitalize`}><FileText aria-hidden className="size-3.5" />{paper.type.replace(/-/g, " ")}</span> : null}
              {paper.open_access?.is_oa ? <span className={`${CHIP} bg-success/15 ink-success`}><LockOpen aria-hidden className="size-3.5" />{t("openAccess")}</span> : null}
            </div>
            {/* The bar's heading is the title; this is the title at reading size. */}
            <p dir="auto" className="mt-4 text-pretty text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{title}</p>
            {paper.authorships?.length || paper.authors_unparsed ? (
              <p className="mt-4 flex items-start gap-2 text-sm">
                <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span><AuthorNames authorships={paper.authorships ?? []} unparsed={paper.authors_unparsed} /></span>
              </p>
            ) : null}
            <InstitutionsLine authorships={paper.authorships ?? []} className="mt-2" />
            {journal ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                <BookOpen aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="italic">{journal}</span>
                  {paper.biblio?.volume && `, ${tp("vol")} ${paper.biblio.volume}`}
                  {paper.biblio?.issue && ` (${paper.biblio.issue})`}
                  {paper.biblio?.first_page && `, ${tp("pp")} ${paper.biblio.first_page}${paper.biblio.last_page ? `-${paper.biblio.last_page}` : ""}`}
                </span>
              </p>
            ) : null}
            {topicPath.length ? (
              <nav aria-label={tTopics("classification")} className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {topicPath.map((node, index) => <Fragment key={node.id}>
                  {index > 0 && <ChevronRight aria-hidden className="size-3" />}
                  <Link href={topicHref(node.id, node.display_name)} className={index === topicPath.length - 1 ? "font-medium text-foreground hover:text-primary" : "hover:text-primary"}>{node.display_name}</Link>
                </Fragment>)}
              </nav>
            ) : null}
          </div>
          <div className="flex flex-col justify-center gap-6">
            <div className="grid max-w-md grid-cols-3 gap-3">
              {stats.map((stat) => <Stat key={stat.label} value={stat.value} label={stat.label} />)}
            </div>
            {communities.length ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label={tAuthors("evidenceLibraries")}>
                <span className="text-xs text-muted-foreground">{tAuthors("publishedIn")}</span>
                {communities.map((copy) => (
                  <a key={copy.id} href={copy.url} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-2 rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
                    <Library aria-hidden className="size-4 text-primary" />
                    <span className="text-sm font-medium group-hover:text-primary">{copy.name}</span>
                    <ArrowUpRight aria-hidden className="size-3 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>
    }>
      {/* Similar papers sit beside the abstract where the card is wide enough, under it otherwise. */}
      <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:gap-10 lg:[&>section+section]:border-t-0 lg:[&>section+section]:pt-0">
        <section aria-labelledby="paper-abstract">
          <h2 id="paper-abstract" className="mb-2 text-sm font-medium text-muted-foreground">{tc("abstract")}</h2>
          {paper.abstract
            ? <p dir="auto" className="max-w-3xl text-[15px] leading-7">{paper.abstract}</p>
            : <p className="text-sm text-muted-foreground">{t("noAbstract")}</p>}
          {keywords.length ? (
            <div className="mt-4 flex flex-wrap gap-2" aria-label={tTopics("keywords")}>
              {keywords.map((keyword) => <Link key={keyword.id} href={buildShareableUrl("", { q: keyword.display_name })} className="rounded-md bg-inset px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{keyword.display_name}</Link>)}
            </div>
          ) : null}
        </section>
        {similar.length ? <SimilarPapers paperId={id} initial={similar} /> : <p className="sr-only">{tSimilar("none")}</p>}
      </div>
    </LibraryPageShell>
  );
}

/** Starts a chat about the paper, as "Start chat" does for a search; a visitor signs in first. */
function AskAbout({ id, title }: { id: string; title: string }) {
  const t = useTranslations("paperPage");
  const enabled = useFeatureFlag("assistant.enabled");
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  if (isSignedIn && !enabled) return null;
  return (
    <Button variant="outline" size="sm" className={BAR_ACTION} onClick={() => (isSignedIn ? chatAbout({ kind: "paper", id, label: title }) : openSignIn())}>
      <MessageSquare aria-hidden />
      <span className={BAR_LABEL}>{t("askAbout")}</span>
    </Button>
  );
}
