import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

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
// 11.8 at 20, 12.6 at 30; every paper landed once at each.
export const screeningPool = new Workpool(components.screeningWorkpool, {
  maxParallelism: 20,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});

// Moves finished Screen all papers' answers into their screening, one batch at a time. A
// screening counts every change to its answers, so writers to one take turns: papers finish
// into their own result rows, and this one writer moves them (convex/screening/drain.ts).
export const screeningAnswersPool = new Workpool(components.screeningAnswersWorkpool, {
  maxParallelism: 1,
});

// Extraction paper pool — one item owns one paper queue row. Question
// parallelism stays inside that action via the extraction queue runtime.
export const extractionPaperPool = new Workpool(
  components.extractionPaperWorkpool,
  {
    maxParallelism: 5,
    retryActionsByDefault: true,
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 2000,
      base: 2,
    },
  },
);
