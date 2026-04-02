import type { Doc } from "@/convex/_generated/dataModel";
import type { PaperResult } from "@/lib/types/search.types";

/**
 * Converts a Convex libraryItems document to a PaperResult for use with
 * PaperCard and FocusMode components.
 *
 * Rich path: if `paperData` is present, parse the stored full PaperResult JSON.
 * Minimal path: construct a partial PaperResult from the 10 indexed fields
 * (legacy items saved before paperData was introduced).
 */
export function libraryItemToPaperResult(
  item: Doc<"libraryItems">,
): PaperResult {
  if (item.paperData) {
    try {
      return JSON.parse(item.paperData) as PaperResult;
    } catch {
      // Corrupted JSON — fall through to minimal path
    }
  }

  // Minimal path: reconstruct from indexed fields
  return {
    id: item.openalexId,
    title: item.title,
    abstract: item.abstract,
    doi: item.doi,
    publication_year: item.publicationYear,
    cited_by_count: item.citedByCount,
    authorships: item.authors
      ? item.authors.split(", ").map((name) => ({
          author: { id: "", display_name: name },
        }))
      : undefined,
    primary_location: item.journal
      ? { source: { id: "", display_name: item.journal } }
      : undefined,
    open_access:
      item.isOpenAccess !== undefined
        ? {
            is_oa: item.isOpenAccess,
            oa_status:
              (item.oaStatus as
                | "gold"
                | "green"
                | "bronze"
                | "hybrid"
                | "closed") ?? "closed",
            oa_url: "",
            any_repository_has_fulltext: false,
          }
        : undefined,
  };
}
