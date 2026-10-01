import { downloadAsFile, jsonToCSV } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Every item of a paged library view, one page per query, so an export of any size fits
 * (#352). Pages continue from index cursors, so a removed paper shifts nothing, and a
 * paper whose sort value changes mid-export is kept once.
 *
 * ponytail: a paper whose sort value moves it into pages already read is missed; a
 * snapshot export would need the view frozen while it's read.
 */
export async function readEveryLibraryPage<Item extends { _id: string }>(
  readPage: (cursor: string | null) => Promise<{ page: Item[]; isDone: boolean; continueCursor: string }>,
): Promise<Item[]> {
  const items = new Map<string, Item>();
  for (let cursor: string | null = null; ;) {
    const result = await readPage(cursor);
    for (const item of result.page) if (!items.has(item._id)) items.set(item._id, item);
    if (result.isDone) return [...items.values()];
    cursor = result.continueCursor;
  }
}

interface LibraryExportItem {
  [key: string]: string | number | boolean;
  title: string;
  authors: string;
  doi: string;
  publicationYear: number | string;
  journal: string;
  rating: number | "";
  citedByCount: number | string;
  isOpenAccess: boolean | string;
  oaStatus: string;
  openalexId: string;
  savedAt: string;
  updatedAt: string;
  abstract: string;
}

function formatForExport(item: Doc<"libraryItems">): LibraryExportItem {
  return {
    title: item.title,
    authors: item.authors ?? "",
    doi: item.doi ?? "",
    publicationYear: item.publicationYear ?? "",
    journal: item.journal ?? "",
    rating: item.rating ?? "",
    citedByCount: item.citedByCount ?? "",
    isOpenAccess: item.isOpenAccess ?? "",
    oaStatus: item.oaStatus ?? "",
    openalexId: item.openalexId,
    savedAt: new Date(item.savedAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
    abstract: item.abstract ?? "",
  };
}

export function exportLibraryAsCSV(items: Doc<"libraryItems">[]) {
  const rows = items.map(formatForExport);
  const csv = jsonToCSV(rows);
  const filename = `library-export-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadAsFile(csv, filename, "csv");
}

export function exportLibraryAsJSON(items: Doc<"libraryItems">[]) {
  const data = {
    exportedAt: new Date().toISOString(),
    totalItems: items.length,
    items: items.map(formatForExport),
  };
  const filename = `library-export-${new Date().toISOString().slice(0, 10)}.json`;
  downloadAsFile(JSON.stringify(data, null, 2), filename, "json");
}
