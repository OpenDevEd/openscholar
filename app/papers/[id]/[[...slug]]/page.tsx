import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageWrapper } from "@/components/PageWrapper";
import { PaperPage } from "@/components/papers/paper-page";
import { indexedPage, isLiveSite, SITE_URL } from "@/lib/seo/page-metadata";
import { paperPageId, paperPath, paperSlug } from "@/lib/papers/page-address";
import { openalexIdOf, readCommunityCopies, readOpenAlexForPage, readPaperForPage, readReferencesForPage, readSimilarForPage } from "@/lib/papers/paper-page-data";
import { paperDetail } from "@/lib/papers/paper-detail";
import { topicHref } from "@/lib/topics/links";
import type { PaperResult } from "@/lib/types/search.types";

type Params = { params: Promise<{ id: string; slug?: string[] }> };

/** The paper the address names, or the page's 404. */
async function paperOf(params: Params["params"]) {
  const { id: raw } = await params;
  const id = paperPageId(raw);
  const paper = id ? await readPaperForPage(id) : null;
  if (!paper) notFound();
  // Saved papers keep the OpenAlex ID our index pairs a record with; the page is named by our own.
  const own = (paper as { openscholar_id?: string }).openscholar_id ?? paper.id;
  return { paper, id: own.split("/").at(-1)! };
}

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

const dateOf = (paper: PaperResult) => paper.publication_date ?? (paper.publication_year ? String(paper.publication_year) : undefined);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { paper, id } = await paperOf(params);
  const t = await getTranslations("metadata");
  const title = paper.title ?? paper.display_name ?? "";
  const journal = paper.primary_location?.source?.display_name;
  const description = paper.abstract ? snippet(paper.abstract) : [title, journal, paper.publication_year].filter(Boolean).join(", ");
  const page = await indexedPage({ path: paperPath(id, title), title: `${title || id} | ${t("siteName")}`, description });
  const live = await isLiveSite();
  const pdf = paper.best_oa_location?.pdf_url ?? paper.primary_location?.pdf_url;
  return {
    ...page,
    // Only a page with its abstract is worth a search result; the rest stay out, as OpenAlex keeps them out of its sitemaps.
    robots: { index: live && !!paper.abstract, follow: live },
    // What Google Scholar reads (its inclusion guidelines name these tags).
    other: Object.fromEntries(Object.entries({
      citation_title: title,
      citation_author: paper.authorships?.map((authorship) => authorship.author.display_name).filter(Boolean),
      citation_publication_date: dateOf(paper)?.replaceAll("-", "/"),
      citation_journal_title: journal,
      citation_volume: paper.biblio?.volume,
      citation_issue: paper.biblio?.issue,
      citation_firstpage: paper.biblio?.first_page,
      citation_lastpage: paper.biblio?.last_page,
      citation_doi: paper.doi?.replace(/^https?:\/\/doi\.org\//i, ""),
      citation_pdf_url: pdf,
      citation_abstract_html_url: `${SITE_URL}${paperPath(id, title)}`,
    }).filter(([, value]) => value != null && value !== "" && !(Array.isArray(value) && !value.length))) as Record<string, string | string[]>,
  };
}

export default async function Page({ params }: Params) {
  const { paper, id } = await paperOf(params);
  const { id: asked, slug } = await params;
  const title = paper.title ?? paper.display_name ?? "";
  // One address per paper: an OpenAlex ID, our bare ID or an old title all lead to it.
  if (asked !== id || slugOf(slug?.[0]) !== paperSlug(title) || (slug?.length ?? 0) > 1) permanentRedirect(paperPath(id, title));
  const references = ((paper as { referenced_works?: string[] }).referenced_works ?? []).map((work) => work.split("/").at(-1)!).slice(0, 100);
  const work = openalexIdOf(paper);
  const quietly = <T,>(what: string, fallback: T) => (error: unknown) => (console.error(`[paper page] ${what} unavailable`, { id, error }), fallback);
  const [similar, referenceRows, communities, openalex] = await Promise.all([
    readSimilarForPage(id).catch(quietly("similar papers", [])),
    readReferencesForPage(references).catch(quietly("references", [])),
    readCommunityCopies(paper.doi ?? null, work).catch(quietly("community copies", [])),
    work ? readOpenAlexForPage(work).catch(quietly("OpenAlex record", null)) : null,
  ]);
  const detail = paperDetail(paper, openalex, id, new Date().getUTCFullYear());
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
        isPartOf: paper.primary_location?.source?.display_name ? { "@type": "Periodical", name: paper.primary_location.source.display_name, issn: detail.ids.issn ?? undefined, publisher: detail.publisher ?? undefined } : undefined,
        abstract: paper.abstract ?? undefined,
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }} />
      <PaperPage paper={paper} id={id} detail={detail} similar={similar} references={referenceRows} communities={communities} />
    </PageWrapper>
  );
}
