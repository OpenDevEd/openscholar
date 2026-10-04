import type { Doc } from "@/convex/_generated/dataModel";
import type { PaperResult } from "@/lib/types/search.types";
import { authorMetadata, paperRecord } from "./paper-metadata";

/** Saved fields fill the card's retained OpenAlex record without inventing source facts. */
export function libraryItemToPaperResult(item: Doc<"libraryItems">): PaperResult {
  const raw = paperRecord(item.paperData);
  const stored = raw && typeof raw.id === "string" ? raw as PaperResult : undefined;
  const names = authorMetadata(item);
  const authorships = names.authors
    ? names.authors.map((name, index) => stored?.authorships?.[index]?.author.display_name === name
      ? stored.authorships[index]
      : { author: { id: "", display_name: name } })
    : undefined;
  const access = {
    ...stored?.open_access,
    ...(item.isOpenAccess !== undefined ? { is_oa: item.isOpenAccess } : {}),
    ...(item.oaStatus ? { oa_status: item.oaStatus as NonNullable<PaperResult["open_access"]>["oa_status"] } : {}),
    ...(item.oaUrl ? { oa_url: item.oaUrl } : {}),
  };
  return {
    ...stored,
    id: item.openalexId,
    title: item.title,
    abstract: item.abstract ?? stored?.abstract,
    doi: item.doi ?? stored?.doi,
    publication_year: item.publicationYear ?? stored?.publication_year,
    cited_by_count: item.citedByCount ?? stored?.cited_by_count,
    type: (item.workType as PaperResult["type"]) ?? stored?.type,
    authorships,
    authors_unparsed: names.authorsUnparsed,
    primary_location: item.journal || item.pdfUrl || stored?.primary_location ? {
      ...stored?.primary_location,
      ...(item.journal ? { source: { ...stored?.primary_location?.source, id: stored?.primary_location?.source?.id ?? "", display_name: item.journal } } : {}),
      ...(item.pdfUrl ? { pdf_url: item.pdfUrl } : {}),
    } : undefined,
    open_access: Object.keys(access).length ? access : undefined,
  };
}
