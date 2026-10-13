import type { BucketItemInput, JobSourceSearchFilters } from "./jobSources";
import type { PaperData } from "./types";
import { buildDedupeKey } from "./dedupe";
import { authorMetadata, sourceMetadata, type PaperSourceMetadata } from "../../lib/library/paper-metadata";
import { createError } from "../lib/errors";
import { openalexWorkOf, paperKey, toPaperKey, type CrossRefs } from "../../lib/papers/paper-ref";

type SourceType = "history" | "zotero" | "manual" | "screening";

export type ExpandedSourcePaper = {
  bucketItem: BucketItemInput;
  paper: PaperData;
  sourceType: SourceType;
  sourceId: string;
  screeningRevision?: string;
};

/** A paper in the person's library, as `ownedLibraryItems` reads it. */
export type LibraryPaper = PaperSourceMetadata & {
  _id: string;
  paper: string;
  crossRefs?: CrossRefs;
  title: string;
  authors?: string[];
  doi?: string;
  abstract?: string;
  publicationYear?: number;
  journal?: string;
  citedByCount?: number;
  workType?: string;
};

type ExpandSourceDeps = {
  fetchPapersFromHistory: (
    searchFilters: JobSourceSearchFilters,
  ) => Promise<PaperData[]>;
  resolveZoteroUserId: () => Promise<string | undefined>;
  /** The person's own library papers among these ids; others' and deleted ones are left out. */
  readLibraryItems: (ids: string[]) => Promise<LibraryPaper[]>;
  readScreening?: (selection: NonNullable<BucketItemInput["screeningSelection"]>) => Promise<PaperData[]>;
};

/**
 * A library or collection source with the paper as the person's library holds it, not the
 * browser's copy. Uploaded-file references are dropped; source URLs come from the owned row.
 */
function fromLibrary(item: BucketItemInput, row: LibraryPaper): BucketItemInput {
  return {
    ...item,
    ...sourceMetadata(row),
    storageId: undefined,
    title: row.title,
    ...authorMetadata(row),
    authors: authorMetadata(row).authors ?? [],
    year: row.publicationYear,
    doi: row.doi,
    openalexId: openalexWorkOf(row.paper, row.crossRefs) ?? undefined,
    abstract: row.abstract,
    citedByCount: row.citedByCount,
    venueName: row.journal,
    workType: row.workType,
  };
}

function paperSourceFromBucket(source: BucketItemInput["source"]): SourceType {
  if (source === "history") return "history";
  if (source === "zotero") return "zotero";
  return "manual";
}

/** What finds a paper's duplicates: its OpenAlex work where it has one, its DOI, or its title and year. */
export const dedupeKeyOf = (paper: Pick<PaperData, "paper" | "crossRefs" | "doi" | "title" | "publicationYear">) =>
  buildDedupeKey({ openalexId: openalexWorkOf(paper.paper, paper.crossRefs) ?? undefined, doi: paper.doi ?? paper.crossRefs?.doi, title: paper.title, year: paper.publicationYear });

/** A picked paper's key: by its OpenAlex ID where it has one, and an upload by its file. */
function pickedKey(item: BucketItemInput): string {
  const key = item.openalexId ? toPaperKey(item.openalexId) : item.source === "upload" ? paperKey({ source: "upload", file: item.storageId ?? item.sourceRefId }) : null;
  if (!key) throw createError("VALIDATION_ERROR", `"${item.title}" names no paper: pick it again.`);
  return key;
}

function toHistoryBucketItem(
  item: BucketItemInput,
  paper: PaperData,
): BucketItemInput {
  return {
    ...sourceMetadata(paper),
    bucketKey: dedupeKeyOf(paper),
    source: "history",
    sourceRefId: item.sourceRefId,
    title: paper.title,
    authors: paper.authors ?? [],
    year: paper.publicationYear,
    doi: paper.doi,
    openalexId: openalexWorkOf(paper.paper, paper.crossRefs) ?? undefined,
    abstract: paper.abstract,
    pdfUrl: paper.pdfUrl,
    citedByCount: paper.citedByCount,
    venueName: paper.venueName,
    workType: paper.workType,
  };
}

async function expandHistorySource(
  item: BucketItemInput,
  deps: ExpandSourceDeps,
): Promise<ExpandedSourcePaper[]> {
  if (!item.searchFilters) {
    return [
      {
        bucketItem: item,
        paper: {
          paper: pickedKey(item),
          title: item.title,
          doi: item.doi,
          publicationYear: item.year,
          abstract: item.abstract,
          authors: item.authors,
          pdfUrl: item.pdfUrl,
          ...sourceMetadata(item),
          citedByCount: item.citedByCount,
          venueName: item.venueName,
          workType: item.workType,
        },
        sourceType: "history",
        sourceId: item.sourceRefId,
      },
    ];
  }

  const limit = item.searchFilters.limit;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return [];
  }

  const papers = await deps.fetchPapersFromHistory(item.searchFilters);
  return papers.map((paper) => ({
    bucketItem: toHistoryBucketItem(item, paper),
    paper,
    sourceType: "history",
    sourceId: item.sourceRefId,
  }));
}

