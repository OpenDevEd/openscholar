import type { TrimmedPaperData } from "@/lib/types/library.types";

/**
 * Extracts the 10 required metadata fields from an OpenAlex Work object.
 * Called client-side before sending to the Convex saveToLibrary mutation
 * to avoid sending the full 5-20 KB Work blob over the wire.
 */
export function trimPaperData(work: Record<string, any>): TrimmedPaperData {
  const authors =
    work.authorships
      ?.map((a: any) => a.author?.display_name)
      .filter(Boolean)
      .join(", ") || undefined;

  return {
    openalexId: work.id,
    title: work.title || work.display_name || "",
    authors,
    doi: work.doi || undefined,
    abstract: work.abstract || undefined,
    publicationYear: work.publication_year || undefined,
    journal: work.primary_location?.source?.display_name || undefined,
    citedByCount: work.cited_by_count ?? undefined,
    isOpenAccess: work.open_access?.is_oa ?? undefined,
    oaStatus: work.open_access?.oa_status || undefined,
  };
}
