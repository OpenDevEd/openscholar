/**
 * Extraction Actions — fetch papers from OpenAlex.
 *
 * No `"use node"` directive: this action uses only global `fetch` +
 * `URLSearchParams` (available in the default Convex runtime) and pure
 * helpers lifted to `lib/openalex/`.
 */

import { internalAction, type ActionCtx } from "../_generated/server";
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { setupPlaceValidator } from "./validators";
import {
  mapOpenAlexWorkToPaperData,
  type OpenAlexWork,
  type PaperDataOut,
} from "../../lib/openalex/work-mapper";
import { PAGE_SIZE, readSearchRun } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { expandJobSources, readLibraryInBatches } from "./expandSources";
import { paperCountForItem } from "../../lib/bucket/effective-paper-count";
import { LIBRARY_READ_BATCH } from "./queries/internal";
import { OLD_SEARCH_MESSAGE, type BucketItemInput } from "./jobSources";
import { heldPapers } from "../paperSets/held";
import { keepLibraryKeys, resolveLibraryKeys } from "../evidenceLibraries/sources";
import type { SearchPaper } from "../paperSets/search";
import { createError } from "../lib/errors";
import {
  EXTRACTION_PAPER_CONCURRENCY,
  EXTRACTION_QUESTION_CONCURRENCY,
} from "../../lib/extraction/limits";
import { OPENALEX_WORK_SELECT_FIELDS } from "../../lib/openalex/search-params";
import {
  classifyUnknownError,
  type ClassifiedError,
} from "@/lib/errors/taxonomy";
import { ZOTERO_PAGE } from "../zotero/libraryValidators";
import { MAX_AUTHORS } from "../lib/listCaps";


type SetupRuntime = {
  pdfEnabled: boolean;
  paperConcurrency: number;
  questionConcurrency: number;
};

