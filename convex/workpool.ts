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
export const screeningPool = new Workpool(components.screeningWorkpool, {
  maxParallelism: 5,
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
    maxParallelism: 5,
    retryActionsByDefault: true,
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 2000,
      base: 2,
    },
  },
);
