/**
 * Extraction Actions — fetch papers from OpenAlex.
 *
 * No `"use node"` directive: this action uses only global `fetch` +
 * `URLSearchParams` (available in the default Convex runtime) and pure
 * helpers lifted to `lib/openalex/`.
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { PaperData } from "./types";
import { searchFiltersValidator } from "./validators";
import { buildOpenAlexSearchParams } from "../../lib/openalex/search-params";
import { mapOpenAlexWorkToPaperData } from "../../lib/openalex/work-mapper";
import { dedupeExpandedSources, expandJobSources } from "./expandSources";
import { createError } from "../lib/errors";

const OPENALEX_WORKS_URL = "https://api.openalex.org/works";

// Per-mutation chunk size for createPaperRecords. The per-paper payload
// after the citedByCount/venueName/workType strip is roughly 1.5–2 KB
// (title + abstract dominate), so 100 papers stays comfortably under the
// 1 MiB single-document limit even on the upper-end of abstract size.
const CREATE_PAPER_CHUNK_SIZE = 100;

export const fetchPapersFromHistory = internalAction({
  args: {
    searchFilters: searchFiltersValidator,
  },
  returns: v.array(
    v.object({
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
      publicationYear: v.optional(v.number()),
      abstract: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      pdfUrl: v.optional(v.string()),
      isOpenAccess: v.optional(v.boolean()),
      citedByCount: v.optional(v.number()),
      venueName: v.optional(v.string()),
      workType: v.optional(v.string()),
    }),
  ),
  handler: async (_ctx, args): Promise<PaperData[]> => {
    const filters = args.searchFilters as Parameters<
      typeof buildOpenAlexSearchParams
    >[0];
    const searchParams = buildOpenAlexSearchParams(filters);

    // CORR-02: fail loudly when OPENALEX_CONTACT_EMAIL isn't configured —
    // OpenAlex polite-pool requires a contact address in the UA header.
    const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
    if (!contactEmail) {
      throw new Error(
        "OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard.",
      );
    }

    const url = `${OPENALEX_WORKS_URL}?${searchParams.toString()}`;
    console.log(`[fetchPapersFromHistory] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": `OpenAlex-Count/1.0 (mailto:${contactEmail})`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `OpenAlex API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { results?: unknown[] };
    const papers = (data.results ?? []).map((work) =>
      mapOpenAlexWorkToPaperData(work as Parameters<typeof mapOpenAlexWorkToPaperData>[0]),
    );

    console.log(`[fetchPapersFromHistory] Fetched ${papers.length} papers`);
    const withAbstracts = papers.filter((p) => p.abstract).length;
    console.log(
      `[fetchPapersFromHistory] Papers with abstracts: ${withAbstracts}/${papers.length}`,
    );

    return papers;
  },
});

/**
 * Single workflow-step boundary that does the entire expand → dedupe →
 * persist sequence for a job's bucket sources, then returns ONLY the
 * inserted paper IDs and small counts. This is the canonical
 * `@convex-dev/workflow` pattern from the README's Limitations section:
 *
 *   "If you run into journal size limits, you can work around this by
 *    storing results in the database or file storage from your step
 *    functions and passing IDs around within the workflow."
 *
 * Internally calls `createPaperRecords` in fixed-size chunks so no
 * individual mutation invocation carries >1 MiB of args. The OpenAlex
 * fetch is delegated to `fetchPapersFromHistory` via `ctx.runAction`,
 * but that nested call's return value is consumed in-process here and
 * never crosses a workflow step boundary, so the per-step 1 MiB ceiling
 * applies only to the action's own return (just the IDs + counts).
 */
export const fetchAndPersistPapers = internalAction({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.object({
    paperIds: v.array(v.id("extractionPapers")),
    totalPapers: v.number(),
    processableCount: v.number(),
  }),
  handler: async (
    ctx,
    { jobId },
  ): Promise<{
    paperIds: Array<Id<"extractionPapers">>;
    totalPapers: number;
    processableCount: number;
  }> => {
    const bucketItems = await ctx.runQuery(
      internal.extraction.queries.internal.getJobSourcesInternal,
      { jobId },
    );

    let cachedZoteroUserId: string | undefined;
    const expandedSources = await expandJobSources(bucketItems, {
      fetchPapersFromHistory: async (searchFilters) => {
        const result = await ctx.runAction(
          internal.extraction.actions.fetchPapersFromHistory,
          { searchFilters },
        );
        return result as PaperData[];
      },
      resolveZoteroUserId: async () => {
        if (cachedZoteroUserId !== undefined) return cachedZoteroUserId;
        try {
          const resolved = await ctx.runQuery(
            internal.zotero.queries.getZoteroUserIdInternal,
            {},
          );
          cachedZoteroUserId = resolved ?? undefined;
        } catch {
          cachedZoteroUserId = undefined;
        }
        return cachedZoteroUserId;
      },
    });

    if (expandedSources.length === 0) {
      throw createError("VALIDATION_ERROR", "No sources selected");
    }

    const dedupedPapers = dedupeExpandedSources(expandedSources).map(
      ({ paper, sourceType, sourceId }) => {
        // OpenAlex enrichment fields (citedByCount/venueName/workType) are
        // populated for extractionJobSources in chat mode and are NOT
        // persisted on extractionPapers, so strip them at the boundary.
        const { citedByCount: _c, venueName: _v, workType: _w, ...rest } = paper;
        return {
          ...rest,
          storageId: rest.storageId as Id<"_storage"> | undefined,
          sourceType,
          sourceId,
        };
      },
    );

    console.log(
      `[fetchAndPersistPapers] Fetched ${expandedSources.length} papers (${dedupedPapers.length} deduped); persisting in chunks of ${CREATE_PAPER_CHUNK_SIZE}`,
    );

    const allPaperIds: Array<Id<"extractionPapers">> = [];
    let processableCount = 0;
    for (let i = 0; i < dedupedPapers.length; i += CREATE_PAPER_CHUNK_SIZE) {
      const batch = dedupedPapers.slice(i, i + CREATE_PAPER_CHUNK_SIZE);
      const result = await ctx.runMutation(
        internal.extraction.mutations.papers.createPaperRecords,
        { jobId, papers: batch },
      );
      allPaperIds.push(...result.paperIds);
      processableCount += result.processableCount;
    }

    console.log(
      `[fetchAndPersistPapers] Persisted ${allPaperIds.length} papers (${processableCount} processable)`,
    );

    return {
      paperIds: allPaperIds,
      totalPapers: dedupedPapers.length,
      processableCount,
    };
  },
});
