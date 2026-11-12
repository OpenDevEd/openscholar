import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageWrapper } from "@/components/PageWrapper";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { PaperPage } from "@/components/papers/paper-page";
import { CorrectReport, ReportMain, ReportSide } from "@/components/reports/report-extras";
import { WithdrawnReport } from "@/components/reports/withdrawn-report";
import { readReport } from "@/lib/reports/paper-data";
import { licenceName, licenceUrl } from "@/lib/reports/report";
import { indexedPage, isLiveSite, SITE_URL } from "@/lib/seo/page-metadata";
import { citeFilePath, paperPageId, paperPath, paperSlug } from "@/lib/papers/page-address";
import { CITATION_FILES, type CitationFile } from "@/lib/citations/formats";
import { copyKeysOf, quietly, readCommunityCopies, readPaperPage, readReferencesForPage, readSimilarForPage } from "@/lib/papers/paper-page-data";
import { topicHref } from "@/lib/topics/links";
import type { PaperResult } from "@/lib/types/search.types";

type Params = { params: Promise<{ id: string; slug?: string[] }> };

/** The paper the address names, both its records as one, or the page's 404. Read once per request, for the metadata and the page. */
const paperOf = cache(async (raw: string) => (await readPaperPage(raw)) ?? notFound());

/** The abstract cut at a word, about as long as a search result shows. */
function snippet(text: string, length = 160) {
  if (text.length <= length) return text;
  return `${text.slice(0, text.lastIndexOf(" ", length - 1))}…`;
}

/** The slug as the title gives it: Next passes some slugs still percent-encoded, and a stray `%` mustn't throw. */
function slugOf(given: string | undefined) {
  try {
    return decodeURIComponent(given ?? "");
  } catch {
    return given ?? "";
  }
}

/** When the record last changed, as the index stamps it. */
const updatedOf = (paper: PaperResult) => (paper as { updated_date?: string | null }).updated_date ?? undefined;

const dateOf = (paper: PaperResult) => paper.publication_date ?? (paper.publication_year ? String(paper.publication_year) : undefined);

/** The report the address names, if it names one that went live: a withdrawn report keeps its address, which says so. */
const reportOf = (asked: string) => readReport(paperPageId(asked) ?? "");

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const report = await reportOf((await params).id);
  if (report?.state === "withdrawn") return { title: `Withdrawn: ${report.title}`, robots: { index: false, follow: false } };
  const { paper, id, detail } = await paperOf((await params).id);
  const t = await getTranslations("metadata");
  const title = paper.title ?? paper.display_name ?? "";
  const journal = paper.primary_location?.source?.display_name;
  const description = detail.abstract ? snippet(detail.abstract) : [title, journal, paper.publication_year].filter(Boolean).join(", ");
  const page = await indexedPage({ path: paperPath(id, title), title: `${title || id} | ${t("siteName")}`, description });
  const live = await isLiveSite();
  // A report's PDF is at an address of ours, which the tags name in full.
  const copy = detail.copies.find((found) => found.pdf)?.url;
  const pdf = copy?.startsWith("/") ? `${SITE_URL}${copy}` : copy;
  return {
    ...page,
    openGraph: { ...page.openGraph, type: "article", publishedTime: dateOf(paper), modifiedTime: updatedOf(paper), authors: detail.authors.map((author) => author.name), images: [{ url: `${SITE_URL}/papers/${id}/cover.png`, width: 1200, height: 630, alt: title }] },
    twitter: { ...page.twitter, card: "summary_large_image", images: [`${SITE_URL}/papers/${id}/cover.png`] },
    // Only a page with its abstract is worth a search result; the rest stay out, as OpenAlex keeps them out of its sitemaps.
    robots: { index: live && !!detail.abstract, follow: live },
    // What Google Scholar reads (its inclusion guidelines name these tags).
    other: Object.fromEntries(Object.entries({
      citation_title: title,
      citation_publication_date: dateOf(paper)?.replaceAll("-", "/"),
      citation_journal_title: journal,
      citation_volume: paper.biblio?.volume,
      citation_issue: paper.biblio?.issue,
      citation_firstpage: paper.biblio?.first_page,
      citation_lastpage: paper.biblio?.last_page,
      citation_doi: paper.doi?.replace(/^https?:\/\/doi\.org\//i, ""),
      citation_pdf_url: pdf,
      citation_issn: detail.ids.issn,
      citation_publisher: detail.publisher,
      citation_language: detail.language,
      citation_abstract_html_url: `${SITE_URL}${paperPath(id, title)}`,
    }).filter(([, value]) => value != null && value !== "" && !(Array.isArray(value) && !value.length))) as Record<string, string | string[]>,
  };
}

