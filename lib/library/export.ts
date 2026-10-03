import type { Doc } from "@/convex/_generated/dataModel";
import type { LibraryView } from "@/convex/library/validators";
import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import { digestOpaqueToken } from "@/convex/lib/opaqueTokenDigest";

export type LibraryExportFormat = "csv" | "json";

/** One exported paper. The server writes these (convex/library/exports.ts); the browser only downloads. */
function formatForExport(item: Doc<"libraryItems">) {
  return {
    abstract: item.abstract ?? "",
    authors: item.authors ?? "",
    citedByCount: item.citedByCount ?? "",
    doi: item.doi ?? "",
    isOpenAccess: item.isOpenAccess ?? "",
    journal: item.journal ?? "",
    oaStatus: item.oaStatus ?? "",
    openalexId: item.openalexId,
    publicationYear: item.publicationYear ?? "",
    rating: item.rating ?? "",
    savedAt: new Date(item.savedAt).toISOString(),
    title: item.title,
    updatedAt: new Date(item.updatedAt).toISOString(),
  };
}

/** The CSV's columns, in the order the fields above are listed (alphabetical, as before). */
const CSV_COLUMNS = Object.keys(formatForExport({ savedAt: 0, updatedAt: 0 } as Doc<"libraryItems">)) as Array<keyof ReturnType<typeof formatForExport>>;

function csvValue(value: string | number | boolean) {
  const text = String(value);
  return /[",\n\r]/.test(text) || text === "" ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The export as it streams: a start, each paper, and an end that can say how many there were. */
export const libraryExportFile = {
  csv: {
    contentType: "text/csv; charset=utf-8",
    start: () => CSV_COLUMNS.join(","),
    item: (item: Doc<"libraryItems">) => {
      const row = formatForExport(item);
      return `\n${CSV_COLUMNS.map((column) => csvValue(row[column])).join(",")}`;
    },
    end: () => "\n",
  },
  json: {
    contentType: "application/json; charset=utf-8",
    start: (exportedAt: Date) => `{\n  "exportedAt": ${JSON.stringify(exportedAt.toISOString())},\n  "items": [`,
    item: (item: Doc<"libraryItems">, index: number) => `${index === 0 ? "" : ","}\n    ${JSON.stringify(formatForExport(item))}`,
    end: (count: number) => `\n  ],\n  "totalItems": ${count}\n}\n`,
  },
};

/** The first part keeps the plain name; a later one says which part it is. */
export function libraryExportFilename(format: LibraryExportFormat, at: Date, part = 1) {
  return `library-export-${at.toISOString().slice(0, 10)}${part > 1 ? `-part-${part}` : ""}.${format}`;
}

/** How long an export's link waits for its next part to be fetched; the browser fetches it at once. */
export const LIBRARY_EXPORT_LINK_MS = 2 * 60_000;

/**
 * Downloads a library view as files the server writes a page at a time, so no export is
 * held whole in memory, here or there. A file stops short of Convex's 20 MiB response
 * limit, and the next part follows once it's done. The browser makes a one-time token and
 * registers only its digest; each part's link carries the token.
 */
export async function downloadLibraryExport(convex: ConvexReactClient, view: LibraryView, format: LibraryExportFormat) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const digest = await digestOpaqueToken(token);
  await convex.mutation(api.library.exports.start, { digest, format, view });
  // A hidden frame takes each download, so the page doesn't navigate or ask to leave.
  const open = (part: number) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/library/export?token=${token}&part=${part}`;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), LIBRARY_EXPORT_LINK_MS);
  };
  open(1);
  let opened = 1;
  const watch = convex.watchQuery(api.library.exports.progress, { digest });
  const stop = watch.onUpdate(() => {
    const part = watch.localQueryResult();
    if (part === null) stop();
    else if (part !== undefined && part > opened) open((opened = part));
  });
}
