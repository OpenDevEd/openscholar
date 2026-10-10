import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";
import { EXTRACTION_PAPER_CONCURRENCY } from "../lib/extraction/limits";

// PDF processing pool — runs OpenAlex search + bibliometric snapshot actions.
// Sized to keep external-service rate limits comfortable; paper extraction
// itself is now driven by the dedicated extraction paper pool below.
export const pdfProcessingPool = new Workpool(components.workpool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});

// Separate screening work from extraction so bulk jobs do not compete on the same pool.
// Screen all on Jev, measured on the e2e backend (#383): 4.4 papers/s at 5, 8.2 at 10,
// 11.8 at 20, 12.6 at 30; every paper landed once at each. Measured again on 2026-10-10 with
// 2,000 papers a run: 12.5 at 20 and 20.4 at 40, every paper once, none retried. 40 is also the
// most a plan gives a workspace (Team), so the plan's number is the limit, not the pool.
export const SCREENING_POOL_SIZE = 40;
export const screeningPool = new Workpool(components.screeningWorkpool, {
  maxParallelism: SCREENING_POOL_SIZE,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});

// Extraction paper pool — one item owns one paper queue row. Question
// parallelism stays inside that action via the extraction queue runtime.
export const extractionPaperPool = new Workpool(
  components.extractionPaperWorkpool,
  {
    // As many as one job runs at once (lib/extraction/limits.ts).
    maxParallelism: EXTRACTION_PAPER_CONCURRENCY,
    retryActionsByDefault: true,
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 2000,
      base: 2,
    },
  },
);
