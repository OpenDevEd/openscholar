import type { BucketItemInput, JobSourceSearchFilters } from "./jobSources";
import type { PaperData } from "./types";
import { buildDedupeKey } from "./dedupe";

type SourceType = "history" | "zotero" | "manual";

export type ExpandedSourcePaper = {
  bucketItem: BucketItemInput;
  paper: PaperData;
  sourceType: SourceType;
  sourceId: string;
};

type ExpandSourceDeps = {
  fetchPapersFromHistory: (
    searchFilters: JobSourceSearchFilters,
  ) => Promise<PaperData[]>;
  resolveZoteroUserId: () => Promise<string | undefined>;
};

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
          isOpenAccess: false,
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
        openalexId,
        title: item.title,
        doi: item.doi,
        publicationYear: item.year,
        abstract: item.abstract,
        authors: item.authors,
        pdfUrl,
        isOpenAccess: false,
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
      isOpenAccess: false,
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

  for (const item of items) {
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
