"use client";

import { useVocabulary } from "@/lib/openalex/use-vocabulary";
import { creativeCommons } from "@/lib/papers/licence";
import { Fragment, useState, type ReactNode } from "react";
import useSWR from "swr";
import { useAuth, useClerk } from "@clerk/nextjs";
import { dateMoment, dateStyleOf } from "@/lib/reports/report";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { copyText } from "@/components/copy-text";
import Link from "@/components/workspace-link";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { IntroGlow, Stat } from "@/components/entity-cards";
import { PaperRows } from "@/components/papers/paper-rows";
import { PaperShare } from "@/components/papers/paper-links";
import { AuthorName, FunderName, InstitutionName, JournalName, RorLink } from "@/components/papers/paper-entities";
import { CountryFilterFlag } from "@/components/country-filter-flag";
import { PaperCover } from "@/components/papers/paper-cover";
import { REPORT_COVER, coverOf } from "@/lib/papers/cover";
import { CitationControl } from "@/components/citation-control";
import { SaveControl } from "@/components/library/save-control";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { TooltipHint } from "@/components/ui/tooltip";
import { OrcidIcon } from "@/components/icons/author-service-icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { Award, ArrowUpRight, BookOpen, Calendar, Check, ChevronRight, Compass, Copy, FileText, Globe, Library, LockOpen, MessageSquare, RefreshCw, Target, TriangleAlert, Users } from "@/components/icons";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { chatAbout } from "@/lib/assistant/place";
import { topicHref } from "@/lib/topics/links";
import { buildShareableUrl } from "@/lib/search-params";
import { similarSearchHref } from "@/lib/search/similar-href";
import { paperPath } from "@/lib/papers/page-address";
import { abstractSections } from "@/lib/papers/abstract-sections";
import { cn } from "@/lib/utils";
import { readPaperListsLater } from "@/app/actions/paper-lists";
import { PassNotEarned } from "@/lib/visitor-pass";
import type { PaperLists } from "@/lib/papers/paper-page-data";
import type { CommunityCopy } from "@/lib/papers/community-copies";
import { useLiveCopies } from "@/components/papers/use-live-copies";
import type { PaperDetail } from "@/lib/papers/paper-detail";
import type { PaperResult } from "@/lib/types/search.types";
import { plainAbstract } from "@/lib/papers/abstract-text";

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md bg-inset px-2 text-xs text-muted-foreground";
/** How many authors, copies and MeSH terms show before "Show all". */
const AUTHORS_SHOWN = 8;
const COPIES_SHOWN = 4;
const MESH_SHOWN = 12;

type Props = {
  paper: PaperResult;
  id: string;
  detail: PaperDetail;
  /** The papers like it and the ones it cites. Null for a visitor the server ran no searches for: their browser reads them. */
  lists: PaperLists | null;
  /** The paper's records in communities as the server read them, with their PDFs. */
  communities: CommunityCopy[];
  /** The keys they're found by, which the page follows for records published while it's open. */
  copyKeys: string[];
  /** What a report published on Openscholar has beyond a paper's record: sections under the authors and in the sidebar, its PDF's cover, and what only its workspace does. */
  extra?: { main?: ReactNode; side?: ReactNode; /** Under the cover: a report's PDF held back. */ fileNote?: ReactNode; cover?: string | null; /** The report's cover's width over its height, when kept. */ coverShape?: number | null; actions?: ReactNode; /** The licence its author chose, which may be their own. */ licence?: { name: string; url: string } };
};

