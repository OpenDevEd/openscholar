/**
 * Extraction Actions — fetch papers from OpenAlex.
 *
 * No `"use node"` directive: this action uses only global `fetch` +
 * `URLSearchParams` (available in the default Convex runtime) and pure
 * helpers lifted to `lib/openalex/`.
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import type { PaperData } from "./types";
import { searchFiltersValidator } from "./validators";
import { buildOpenAlexSearchParams } from "../../lib/openalex/search-params";
import { mapOpenAlexWorkToPaperData } from "../../lib/openalex/work-mapper";

const OPENALEX_WORKS_URL = "https://api.openalex.org/works";

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
