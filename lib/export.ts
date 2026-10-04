import type { Doc } from "@/convex/_generated/dataModel";
import type { ExportFormat, ExportSource } from "@/convex/exportValidators";
import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import { digestOpaqueToken } from "@/convex/lib/opaqueTokenDigest";
import { searchFields, type SavedSearch } from "./research/records";
import { authorMetadata } from "./library/paper-metadata";

type Cell = string | number | boolean | string[];
type Row = Record<string, Cell>;

function csvValue(value: Cell) {
  const text = Array.isArray(value) ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) || text === "" ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV as it streams: its columns, then a line for each item. */
function csvFile<Item>(columns: string[], row: (item: Item) => Row) {
  return {
    contentType: "text/csv; charset=utf-8",
    // A byte order mark first, so Excel reads the file as UTF-8.
    start: () => `﻿${columns.join(",")}`,
    item: (item: Item) => {
      const values = row(item);
      return `\n${columns.map((column) => csvValue(values[column])).join(",")}`;
    },
    end: () => "\n",
  };
}

/** One exported paper. */
function libraryRow(item: Doc<"libraryItems">) {
  const names = authorMetadata(item);
  return {
    abstract: item.abstract ?? "",
    authors: names.authors ?? [],
    authorsUnparsed: names.authorsUnparsed ?? "",
    citedByCount: item.citedByCount ?? "",
    doi: item.doi ?? "",
    isOpenAccess: item.isOpenAccess ?? "",
    journal: item.journal ?? "",
    oaStatus: item.oaStatus ?? "",
    oaUrl: item.oaUrl ?? "",
    pdfUrl: item.pdfUrl ?? "",
    workType: item.workType ?? "",
    metadataRecoveredAt: item.metadataRecoveredAt === undefined ? "" : new Date(item.metadataRecoveredAt).toISOString(),
    openalexId: item.openalexId,
    publicationYear: item.publicationYear ?? "",
    rating: item.rating ?? "",
    savedAt: new Date(item.savedAt).toISOString(),
    title: item.title,
    updatedAt: new Date(item.updatedAt).toISOString(),
  };
}

/** The current search specification, with shortcut expansion recorded at export time. */
export type ExportedSearch = Pick<SavedSearch, "query" | "count" | "field"> & Partial<SavedSearch> & { resolvedQuery?: string };

/** One exported search, under the names the history page's upload reads back. */
export function historyRow(search: ExportedSearch) {
  const omitted = new Set(['chatJobIdsByAccountId', 'screeningResponses', 'queryHistoryCount', 'questionCount', 'questionText', 'latestQuestion', 'importSource']);
  const spec = Object.fromEntries(Object.entries(search).filter(([key]) => key in searchFields && !omitted.has(key)));
  const id = search.id ?? '';
  const resolvedQuery = search.resolvedQuery ?? search.query;
  return {
    format_version: 1, export_id: id, count: search.count, field: search.field, search_query: resolvedQuery,
    spec,
  };
}

/** A query shortcut as its export reads it. */
export type ExportedShortcut = { shorthand: string; expansion: string; createdAt: number };

/** A list of plain rows as JSON, which the pages' uploads take back. */
function jsonList<Item>(row: (item: Item) => Row) {
  return {
    contentType: "application/json; charset=utf-8",
    start: () => "[",
    item: (item: Item, index: number) => `${index === 0 ? "" : ","}\n  ${JSON.stringify(row(item))}`,
    end: () => "\n]\n",
  };
}

/**
 * Each export as the server writes it (convex/exports.ts): a start, each item, and an end
 * that can say how many there were. The browser only downloads. Columns run in the order the
 * rows above list their fields (alphabetical, as before). A screening job's files depend on
 * its questions, so they're made per job (lib/screening/export.ts).
 */