/** A paper's own page: everything our index and OpenAlex hold about it, at an address search engines and people can open. */
export function PaperPage({ paper, id, detail, lists, communities: read, copyKeys, extra }: Props) {
  const t = useTranslations("paperPage");
  const tc = useTranslations("common");
  const tTopics = useTranslations("topics");
  const tAuthors = useTranslations("authorPages");
  const tp = useTranslations("paperCard");
  const title = paper.title ?? paper.display_name ?? "";
  const communities = useLiveCopies(read, copyKeys);
  // A record published while the page is open fades in; the ones the page opened with are just there.
  const atOpen = new Set(read.map((copy) => copy.id));
  // The ID the app saves, rates and searches by: OpenAlex's where our index pairs one.
  const appId = paper.id.split("/").at(-1)!;
  // A PDF from a source, or else the one a community holds.
  // A community's copy first: it keeps the file itself, where a publisher's link can move or close.
  const pdf = communities.find((copy) => copy.pdf)?.pdf ?? detail.copies.find((copy) => copy.pdf)?.url ?? null;
  const doi = detail.ids.doi ? `https://doi.org/${detail.ids.doi}` : null;
  const topic = paper.primary_topic;
  const topicPath = topic ? [topic.domain, topic.field, topic.subfield, topic].filter((node): node is { id: string; display_name: string } => !!node) : [];
  // The title page and ink this paper always wears; the next paper likely wears another.
  const look = extra ? REPORT_COVER : coverOf(id);
  const communityCover = communities.find((copy) => copy.cover);

  return (
    // The bar holds what a reader does with the paper wherever they have scrolled to: ask about it, cite it, share
    // it, read it. Keeping it is a row of named actions between its header and its abstract.
    <LibraryPageShell icon={FileText} title={title} actions={<>
      <AskAbout id={appId} title={title} />
      <CitationControl paper={paper} compact={false} />
      <PaperShare paper={paper} href={paperPath(id, title)} compact={false} className={BAR_ACTION} labelClassName={BAR_LABEL} />
      {(pdf ?? doi) && <Button size="sm" className={BAR_ACTION} asChild>
        <a href={(pdf ?? doi)!} target="_blank" rel="noopener noreferrer">
          {pdf ? <FileText aria-hidden /> : <ArrowUpRight aria-hidden />}
          <span className={BAR_LABEL}>{pdf ? t("readPdf") : t("publisherPage")}</span>
        </a>
      </Button>}
    </>} intro={
      <header className="relative isolate overflow-hidden p-5 sm:p-8">
        <IntroGlow rings={false} />
        <div className="grid gap-6 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
          <div className="w-28 sm:w-auto sm:self-start">
            <PaperCover
              kind={look.kind}
              ink={look.ink}
              title={title}
              authors={detail.authors.map((author) => author.name)}
              source={detail.journal?.name ?? detail.publisher}
              year={paper.publication_year ?? null}
              type={paper.type ?? null}
              // A community's picture of its PDF's first page opens that PDF.
              // An Openscholar Report wears the cover Openscholar made of its own PDF.
              image={extra?.cover ?? communityCover?.cover ?? null}
              shape={extra?.cover ? (extra.coverShape ?? null) : null}
              href={communityCover?.pdf ?? pdf ?? doi}
              pdf={!!communityCover?.pdf || !!pdf}
            />
            {extra?.fileNote}
          </div>
          <div className="flex min-w-0 flex-col">
            <HeaderChips paper={paper} detail={detail} licence={extra?.licence} />
            {/* The bar's heading is the title; this is the title at reading size. */}
            <p dir="auto" className="mt-4 text-pretty text-2xl font-semibold leading-tight tracking-tight sm:text-[2rem]">{title}</p>
            <AuthorLine detail={detail} fallback={paper.authors_unparsed} />
            {detail.journal ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                <BookOpen aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  <JournalName journal={detail.journal} className="italic text-foreground" />
                  {paper.biblio?.volume && `, ${tp("vol")} ${paper.biblio.volume}`}
                  {paper.biblio?.issue && ` (${paper.biblio.issue})`}
                  {paper.biblio?.first_page && `, ${tp("pp")} ${paper.biblio.first_page}${paper.biblio.last_page && paper.biblio.last_page !== paper.biblio.first_page ? `-${paper.biblio.last_page}` : ""}`}
                  {detail.publisher && <><span aria-hidden className="mx-2.5 inline-block h-3 w-px bg-border align-middle" />{detail.publisher}</>}
                </span>
              </p>
            ) : null}
            {detail.ids.doi ? <DoiLine doi={detail.ids.doi} /> : null}
            <AutoHeight>
            {communities.length ? (
              <div className="flex flex-wrap items-center gap-2 pt-5" aria-label={tAuthors("evidenceLibraries")}>
                <span className="me-1 text-xs text-muted-foreground">{t("inCommunities")}</span>
                {communities.map((copy) => (
                  <a key={copy.id} href={copy.url} target="_blank" rel="noreferrer" className={cn("group inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 ps-2 pe-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring", !atOpen.has(copy.id) && "fade-enter")}>
                    <Library aria-hidden className="size-3.5" />
                    {copy.name}
                    <ArrowUpRight aria-hidden className="size-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
                  </a>
                ))}
              </div>
            ) : null}
            </AutoHeight>
            {topicPath.length ? (
              <nav aria-label={tTopics("classification")} className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground lg:mt-auto lg:pt-6">
                {topicPath.map((node, index) => <Fragment key={node.id}>
                  {index > 0 && <ChevronRight aria-hidden className="size-3" />}
                  <Link href={topicHref(node.id, node.display_name)} className={index === topicPath.length - 1 ? "font-medium text-foreground hover:text-primary" : "hover:text-primary"}>{node.display_name}</Link>
                </Fragment>)}
              </nav>
            ) : null}
          </div>
        </div>
      </header>
    }>
      {/* Keeping the paper: in the library, a collection or a community. At the end, what only its workspace does. */}
      <div className="@container flex flex-wrap items-center gap-2 border-b border-border-subtle px-5 py-3 sm:px-8">
        <SaveControl paper={paper} named />
        {extra?.actions ? <div className="sm:ms-auto">{extra.actions}</div> : null}
      </div>
      <div className="grid gap-x-12 gap-y-10 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          <Section id="paper-abstract" title={tc("abstract")}>
            {detail.abstract ? <Abstract text={plainAbstract(detail.abstract)} /> : <p className="text-sm text-muted-foreground">{t("noAbstract")}</p>}
            {detail.keywords.length ? (
              <div className="mt-5 flex flex-wrap gap-2" aria-label={tTopics("keywords")}>
                {detail.keywords.map((keyword) => <Link key={keyword} href={buildShareableUrl("", { q: keyword })} className="rounded-md bg-inset px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{keyword}</Link>)}
              </div>
            ) : null}
          </Section>
          <Authors detail={detail} />
          {extra?.main}
          {lists ? <Lists paper={paper} lists={lists} /> : <LaterLists paper={paper} id={id} />}
        </div>
        {/* On a phone the citations come before the abstract; beside it they head the sidebar. */}
        <aside className="contents lg:block lg:min-w-0 lg:space-y-10">
          {/* A report nothing has cited yet has no count to show, and none to follow to. */}
          {extra && !detail.citations ? null : (
            <div className="-order-1 lg:order-none">
              <Impact detail={detail} citations={detail.citations} references={paper.referenced_works_count ?? null} fwci={paper.fwci ?? null} year={paper.publication_year ?? null} citingHref={buildShareableUrl("", { cites: appId })} />
            </div>
          )}
          <Copies copies={detail.copies} />
          {detail.funding.length ? (
            <Section id="paper-funding" title={t("funding")}>
              <ul className="space-y-3">
                {detail.funding.map((funding) => (
                  <li key={funding.funder} className="text-sm">
                    <p className="font-medium"><FunderName id={funding.id} name={funding.funder} /></p>
                    {funding.awards.length ? <div className="mt-1 flex flex-wrap gap-1.5">{funding.awards.map((award) => <span key={award} dir="ltr" className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{award}</span>)}</div> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Subjects detail={detail} />
          {extra?.side}
          <Details detail={detail} />
        </aside>
      </div>
    </LibraryPageShell>
  );
}

/** The DOI where it's seen: under the journal, opening the paper, with a button that copies it. */
function DoiLine({ doi }: { doi: string }) {
  const t = useTranslations("paperPage");
  const tToast = useTranslations("toast");
  const [copied, setCopied] = useState(false);
  return (
    <p className="mt-2 flex items-center gap-2 text-sm">
      <span className="inline-flex h-5 items-center rounded bg-inset px-1.5 text-[11px] font-semibold text-muted-foreground">DOI</span>
      <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener noreferrer" dir="ltr" className="min-w-0 truncate font-mono text-[13px] hover:text-primary hover:underline">{doi}</a>
      <TooltipHint label={copied ? t("doiCopied") : t("copyDoi")}>
        {/* Each press decides the tick: a refused copy after one that worked takes it away. */}
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={t("copyDoi")} onClick={async () => {
          setCopied(await copyText(`https://doi.org/${doi}`, { copied: t("doiCopied"), failed: t("doiCopyFailed"), select: tToast("copyFailedDescription") }));
        }}>{copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}</Button>
      </TooltipHint>
    </p>
  );
}

/** The abstract, in its labelled parts when the journal wrote it in parts. */
function Abstract({ text }: { text: string }) {
  const sections = abstractSections(text);
  if (!sections) return <p dir="auto" className="text-[15px] leading-7">{text}</p>;
  return (
    <div dir="auto" className="space-y-4 text-[15px] leading-7">
      {sections.map((section) => (
        <p key={section.heading}><span className="me-2 font-semibold text-foreground">{section.heading}</span>{section.text}</p>
      ))}
    </div>
  );
}

/** The papers like this one and the ones it cites, each a section while it has any. */
function Lists({ paper, lists: { similar, references } }: { paper: PaperResult; lists: PaperLists }) {
  const t = useTranslations("paperPage");
  const tSimilar = useTranslations("similarPapers");
  return (
    <>
      {similar.length ? (
        <Section id="paper-similar" title={tSimilar("title")} action={<SeeAll href={similarSearchHref([paper.id]) ?? "/results"} />}>
          <PaperRows papers={similar} link={(row) => ({ href: paperPath(row.id, row.title) })} />
        </Section>
      ) : null}
      {references.length ? (
        <Section id="paper-references" title={t("references")} count={paper.referenced_works_count ?? references.length} action={<SeeAll href={buildShareableUrl("", { citedBy: paper.id.split("/").at(-1)! })} />}>
          <PaperRows papers={references} link={(row) => ({ href: paperPath(row.id, row.title) })} />
        </Section>
      ) : null}
    </>
  );
}

/**
 * The lists as the browser reads them, for a visitor the server ran no searches for. They open their place at the
 * column's foot as they arrive and fade in; a read that fails leaves the page without them, as the server's does. One
 * stopped for a check the visitor didn't pass says so in their place, with Try again, as the overview and search do.
 */
function LaterLists({ paper, id }: { paper: PaperResult; id: string }) {
  const t = useTranslations("overview");
  // Asked once: a browser Cloudflare won't give its pass, or a visitor who sent its check away, isn't asked again
  // until Try again.
  const { data, error, isValidating, mutate } = useSWR(["paper-lists", id], ([, asked]) => readPaperListsLater(asked), { revalidateOnFocus: false, shouldRetryOnError: false });
  return (
    // The column spaces its parts with a margin under each but the last. Empty, this takes that margin back, so the
    // column ends where it would without lists; filled, the same space is its own, above its first section.
    <AutoHeight className="-mt-10">
      {data?.similar.length || data?.references.length ? (
        <div className="fade-enter space-y-10 pt-10"><Lists paper={paper} lists={data} /></div>
      ) : error instanceof PassNotEarned && !isValidating ? (
        <div role="status" className="fade-enter flex flex-wrap items-center gap-3 pt-10 text-sm text-muted-foreground">
          <span className="flex-1">{t("failed.verify")}</span>
          <Button size="sm" variant="outline" onClick={() => void mutate()}>
            <RefreshCw /> {t("tryAgain")}
          </Button>
        </div>
      ) : null}
    </AutoHeight>
  );
}

/** A part of the page: a quiet heading with its count and its one action, then what it holds. */
export function Section({ id, title, count, action, children }: { id: string; title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  const format = useFormatter();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h2 id={id} className="flex scroll-mt-36 items-baseline gap-2 text-sm font-medium text-muted-foreground">
          {title}
          {count != null && <span className="text-xs tabular-nums text-muted-foreground/70">{format.number(count)}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SeeAll({ href }: { href: string }) {
  const t = useTranslations("similarPapers");
  return (
    <Button variant="ghost" size="sm" className="-me-2 h-7 gap-1.5 px-2 text-xs" asChild>
      <Link href={href}><Compass className="size-3.5" />{t("seeAll")}</Link>
    </Button>
  );
}

function HeaderChips({ paper, detail, licence }: { paper: PaperResult; detail: PaperDetail; licence?: { name: string; url: string } | undefined }) {
  const { workType } = useVocabulary();
  const t = useTranslations("paperPage");
  const format = useFormatter();
  const locale = useLocale();
  // As precisely as the work states it: a report's PDF may give only a month or a year.
  const dated = paper.publication_date ? dateMoment(paper.publication_date) : null;
  const license = licence ?? detail.copies.map((copy) => creativeCommons(copy.license)).find(Boolean);
  const language = detail.language && detail.language !== locale.split("-")[0] ? new Intl.DisplayNames([locale], { type: "language" }).of(detail.language) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {detail.retracted ? <span className={`${CHIP} bg-destructive/10 text-destructive`}><TriangleAlert aria-hidden className="size-3.5" />{t("retracted")}</span> : null}
      {dated || paper.publication_year ? <span className={CHIP}><Calendar aria-hidden className="size-3.5" />{dated ? format.dateTime(dated.at, dateStyleOf(dated.parts, "short")) : paper.publication_year}</span> : null}
      {paper.type ? <span className={CHIP}><FileText aria-hidden className="size-3.5" />{workType(paper.type)}</span> : null}
      {/* Bronze is free to read without a licence that lets anyone share it: "Open access" read as leave to pass it on. */}
      {paper.open_access?.is_oa ? <span className={`${CHIP} bg-success/15 ink-success`}><LockOpen aria-hidden className="size-3.5" />{t(paper.open_access.oa_status === "bronze" ? "freeToRead" : "openAccess")}</span> : null}
      {license?.url ? (
        <a href={license.url} target="_blank" rel="noreferrer license" className={`${CHIP} hover:text-foreground`}>{license.name}</a>
      ) : license ? (
        <span className={CHIP}>{license.name}</span>
      ) : null}
      {language ? <span className={CHIP}><Globe aria-hidden className="size-3.5" />{language}</span> : null}
    </div>
  );
}


/** The first few authors under the title; the rest are in the Authors part below. */
function AuthorLine({ detail, fallback }: { detail: PaperDetail; fallback?: string }) {
  const t = useTranslations("paperPage");
  const [all, setAll] = useState(false);
  const shown = all ? detail.authors : detail.authors.slice(0, 6);
  if (!shown.length && !fallback) return null;
  const more = detail.authors.length - shown.length;
  return (
    // Every name opens where the first few are, the frame sliding to its new height.
    <AutoHeight className="mt-4">
      <p className="flex items-start gap-2 text-sm">
        <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          {shown.length ? shown.map((author, index) => <Fragment key={`${author.name}-${index}`}>{index > 0 && ", "}<AuthorName id={author.id} name={author.name} /></Fragment>) : fallback}
          {more > 0 && <> <button type="button" onClick={() => setAll(true)} className="rounded-sm text-muted-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">{t("andMore", { count: more })}</button></>}
        </span>
      </p>
    </AutoHeight>
  );
}

/** The citation count and where it stands, how it grew year by year, and how the field and Semantic Scholar weigh it. */
function Impact({ detail, citations, references, fwci, year, citingHref }: { detail: PaperDetail; citations: number; references: number | null; fwci: number | null; year: number | null; citingHref: string }) {
  const t = useTranslations("paperPage");
  const tCard = useTranslations("entityCards");
  const format = useFormatter();
  const [pointed, setPointed] = useState<number | null>(null);
  const bars = detail.citationsByYear.slice(-12);
  const most = Math.max(1, ...bars.map((bar) => bar.count));
  const shown = pointed == null ? null : bars[pointed];
  const rank = detail.rank?.top1 ? t("top1") : detail.rank?.top10 ? t("top10") : null;
  const stats = [
    // Said in words, not as FWCI: how many times its field's average citations it has.
    fwci != null ? { value: Number(fwci.toFixed(2)), label: t("fieldAverage") } : null,
    detail.influentialCitations != null ? { value: detail.influentialCitations, label: t("influential") } : null,
    references ? { value: references, label: t("references") } : null,
  ].filter((stat) => stat !== null);
  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-card/80 p-5 shadow-xs ring-1 ring-border-subtle backdrop-blur-sm">
      <div>
        <div className="flex items-start justify-between gap-3">
          <Link href={citingHref} aria-label={t("seeCiting")} className="group rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            <span className="block text-4xl font-semibold leading-none tracking-tight tabular-nums">{format.number(citations)}</span>
            <span className="mt-1.5 flex items-center gap-1 text-sm text-muted-foreground group-hover:text-primary">{tCard("citations")}<ArrowUpRight aria-hidden className="size-3.5" /></span>
          </Link>
          {rank ? <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary"><Award aria-hidden className="size-3.5" />{rank}</span> : null}
        </div>
        {detail.rank?.yearPercentile != null && year ? <p className="mt-2 text-xs text-muted-foreground">{t("aheadOf", { percent: detail.rank.yearPercentile, year })}</p> : null}
      </div>
      {bars.length > 1 ? (
        <div>
          <p className="mb-2 h-4 text-xs tabular-nums text-muted-foreground" aria-live="polite">{shown ? t("citationsIn", { count: shown.count, year: shown.year }) : t("citationsPerYear")}</p>
          {/* Tab reaches it and the arrow keys move between years, as the pointer does, so the readout above shows each one. */}
          <div
            role="img"
            tabIndex={0}
            aria-label={bars.map((bar) => t("citationsIn", { count: bar.count, year: bar.year })).join(", ")}
            className="flex h-20 items-end gap-[3px] rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            onPointerLeave={() => setPointed(null)}
            onFocus={() => setPointed(bars.length - 1)}
            onBlur={() => setPointed(null)}
            onKeyDown={(event) => {
              const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
              if (!step) return;
              event.preventDefault();
              setPointed(Math.min(bars.length - 1, Math.max(0, (pointed ?? bars.length - 1) + step)));
            }}
          >
            {bars.map((bar, index) => (
              <div key={bar.year} className="flex h-full flex-1 items-end" onPointerEnter={() => setPointed(index)}>
                <div
                  className={cn("w-full rounded-[3px] transition-colors duration-150", index === bars.length - 1 && bar.year === detail.thisYear ? "bg-primary/35" : "bg-primary/75", pointed === index && "bg-primary")}
                  style={{ height: `${Math.max(4, (bar.count / most) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground"><span>{bars[0]!.year}</span><span>{bars.at(-1)!.year}</span></div>
        </div>
      ) : null}
      {stats.length ? (
        <div className="mt-auto grid grid-cols-3 gap-3 border-t border-border-subtle pt-4">
          {stats.map((stat) => <Stat key={stat.label} value={stat.value} label={stat.label} />)}
        </div>
      ) : null}
    </div>
  );
}

/** Every author, with their ORCID iD and institutions; the first few show, the rest on request. */
function Authors({ detail }: { detail: PaperDetail }) {
  const t = useTranslations("paperPage");
  const [all, setAll] = useState(false);
  if (!detail.authors.length && !detail.institutions.length) return null;
  const hidden = detail.authors.length - AUTHORS_SHOWN;
  const anyAffiliation = detail.authors.some((author) => author.institutions.length);
  return (
    <Section id="paper-authors" title={t("authors")} count={detail.authors.length || undefined} action={hidden > 0 ? (
      <Button variant="ghost" size="sm" className="-me-2 h-7 px-2 text-xs" aria-expanded={all} onClick={() => setAll((value) => !value)}>{all ? t("showFewer") : t("showAll", { count: detail.authors.length })}</Button>
    ) : undefined}>
      <AutoHeight>
        <ul className={cn("grid gap-x-8 sm:grid-cols-2", anyAffiliation ? "gap-y-4" : "gap-y-2")}>
          {detail.authors.map((author, index) => (
            <li key={`${author.name}-${index}`} className={cn("min-w-0", !all && index >= AUTHORS_SHOWN && "hidden")}>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <AuthorName id={author.id} name={author.name} className="break-words" />
                {author.orcid ? (
                  <TooltipHint label={t("orcidOf", { name: author.name })}>
                    <a href={author.orcid} target="_blank" rel="noreferrer" aria-label={t("orcidOf", { name: author.name })} className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"><OrcidIcon className="size-3.5" /></a>
                  </TooltipHint>
                ) : null}
                {author.corresponding ? <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">{t("corresponding")}</span> : null}
              </div>
              {author.institutions.length ? (
                <ul className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {author.institutions.map((institution, place) => (
                    <li key={`${institution.name}-${place}`} className="flex items-start gap-1.5">
                      {/* The flag stays on the name's first line when a long name wraps. */}
                      {institution.country && <CountryFilterFlag code={institution.country} className="mt-1" />}
                      <InstitutionName institution={institution} className="min-w-0" />
                      {/* Like the flag, the ROR mark stays on the name's first line when a long name wraps: the name is a button, which wraps as one box. */}
                      {institution.ror ? <RorLink ror={institution.ror} label={t("rorOf", { name: institution.name })} className="mt-0.5" /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </AutoHeight>
      {/* Our index lists a paper's institutions without saying whose they are. */}
      {!anyAffiliation && detail.institutions.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label={t("institutions")}>
          {detail.institutions.map((institution, index) => <span key={`${institution.name}-${index}`} className={CHIP}>{institution.country && <CountryFilterFlag code={institution.country} />}<InstitutionName institution={institution} />{institution.ror ? <RorLink ror={institution.ror} label={t("rorOf", { name: institution.name })} /> : null}</span>)}
        </div>
      ) : null}
    </Section>
  );
}

/** Every place the paper can be read: the journal, repositories and indexes, with which hold a PDF and under what licence. */
function Copies({ copies }: { copies: PaperDetail["copies"] }) {
  const t = useTranslations("paperPage");
  const [all, setAll] = useState(false);
  if (!copies.length) return null;
  const kind = { publisher: t("kindPublisher"), repository: t("kindRepository"), index: t("kindIndex") };
  return (
    <Section id="paper-copies" title={t("whereToRead")} count={copies.length} action={copies.length > COPIES_SHOWN ? (
      <Button variant="ghost" size="sm" className="-me-2 h-7 px-2 text-xs" aria-expanded={all} onClick={() => setAll((value) => !value)}>{all ? t("showFewer") : t("showAll", { count: copies.length })}</Button>
    ) : undefined}>
      {/* The rows reach past the column by their own padding: the frame does too, or it cuts off their hover and focus ring. */}
      <AutoHeight className="-mx-2">
        <ul className="space-y-0.5">
          {copies.map((copy, index) => (
            <li key={copy.name} className={cn(!all && index >= COPIES_SHOWN && "hidden")}>
              <a href={copy.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <span className={cn("flex size-8 shrink-0 items-center justify-center self-start rounded-lg", copy.pdf ? "bg-success/15 ink-success" : "bg-inset text-muted-foreground")}>
                  {copy.pdf ? <FileText aria-hidden className="size-4" /> : copy.kind === "publisher" ? <BookOpen aria-hidden className="size-4" /> : <Library aria-hidden className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:text-primary">{copy.name}</span>
                  <span className="block text-xs text-muted-foreground">{kind[copy.kind]}{copy.pdf ? <span className="ms-1.5 ink-success">{t("pdf")}</span> : null}{creativeCommons(copy.license) ? <span className="ms-1.5">{creativeCommons(copy.license)!.name}</span> : null}</span>
                </span>
                <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      </AutoHeight>
    </Section>
  );
}

/** What the paper is about: its topics by how closely they fit, the goals it serves and its MeSH terms. */
function Subjects({ detail }: { detail: PaperDetail }) {
  const t = useTranslations("paperPage");
  const { sdg } = useVocabulary();
  const [allMesh, setAllMesh] = useState(false);
  if (!detail.topics.length && !detail.sdgs.length && !detail.mesh.length) return null;
  const mesh = allMesh ? detail.mesh : detail.mesh.slice(0, MESH_SHOWN);
  return (
    <Section id="paper-topics" title={t("topics")}>
      {detail.topics.length ? (
        <div className="-mx-2 space-y-0.5">
          {detail.topics.map((topic) => (
            <Link key={topic.id} href={topicHref(topic.id, topic.name)} className="relative flex min-h-8 items-center gap-3 overflow-hidden rounded-md px-2 py-1 text-sm transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
              {topic.score != null && <span aria-hidden className="absolute inset-y-0 start-0 rounded-md bg-primary/10" style={{ width: `${Math.round(topic.score * 100)}%` }} />}
              <span className="relative min-w-0 flex-1">{topic.name}</span>
            </Link>
          ))}
        </div>
      ) : null}
      {detail.sdgs.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label={t("sdgs")}>
          {detail.sdgs.map((goal) => <Link key={goal.id} href={buildShareableUrl("", { sdg: [goal.id] })} className={`${CHIP} bg-success/10 ink-success transition-colors hover:bg-success/20`}><Target aria-hidden className="size-3.5" />{sdg(goal.id, goal.name)}</Link>)}
        </div>
      ) : null}
      {detail.mesh.length ? (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">{t("mesh")}</p>
          <div className="flex flex-wrap gap-1.5">
            {mesh.map((term) => <Link key={term.name} href={buildShareableUrl("", { q: term.name })} className={cn("rounded-md bg-inset px-2 py-0.5 text-xs transition-colors hover:bg-primary/10 hover:text-primary", term.major ? "font-medium text-foreground" : "text-muted-foreground")}>{term.name}</Link>)}
            {detail.mesh.length > MESH_SHOWN && <button type="button" onClick={() => setAllMesh((value) => !value)} aria-expanded={allMesh} className="rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-primary">{allMesh ? t("showFewer") : t("showAll", { count: detail.mesh.length })}</button>}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

/** The paper's identifiers, each opening where it leads, and what the journal charges to publish. */
function Details({ detail }: { detail: PaperDetail }) {
  const t = useTranslations("paperPage");
  const format = useFormatter();
  const { ids } = detail;
  const rows: { label: string; value: string; href?: string; icon?: ReactNode }[] = [
    ids.pmid ? { label: "PubMed", value: ids.pmid, href: `https://pubmed.ncbi.nlm.nih.gov/${ids.pmid}/` } : null,
    ids.pmcid ? { label: "PubMed Central", value: ids.pmcid, href: `https://pmc.ncbi.nlm.nih.gov/articles/${ids.pmcid}/` } : null,
    ids.issn ? { label: "ISSN", value: ids.issn } : null,
    ids.openalex ? { label: "OpenAlex", value: ids.openalex, href: `https://openalex.org/${ids.openalex}`, icon: <OpenAlexIcon className="size-3.5" /> } : null,
    { label: t("openscholarId"), value: ids.openscholar },
    detail.charge ? { label: t("charge"), value: format.number(detail.charge.amount, { style: "currency", currency: detail.charge.currency, maximumFractionDigits: 0 }) } : null,
  ].filter((row) => row !== null);
  return (
    <Section id="paper-details" title={t("details")}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0">
              {row.href
                ? <a href={row.href} target="_blank" rel="noopener noreferrer" dir="ltr" className="inline-flex max-w-full items-center gap-1.5 rounded-sm font-mono text-xs hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">{row.icon}<span className="truncate">{row.value}</span></a>
                : <span dir="ltr" className="block truncate font-mono text-xs">{row.value}</span>}
            </dd>
          </Fragment>
        ))}
      </dl>
    </Section>
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