async function expandZoteroSource(
  item: BucketItemInput,
  deps: ExpandSourceDeps,
): Promise<ExpandedSourcePaper[]> {
  const libraryType = item.libraryType ?? "user";
  let zoteroUserId = item.zoteroUserId;

  if (!zoteroUserId && libraryType === "user") {
    zoteroUserId = await deps.resolveZoteroUserId();
  }

  const pdfUrl =
    libraryType === "group" && item.groupId
      ? `zotero://select/groups/${item.groupId}/items/${item.sourceRefId}`
      : zoteroUserId
        ? `zotero://select/users/${zoteroUserId}/items/${item.sourceRefId}`
        : undefined;

  // A Zotero item is named by its library: its key alone is shared across people's.
  const owner = libraryType === "group" ? item.groupId : zoteroUserId;
  if (!owner) throw createError("ZOTERO_NOT_CONNECTED", "Connect Zotero again to read this item.");
  const bucketItem: BucketItemInput = {
    ...item,
    libraryType,
    zoteroUserId,
    pdfUrl,
  };

  return [
    {
      bucketItem,
      paper: {
        ...sourceMetadata(item),
        paper: paperKey({ source: "zotero", library: libraryType, owner, key: item.sourceRefId }),
        ...(item.openalexId || item.doi ? { crossRefs: { ...(item.openalexId ? { openalexId: item.openalexId } : {}), ...(item.doi ? { doi: item.doi } : {}) } } : {}),
        title: item.title,
        doi: item.doi,
        publicationYear: item.year,
        abstract: item.abstract,
        authors: item.authors,
        pdfUrl,
        citedByCount: item.citedByCount,
        venueName: item.venueName,
        workType: item.workType,
      },
      sourceType: "zotero",
      sourceId: item.sourceRefId,
    },
  ];
}

function expandDirectSource(item: BucketItemInput, paper = pickedKey(item), crossRefs?: CrossRefs): ExpandedSourcePaper {
  return {
    bucketItem: item,
    paper: {
      paper,
      ...(crossRefs ? { crossRefs } : {}),
      title: item.title,
      doi: item.doi,
      publicationYear: item.year,
      abstract: item.abstract,
      authors: item.authors,
      pdfUrl: item.pdfUrl,
      storageId: item.storageId,
      ...sourceMetadata(item),
      citedByCount: item.citedByCount,
      venueName: item.venueName,
      workType: item.workType,
    },
    sourceType: paperSourceFromBucket(item.source),
    sourceId: item.sourceRefId,
  };
}

export async function expandJobSources(
  items: ReadonlyArray<BucketItemInput>,
  deps: ExpandSourceDeps,
): Promise<ExpandedSourcePaper[]> {
  const expanded: ExpandedSourcePaper[] = [];
  const fromLibraryIds = items.filter((item) => item.source === "library" || item.source === "collection").map((item) => item.sourceRefId);
  const library = new Map(
    (fromLibraryIds.length ? await deps.readLibraryItems(fromLibraryIds) : []).map((row) => [row._id, row]),
  );

  for (const item of items) {
    if (item.source === "screening") {
      if (!item.screeningSelection || !deps.readScreening) throw createError("VALIDATION_ERROR", "Screening selection is missing.");
      const papers = await deps.readScreening(item.screeningSelection);
      expanded.push(...papers.map(paper => ({ bucketItem: item, paper, sourceType: "screening" as const, sourceId: item.screeningSelection!.jobId, screeningRevision: item.screeningSelection!.revision })));
      continue;
    }
    if (item.source === "library" || item.source === "collection") {
      const row = library.get(item.sourceRefId);
      if (row) expanded.push(expandDirectSource(fromLibrary(item, row), row.paper, row.crossRefs));
      else console.warn(`[expandJobSources] library paper ${item.sourceRefId} is gone or not the person's; left out`);
      continue;
    }

    if (item.source === "history") {
      expanded.push(...(await expandHistorySource(item, deps)));
      continue;
    }

    if (item.source === "zotero") {
      expanded.push(...(await expandZoteroSource(item, deps)));
      continue;
    }

    expanded.push(expandDirectSource(item));
  }

  return expanded;
}

export function dedupeExpandedSources(
  items: ReadonlyArray<ExpandedSourcePaper>,
): ExpandedSourcePaper[] {
  const deduped = new Map<string, ExpandedSourcePaper>();

  for (const item of items) {
    const key = dedupeKeyOf(item.paper);
    // An Included snapshot keeps the screened metadata and decision provenance.
    const existing = deduped.get(key);
    if (!existing || (item.sourceType === "screening" && existing.sourceType !== "screening")) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
}

/** Reads the person's library papers through `read`, a batch of `batch` ids at a time. */
export async function readLibraryInBatches(ids: string[], batch: number, read: (ids: string[]) => Promise<LibraryPaper[]>) {
  const rows: LibraryPaper[] = [];
  for (let i = 0; i < ids.length; i += batch) rows.push(...(await read(ids.slice(i, i + batch))));
  return rows;
}
