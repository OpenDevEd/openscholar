import { action } from "../_generated/server";
import { v } from "convex/values";
import { normalizeOpenAlexId } from "../../lib/openalex/normalize";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Conservative batch size to stay well under URL length limits (~700 chars of IDs per request). */
const BATCH_SIZE = 50;

/** Per-batch fetch timeout in milliseconds. */
const PER_BATCH_TIMEOUT_MS = 15_000;

/** Single DOI fetch timeout -- leaves 2s buffer for Convex action overhead to meet ZOT-03 10s req. */
const DOI_TIMEOUT_MS = 8_000;

/** Fallback contact email for OpenAlex polite pool. */
const FALLBACK_EMAIL = "openscholar@sickrin.com";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getContactEmail(): string {
  return process.env.OPENALEX_CONTACT_EMAIL ?? FALLBACK_EMAIL;
}

/** Return type for resolved paper metadata. */
const resolvedPaperValidator = v.object({
  openalexId: v.string(),
  title: v.string(),
  doi: v.optional(v.string()),
});

/**
 * Extract paper metadata from an OpenAlex API work object.
 * The API returns `id` as `"https://openalex.org/W..."` and `doi` as `"https://doi.org/..."`.
 */
function extractPaperFromWork(work: Record<string, unknown>): {
  openalexId: string;
  title: string;
  doi?: string;
} {
  const rawId = typeof work.id === "string" ? work.id : "";
  const openalexId = rawId.replace("https://openalex.org/", "");
  const title = typeof work.title === "string" ? work.title : "";
  const rawDoi = typeof work.doi === "string" ? work.doi : undefined;
  const doi = rawDoi?.replace("https://doi.org/", "") || undefined;
  return { openalexId, title, ...(doi !== undefined ? { doi } : {}) };
}

// ---------------------------------------------------------------------------
// resolveManualIds (SEL-05)
// ---------------------------------------------------------------------------

/**
 * Batch-resolve user-pasted OpenAlex IDs against the OpenAlex API.
 *
 * Accepts raw strings (bare IDs, full URLs, prefixed IDs), normalizes them
 * via `normalizeOpenAlexId`, batches into groups of 50, and validates each
 * batch against the OpenAlex API using the pipe-delimited filter syntax.
 *
 * Returns resolved paper metadata and a list of unresolvable raw inputs.
 * Does NOT throw on partial failures -- failed batches are collected in
 * the unresolvable array.
 */
export const resolveManualIds = action({
  args: {
    rawInputs: v.array(v.string()),
  },
  returns: v.object({
    resolved: v.array(resolvedPaperValidator),
    unresolvable: v.array(v.string()),
  }),
  handler: async (_ctx, args) => {
    const email = getContactEmail();

    // 1. Normalize all inputs
    const normalized = args.rawInputs.map((raw) => ({
      raw,
      id: normalizeOpenAlexId(raw),
    }));

    // Separate invalid (non-normalizable) from valid
    const invalid = normalized.filter((n) => !n.id).map((n) => n.raw);
    const valid = normalized.filter(
      (n): n is { raw: string; id: string } => n.id !== null,
    );

    const resolved: Array<{ openalexId: string; title: string; doi?: string }> = [];
    const unresolvable = [...invalid];

    // 2. Batch into groups of BATCH_SIZE and fetch each batch
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const ids = batch.map((b) => b.id).join("|");
      const url = `https://api.openalex.org/works?filter=openalex:${ids}&mailto=${encodeURIComponent(email)}&per_page=100`;

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(PER_BATCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          // Entire batch failed -- mark all as unresolvable
          unresolvable.push(...batch.map((b) => b.raw));
          continue;
        }

        const data = (await response.json()) as {
          results?: Array<Record<string, unknown>>;
        };

        // Track which IDs were found in this batch
        const foundIds = new Set<string>();
        for (const work of data.results ?? []) {
          const paper = extractPaperFromWork(work);
          if (paper.openalexId) {
            foundIds.add(paper.openalexId.toUpperCase());
            resolved.push(paper);
          }
        }

        // Mark IDs not found in this batch as unresolvable
        for (const b of batch) {
          if (!foundIds.has(b.id.toUpperCase())) {
            unresolvable.push(b.raw);
          }
        }
      } catch {
        // Timeout or network error -- mark entire batch as unresolvable
        unresolvable.push(...batch.map((b) => b.raw));
      }
    }

    return { resolved, unresolvable };
  },
});

// ---------------------------------------------------------------------------
// resolveByDoi (ZOT-03)
// ---------------------------------------------------------------------------

/**
 * Resolve a single DOI to an OpenAlex work ID and paper metadata.
 *
 * Used by the Zotero tab (Phase 104) for lazy DOI-to-OpenAlex resolution.
 * Returns null if the DOI is not found or the request times out.
 *
 * The 8-second timeout on fetch leaves 2 seconds of buffer for Convex
 * action overhead to satisfy the ZOT-03 10-second requirement.
 */
export const resolveByDoi = action({
  args: {
    doi: v.string(),
  },
  returns: v.union(resolvedPaperValidator, v.null()),
  handler: async (_ctx, args) => {
    const email = getContactEmail();
    const url = `https://api.openalex.org/works?filter=doi:${encodeURIComponent(args.doi)}&mailto=${encodeURIComponent(email)}&per_page=1`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DOI_TIMEOUT_MS),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        results?: Array<Record<string, unknown>>;
      };

      const work = data.results?.[0];
      if (!work) return null;

      return extractPaperFromWork(work);
    } catch {
      // Timeout or network error
      return null;
    }
  },
});