export default async function Page({ params }: Params) {
  const { id: asked, slug } = await params;
  const report = await reportOf(asked);
  if (report?.state === "withdrawn") return <PageWrapper><WithdrawnReport report={report} /></PageWrapper>;
  const { paper, id, work, detail } = await paperOf(asked);
  const title = paper.title ?? paper.display_name ?? "";
  // One address per paper: an OpenAlex ID, our bare ID or an old title all lead to it.
  if (asked !== id || slugOf(slug?.[0]) !== paperSlug(title) || (slug?.length ?? 0) > 1) permanentRedirect(paperPath(id, title));
  const references = ((paper as { referenced_works?: string[] }).referenced_works ?? []).map((reference) => reference.split("/").at(-1)!).slice(0, 100);
  // A report's own details beyond a paper's record, and whether the person reading may correct it: its owner and
  // its workspace's admins, whom only a signed-in read can tell.
  const live = report?.state === "live" ? report : null;
  const token = live ? ((await (await auth()).getToken({ template: "convex" })) ?? undefined) : undefined;
  const [similar, referenceRows, communities, mine] = await Promise.all([
    // A report isn't in our index, so nothing is like it there yet.
    live ? [] : readSimilarForPage(id).catch(quietly("similar papers", id, [])),
    readReferencesForPage(references).catch(quietly("references", id, [])),
    readCommunityCopies(paper.doi ?? null, work).catch(quietly("community copies", id, [])),
    token ? fetchQuery(api.reports.paper.mine, { key: id }, { token }).catch(quietly("report's owner", id, null)) : null,
  ]);
  const address = `${SITE_URL}${paperPath(id, title)}`;
  const topic = paper.primary_topic;
  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ScholarlyArticle",
        "@id": address,
        url: address,
        headline: title.slice(0, 110),
        name: title,
        author: detail.authors.map((author) => ({
          "@type": "Person",
          name: author.name,
          sameAs: author.orcid ?? undefined,
          affiliation: author.institutions.map((institution) => ({ "@type": "Organization", name: institution.name })),
        })),
        datePublished: dateOf(paper),
        dateModified: updatedOf(paper),
        // The shapes Google asks an article's images in.
        image: ["16x9", "4x3", "1x1"].map((ratio) => `${SITE_URL}/papers/${id}/cover.png?ratio=${ratio}`),
        isPartOf: paper.primary_location?.source?.display_name ? { "@type": "Periodical", name: paper.primary_location.source.display_name, issn: detail.ids.issn ?? undefined, publisher: detail.publisher ?? undefined } : undefined,
        abstract: detail.abstract ?? undefined,
        sameAs: paper.doi ?? undefined,
        inLanguage: detail.language ?? undefined,
        keywords: detail.keywords.join(", ") || undefined,
        funder: detail.funding.map((funding) => ({ "@type": "Organization", name: funding.funder })),
        about: detail.topics.map((topic) => ({ "@type": "Thing", name: topic.name })),
        citation: referenceRows.map((row) => ({ "@type": "ScholarlyArticle", name: row.title, url: `${SITE_URL}${paperPath(row.id, row.title)}` })),
      },
      topic && {
        "@type": "BreadcrumbList",
        itemListElement: [topic.domain, topic.field, topic.subfield, topic].filter(Boolean).map((node, index) => ({ "@type": "ListItem", position: index + 1, name: node!.display_name, item: new URL(topicHref(node!.id, node!.display_name), SITE_URL).href })),
      },
    ].filter(Boolean),
  };
  return (
    <PageWrapper>
      {/* `<` escaped, so a title can't close the script. */}
      {/* Each author, then that author's institutions and ORCID iD, in order: Google Scholar ties them by position, which metadata's grouped tags can't keep. React moves these into the head. */}
      {detail.authors.flatMap((author, index) => [
        <meta key={`a${index}`} name="citation_author" content={author.name} />,
        ...author.institutions.map((institution, at) => <meta key={`a${index}i${at}`} name="citation_author_institution" content={institution.name} />),
        ...(author.orcid ? [<meta key={`a${index}o`} name="citation_author_orcid" content={author.orcid} />] : []),
      ])}
      {/* One tag per keyword, as Zotero reads them into tags. */}
      {detail.keywords.map((keyword) => <meta key={`k${keyword}`} name="citation_keywords" content={keyword} />)}
      {/* Signposting (signposting.org): the paper's persistent address, its files and its authors, for tools that follow links. */}
      {paper.doi && <link rel="cite-as" href={paper.doi} />}
      {(Object.keys(CITATION_FILES) as CitationFile[]).map((kind) => <link key={kind} rel="describedby" type={CITATION_FILES[kind].type} href={citeFilePath(id, kind)} />)}
      {detail.copies.find((copy) => copy.pdf) && <link rel="item" type="application/pdf" href={detail.copies.find((copy) => copy.pdf)!.url} />}
      {detail.authors.flatMap((author) => author.orcid ? [<link key={author.orcid} rel="author" href={author.orcid} />] : [])}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }} />
      <PaperPage paper={paper} id={id} detail={detail} similar={similar} references={referenceRows} communities={communities} copyKeys={copyKeysOf(paper.doi ?? null, work)} extra={live ? { licence: { name: licenceName(live.metadata.licence), url: licenceUrl(live.metadata.licence) }, main: <ReportMain m={live.metadata} />, side: <ReportSide m={live.metadata} reportKey={id} />, cover: live.coverUrl, coverShape: live.coverShape ?? null, actions: mine ? <CorrectReport id={id} waiting={mine.waiting} slug={mine.slug} /> : undefined } : undefined} />
    </PageWrapper>
  );
}