export const exportFiles = {
  library: {
    name: (at: Date) => `library-export-${at.toISOString().slice(0, 10)}`,
    csv: csvFile(Object.keys(libraryRow({ savedAt: 0, updatedAt: 0 } as Doc<"libraryItems">)), libraryRow),
    json: {
      contentType: "application/json; charset=utf-8",
      start: (exportedAt: Date) => `{\n  "exportedAt": ${JSON.stringify(exportedAt.toISOString())},\n  "items": [`,
      item: (item: Doc<"libraryItems">, index: number) => `${index === 0 ? "" : ","}\n    ${JSON.stringify(libraryRow(item))}`,
      end: (count: number) => `\n  ],\n  "totalItems": ${count}\n}\n`,
    },
  },
  history: {
    name: () => "search_history",
    csv: csvFile(['format_version', 'export_id', 'count', 'field', 'search_query', 'spec'], (search: ExportedSearch) => { const row = historyRow(search); return { ...row, spec: JSON.stringify(row.spec) }; }),
    json: {
      contentType: "application/json; charset=utf-8",
      start: (at: Date) => JSON.stringify({ format: 'openscholar.searches', version: 1, exportedAt: at.toISOString(), scope: 'current search specifications', searches: [] }).replace(/\[\]\}$/, '['),
      item: (search: ExportedSearch, index: number) => `${index ? ',' : ''}\n${JSON.stringify(historyRow(search))}`,
      end: () => '\n]}\n',
    },
  },
  // Under the names the Bookmarks page's upload reads back; the CSV says when in words.
  shortcuts: {
    name: () => "bookmarks",
    csv: csvFile(["createdAt", "expansion", "name"], (shortcut: ExportedShortcut) => ({ createdAt: new Date(shortcut.createdAt).toISOString(), expansion: shortcut.expansion, name: shortcut.shorthand })),
    json: jsonList((shortcut: ExportedShortcut) => ({ name: shortcut.shorthand, expansion: shortcut.expansion, createdAt: shortcut.createdAt })),
  },
};

/** The first part keeps the plain name; a later one says which part it is. */
export function exportFilename(name: string, format: ExportFormat, part = 1) {
  return `${name}${part > 1 ? `-part-${part}` : ""}.${format}`;
}

/** How long an export's link waits for its next part to be fetched; the browser fetches it at once. */
export const EXPORT_LINK_MS = 2 * 60_000;
/** How long the page waits for a part it opened to start before it calls the export failed. */
const PART_START_MS = 30_000;

/**
 * Downloads a library view, the search history, the query shortcuts or a screening job's results as files the server writes a page at a
 * time, so no export is held whole in memory, here or there. A file stops short of Convex's
 * 20 MiB response limit, and the next part follows once it's done. The browser makes a
 * one-time token and registers only its digest; each part's link carries the token. Settles
 * once the last part is done, and fails when a part fails or doesn't start, which the hidden
 * frame can't show.
 */
export async function downloadExport(convex: ConvexReactClient, source: ExportSource, format: ExportFormat) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const digest = await digestOpaqueToken(token);
  await convex.mutation(api.exports.start, { digest, format, source });
  // A hidden frame takes each download, so the page doesn't navigate or ask to leave.
  const open = (part: number) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/export?token=${token}&part=${part}`;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), EXPORT_LINK_MS);
  };
  await new Promise<void>((resolve, reject) => {
    let opened = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = convex.watchQuery(api.exports.progress, { digest });
    const settle = (error?: Error) => {
      clearTimeout(timer);
      stop();
      if (error) reject(error);
      else resolve();
    };
    const update = () => {
      const progress = watch.localQueryResult();
      if (progress === undefined) return;
      if (progress === null) return settle();
      if (progress.failed) return settle(new Error(progress.failureReason === "changed" ? "Screening changed during export. Download it again to get one consistent version." : `Part ${progress.part} of the export failed`));
      if (progress.serving) return clearTimeout(timer);
      if (progress.part > opened) {
        open((opened = progress.part));
        clearTimeout(timer);
        timer = setTimeout(() => settle(new Error(`Part ${opened} of the export didn't start`)), PART_START_MS);
      }
    };
    const stop = watch.onUpdate(update);
    update();
  });
}