type ActiveSetupControl = {
  job: Doc<"extractionJobs">;
  pdfEnabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function toStringNumberArrayRecord(
  value: unknown,
): Record<string, number[]> | undefined {
  if (!isRecord(value)) return undefined;
  const entries: Array<[string, number[]]> = [];
  for (const [key, entryValue] of Object.entries(value)) {
    if (
      Array.isArray(entryValue) &&
      entryValue.every((position): position is number => typeof position === "number")
    ) {
      entries.push([key, entryValue]);
    }
  }
  return Object.fromEntries(entries);
}

function toOpenAlexWork(value: unknown): OpenAlexWork {
  if (!isRecord(value)) return {};

  const openAccess = isRecord(value.open_access)
    ? {
        oa_url: optionalString(value.open_access, "oa_url"),
        is_oa: optionalBoolean(value.open_access, "is_oa"),
        oa_status: optionalString(value.open_access, "oa_status"),
      }
    : undefined;

  const primaryLocation = isRecord(value.primary_location)
    ? {
        pdf_url: optionalString(value.primary_location, "pdf_url"),
        source: isRecord(value.primary_location.source)
          ? {
              display_name: optionalString(
                value.primary_location.source,
                "display_name",
              ),
            }
          : undefined,
      }
    : undefined;

  const authorships = Array.isArray(value.authorships)
    ? value.authorships
        .filter(isRecord)
        .map((authorship) => ({
          author: isRecord(authorship.author)
            ? {
                display_name: optionalString(authorship.author, "display_name"),
              }
            : undefined,
        }))
    : undefined;

  return {
    id: optionalString(value, "id"),
    display_name: optionalString(value, "display_name"),
    doi: optionalString(value, "doi"),
    publication_year: optionalNumber(value, "publication_year"),
    abstract_inverted_index: toStringNumberArrayRecord(
      value.abstract_inverted_index,
    ),
    authorships,
    open_access: openAccess,
    cited_by_count: optionalNumber(value, "cited_by_count"),
    primary_location: primaryLocation,
    best_oa_location: isRecord(value.best_oa_location) ? { pdf_url: optionalString(value.best_oa_location, "pdf_url") } : undefined,
    type: optionalString(value, "type"),
  };
}

function toStructuredJobError(error: ClassifiedError) {
  return {
    code: error.code,
    message: error.message,
    ...(error.context !== undefined ? { context: error.context } : {}),
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    ...(error.providerName !== undefined
      ? { providerName: error.providerName }
      : {}),
    at: Date.now(),
  };
}

function canContinueSetup(
  job: Doc<"extractionJobs"> | null,
  expectedEpoch: number,
): job is Doc<"extractionJobs"> {
  if (!job) return false;
  if ((job.runEpoch ?? 0) !== expectedEpoch) return false;
  return (
    job.status !== "cancelled" &&
    job.status !== "failed" &&
    job.status !== "completed" &&
    job.status !== "paused" &&
    job.status !== "creditsExhausted"
  );
}

async function loadActiveSetupControl(
  ctx: ActionCtx,
  {
    jobId,
    expectedEpoch,
  }: { jobId: Id<"extractionJobs">; expectedEpoch: number },
): Promise<ActiveSetupControl | null> {
  const { job, pdfEnabled } = await ctx.runQuery(
    internal.extraction.queries.internal.getJobAndFlagsInternal,
    { jobId },
  );
  if (!canContinueSetup(job, expectedEpoch)) return null;
  return { job, pdfEnabled };
}

function setupRuntime(pdfEnabled: boolean): SetupRuntime {
  return {
    pdfEnabled,
    paperConcurrency: EXTRACTION_PAPER_CONCURRENCY,
    questionConcurrency: EXTRACTION_QUESTION_CONCURRENCY,
  };
}

/** Papers one setup step reads of a set or the bucket's own papers, and saves in one transaction. */
const SETUP_STEP = 100;
/** A search's step is one of OpenAlex's pages: a step of part of one would ask for the page again. */
const SEARCH_STEP = PAGE_SIZE;
/** How long one setup action reads before it hands on to the next: well inside an action's ten minutes. */
const SETUP_ACTION_MS = 4 * 60_000;

type SetupPlace = Infer<typeof setupPlaceValidator>;
type StepSource = { position: number; item: BucketItemInput };
type SetupPaper = PaperDataOut & { storageId?: Id<"_storage">; sourceType: "history" | "zotero" | "manual" | "screening" | "evidenceLibrary"; sourceId: string; screeningRevision?: string };

/** A search or a screening reads its papers a page at a time; every other source is one paper. */
const pagedSource = (item: BucketItemInput) => item.source === "screening" || item.librarySet !== undefined || item.zoteroSet !== undefined || item.evidenceLibrarySet !== undefined || (item.source === "history" && item.searchFilters !== undefined);

/**
 * The next step of a job's papers from `place`, and where its setup goes on after it; null
 * once every source is read. A search reads on from its place in OpenAlex and a screening
 * from its place in its included papers, so neither is ever held whole; the bucket's own
 * papers are read up to the next of those.
 */
/** Who a job reads its papers as: its person, in its workspace (or theirs, for a job its backfill hasn't reached). */
const jobReader = async (ctx: ActionCtx, job: Doc<"extractionJobs">) => ({ userId: job.createdBy, workspaceId: job.workspaceId });

async function readStep(ctx: ActionCtx, job: Doc<"extractionJobs">, clerkId: string, place: SetupPlace): Promise<{ papers: SetupPaper[]; next: SetupPlace } | null> {
  // Typed here: the generated API's types depend on this module, so inference would loop.
  const sources: StepSource[] = await ctx.runQuery(internal.extraction.queries.internal.jobSourcesFrom, { jobId: job._id, position: place.position, numItems: SETUP_STEP });
  if (!sources.length) return null;
  const [{ position, item }] = sources;
  const onTo = (next: number): SetupPlace => ({ position: next, read: 0, papers: place.papers, processable: place.processable });
  if (item.source === "history" && item.searchFilters) {
    const filters = item.searchFilters;
    if (!("openAlexQuery" in filters)) throw createError("VALIDATION_ERROR", OLD_SEARCH_MESSAGE);
    // As many papers as the bucket counted it for (lib/bucket/effective-paper-count.ts), from the result it starts at.
    const wanted = paperCountForItem(item);
    const start = filters.first ?? 1;
    const first = start + place.read;
    const last = Math.min(start + wanted - 1, first + SEARCH_STEP - 1);
    if (last < first) return { papers: [], next: onTo(position + 1) };
    const run = await readSearchRun<unknown>(filters.openAlexQuery, { first, last, select: OPENALEX_WORK_SELECT_FIELDS.join(","), resume: place.resume, goesOn: true }, spender(ctx, clerkId, filters.openAlexQuery.source));
    const papers = run.works.map((work): SetupPaper => ({ ...mapOpenAlexWorkToPaperData(toOpenAlexWork(work)), sourceType: "history", sourceId: item.sourceRefId }));
    const read = place.read + papers.length;
    return { papers, next: run.ended || !run.resume || read >= wanted ? onTo(position + 1) : { ...place, read, resume: run.resume } };
  }
  if (item.librarySet) {
    const range = item.librarySet;
    const first = range.first + place.read;
    const last = Math.min(range.first + range.count - 1, first + SETUP_STEP - 1);
    if (last < first) return { papers: [], next: onTo(position + 1) };
    const set = range.collectionId ? { kind: "collection" as const, collectionId: range.collectionId } : { kind: "saved" as const };
    const { papers: held, resume } = await heldPapers(ctx, await jobReader(ctx, job), set, { first, last }, place.resume);
    const papers = held.map(({ venue, ...paper }): SetupPaper => ({ ...paper, venueName: venue, sourceType: "manual", sourceId: range.collectionId ?? "library" }));
    const read = place.read + papers.length;
    return { papers, next: resume && read < range.count ? { ...place, read, resume } : onTo(position + 1) };
  }
  if (item.zoteroSet) {
    // A range of the person's own Zotero, one page of Zotero's a step, each item read as a Zotero paper picked on the page is (./expandSources.ts).
    const range = item.zoteroSet;
    const first = range.first + place.read;
    const last = Math.min(range.last, first + ZOTERO_PAGE - 1);
    if (last < first) return { papers: [], next: onTo(position + 1) };
    const read: { papers: Array<{ key: string; title: string; abstract?: string; authors: string[]; year?: number; doi?: string; venue?: string; pdfUrl: string }>; ended: boolean; zoteroUserId: string } = await ctx.runAction(internal.zotero.actions.papersOf, { userId: job.createdBy, ...(item.collectionKey ? { collectionKey: item.collectionKey } : {}), ...(item.groupId ? { groupId: item.groupId } : {}), first, last });
    const items = read.papers.map((paper): BucketItemInput => ({ ...item, zoteroSet: undefined, bucketKey: `${item.bucketKey}:${paper.key}`, sourceRefId: paper.key, title: paper.title, authors: paper.authors.slice(0, MAX_AUTHORS), year: paper.year, doi: paper.doi, abstract: paper.abstract, venueName: paper.venue, zoteroUserId: read.zoteroUserId }));
    const expanded = await expandJobSources(items, { fetchPapersFromHistory: () => { throw new Error("A Zotero range holds no search"); }, readLibraryItems: async () => [], resolveZoteroUserId: async () => read.zoteroUserId });
    const papers = expanded.map(({ paper, sourceType, sourceId }): SetupPaper => ({ ...paper, storageId: paper.storageId as Id<"_storage"> | undefined, sourceType, sourceId }));
    const done = read.ended || last >= range.last;
    return { papers, next: done ? onTo(position + 1) : { ...place, read: place.read + (last - first + 1) } };
  }
  if (item.evidenceLibrarySet) {
    const range = item.evidenceLibrarySet;
    // The library turns the source into keys on the first step, as the job's person may read it, and the job reads those and no others; `resume` holds how many it kept.
    if (place.resume === undefined) {
      const keys = await resolveLibraryKeys(ctx, { libraryId: range.libraryId, userId: job.createdBy, source: range.source, first: range.first, last: range.last });
      const kept = keys.length > 0 && (await keepLibraryKeys(ctx, job._id, keys, { part: position, epoch: job.runEpoch ?? 0 }));
      return { papers: [], next: kept ? { ...place, resume: String(keys.length) } : onTo(position + 1) };
    }
    const kept = Number(place.resume);
    const keys: string[] = await ctx.runQuery(internal.paperSets.libraryKeys.slice, { job: job._id, part: position, offset: place.read, count: Math.min(SETUP_STEP, kept - place.read) });
    // Records the library no longer shows are left out.
    const read: SearchPaper[] = keys.length ? await ctx.runAction(internal.evidenceLibraries.sourceActions.papers, { libraryId: range.libraryId, keys }) : [];
    const papers = read.map(({ venue, ...paper }): SetupPaper => ({ ...paper, venueName: venue, sourceType: "evidenceLibrary", sourceId: range.libraryId }));
    const done = place.read + SETUP_STEP >= kept;
    return { papers, next: done ? onTo(position + 1) : { ...place, read: place.read + SETUP_STEP } };
  }
  if (item.source === "screening") {
    const selection = item.screeningSelection;
    if (!selection) throw createError("VALIDATION_ERROR", "Screening selection is missing.");
    // From the first paper of its range, as many as the start counted.
    const from = (selection.first ?? 1) + place.read;
    const { papers: held, resume } = await heldPapers(ctx, await jobReader(ctx, job), { kind: "screening", jobId: selection.jobId }, { first: from, last: Math.min((selection.first ?? 1) + selection.count - 1, from + SETUP_STEP - 1) }, place.resume, selection.revision);
    const papers = held.map(({ venue, ...paper }): SetupPaper => ({ ...paper, venueName: venue, sourceType: "screening", sourceId: selection.jobId, screeningRevision: selection.revision }));
    const read = place.read + papers.length;
    if (resume && read < selection.count) return { papers, next: { ...place, read, resume } };
    if (read !== selection.count) throw createError("CONFLICT", "Screening inputs changed. Select the screening again before starting extraction.");
    return { papers, next: onTo(position + 1) };
  }
  const pagedAt = sources.findIndex((source) => pagedSource(source.item));
  const own = pagedAt === -1 ? sources : sources.slice(0, pagedAt);
  let zoteroUserId: string | null | undefined;
  const expanded = await expandJobSources(own.map((source) => source.item), {
    fetchPapersFromHistory: () => { throw new Error("A search is read a page at a time"); },
    readLibraryItems: (ids) => readLibraryInBatches(ids, LIBRARY_READ_BATCH, async (batch) => ctx.runQuery(internal.extraction.queries.internal.ownedLibraryItems, { ...(await jobReader(ctx, job)), ids: batch })),
    resolveZoteroUserId: async () => {
      if (zoteroUserId === undefined) zoteroUserId = (await ctx.runQuery(internal.zotero.queries.getZoteroUserIdInternal, {}).catch(() => null)) ?? null;
      return zoteroUserId ?? undefined;
    },
  });
  const papers = expanded.map(({ paper, sourceType, sourceId, screeningRevision }): SetupPaper => ({ ...paper, storageId: paper.storageId as Id<"_storage"> | undefined, sourceType, sourceId, screeningRevision }));
  return { papers, next: onTo(own.at(-1)!.position + 1) };
}

/**
 * Sets a job up (#634): reads its sources a step at a time and saves each step, queueing its
 * processable papers, then runs them. Each step saves where setup goes on from with its
 * papers, so a job of any size is never held whole: past a few minutes the action hands on to
 * another, and a pause or restart stops it where it was.
 */
export async function runSetupExtractionQueueJob(
  ctx: ActionCtx,
  {
    jobId,
    expectedEpoch,
  }: {
    jobId: Id<"extractionJobs">;
    expectedEpoch: number;
  },
): Promise<void> {
  const started = Date.now();
  const initialControl = await loadActiveSetupControl(ctx, {
    jobId,
    expectedEpoch,
  });
  if (!initialControl) return;

  try {
    const runtime = setupRuntime(initialControl.pdfEnabled);
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const user: Doc<"users"> | null = await ctx.runQuery(internal.users.internal.getUserById, { userId: initialControl.job.createdBy });
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    let place: SetupPlace = initialControl.job.setup ?? { position: 0, read: 0, papers: 0, processable: 0 };
    while (!place.done) {
      if (Date.now() - started > SETUP_ACTION_MS) {
        await ctx.scheduler.runAfter(0, internal.extraction.actions.setupExtractionQueueJob, { jobId, expectedEpoch });
        return;
      }
      const step = await readStep(ctx, initialControl.job, user.clerkId, place);
      await ctx.runMutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: step?.papers ?? [], setup: { expectedEpoch, next: step ? step.next : { ...place, done: true } } });
      const control = await loadActiveSetupControl(ctx, { jobId, expectedEpoch });
      if (!control?.job.setup) return;
      place = control.job.setup;
    }
    // Every source read, the keys an Evidence Library gave for its records go.
    await ctx.runMutation(internal.paperSets.libraryKeys.dropRun, { job: jobId, epoch: expectedEpoch });

    await ctx.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: runtime.pdfEnabled ? "downloading_pdfs" : "indexing",
        totalPapers: place.processable,
      },
    );

    if (place.papers === 0 || place.processable === 0) {
      await ctx.runMutation(
        internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
        { jobId, expectedEpoch },
      );
      return;
    }

    const beforeDispatchControl = await loadActiveSetupControl(ctx, {
      jobId,
      expectedEpoch,
    });
    if (!beforeDispatchControl) return;

    await ctx.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: "extracting",
      },
    );

    // Every source read, each paper is the copy that runs: they're queued a page at a time, and the last page starts the run.
    await ctx.runMutation(internal.extraction.mutations.resume.requeueLater, {
      jobId,
      epoch: expectedEpoch,
      pdfEnabled: runtime.pdfEnabled,
      paperConcurrency: runtime.paperConcurrency,
      questionConcurrency: runtime.questionConcurrency,
      cursor: null,
      queued: 0,
    });
  } catch (error) {
    const classified = classifyUnknownError(error);
    await ctx.runMutation(internal.paperSets.libraryKeys.dropRun, { job: jobId, epoch: expectedEpoch });
    await ctx.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: "failed",
        error: toStructuredJobError(classified),
      },
    );
  }
}

export const setupExtractionQueueJob = internalAction({
  args: {
    jobId: v.id("extractionJobs"),
    expectedEpoch: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await runSetupExtractionQueueJob(ctx, args);
    return null;
  },
});
