import type { Doc } from "@/convex/_generated/dataModel";
import type { PaperResult } from "@/lib/types";

/**
 * An extraction's paper as focus mode reads one: what the job stored when it took the paper
 * on, so a paper from Zotero or an upload, with no OpenAlex record, opens the same way.
 */
export function extractionPaperToPaperResult(paper: Doc<"extractionPapers">): PaperResult {
  const access = {
    ...(paper.isOpenAccess !== undefined ? { is_oa: paper.isOpenAccess } : {}),
    ...(paper.oaStatus ? { oa_status: paper.oaStatus as NonNullable<PaperResult["open_access"]>["oa_status"] } : {}),
    ...(paper.oaUrl ? { oa_url: paper.oaUrl } : {}),
  };
  return {
    id: paper.openalexId,
    title: paper.title,
    abstract: paper.abstract,
    doi: paper.doi,
    publication_year: paper.publicationYear,
    cited_by_count: paper.citedByCount,
    type: paper.workType as PaperResult["type"],
    authorships: paper.authors?.map((name) => ({ author: { id: "", display_name: name } })),
    authors_unparsed: paper.authorsUnparsed,
    primary_location:
      paper.venueName || paper.pdfUrl
        ? { ...(paper.venueName ? { source: { id: "", display_name: paper.venueName } } : {}), ...(paper.pdfUrl ? { pdf_url: paper.pdfUrl } : {}) }
        : undefined,
    open_access: Object.keys(access).length ? access : undefined,
  };
}
