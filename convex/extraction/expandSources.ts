import type { BucketItemInput, JobSourceSearchFilters } from "./jobSources";
import type { PaperData } from "./types";
import { buildDedupeKey } from "./dedupe";
import { authorMetadata, sourceMetadata, type PaperSourceMetadata } from "../../lib/library/paper-metadata";

type SourceType = "history" | "zotero" | "manual";

export type ExpandedSourcePaper = {
  bucketItem: BucketItemInput;
  paper: PaperData;
  sourceType: SourceType;
  sourceId: string;
};

/** A paper in the person's library, as `ownedLibraryItems` reads it. */
export type LibraryPaper = PaperSourceMetadata & {
  _id: string;
  title: string;
  authors?: string[];
  doi?: string;
  openalexId: string;
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
    openalexId: row.openalexId || undefined,
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

function toHistoryBucketItem(
  item: BucketItemInput,
  paper: PaperData,
): BucketItemInput {
  return {
    ...sourceMetadata(paper),
    bucketKey: buildDedupeKey({
      openalexId: paper.openalexId,
      doi: paper.doi,
      title: paper.title,
      year: paper.publicationYear,
    }),
    source: "history",
    sourceRefId: item.sourceRefId,
    title: paper.title,
    authors: paper.authors ?? [],
    year: paper.publicationYear,
    doi: paper.doi,
    openalexId: paper.openalexId,
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
          openalexId: item.openalexId ?? `${item.source}:${item.sourceRefId}`,
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

  const openalexId = item.openalexId ?? `zotero:${libraryType}:${item.sourceRefId}`;
  const bucketItem: BucketItemInput = {
    ...item,
    libraryType,
    zoteroUserId,
    openalexId,
    pdfUrl,
  };

  return [
    {
      bucketItem,
      paper: {
        ...sourceMetadata(item),
        openalexId,
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

function expandDirectSource(item: BucketItemInput): ExpandedSourcePaper {
  return {
    bucketItem: item,
    paper: {
      openalexId: item.openalexId ?? `${item.source}:${item.sourceRefId}`,
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
    if (item.source === "library" || item.source === "collection") {
      const row = library.get(item.sourceRefId);
      if (row) expanded.push(expandDirectSource(fromLibrary(item, row)));
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
    const key = buildDedupeKey({
      openalexId: item.paper.openalexId,
      doi: item.paper.doi,
      title: item.paper.title,
      year: item.paper.publicationYear,
    });
    if (!deduped.has(key)) {
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
