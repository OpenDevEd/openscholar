import { downloadAsFile, jsonToCSV } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";

interface LibraryExportItem {
  [key: string]: string | number | boolean;
  title: string;
  authors: string;
  doi: string;
  publicationYear: number | string;
  journal: string;
  rating: number;
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
    rating: item.rating,
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
