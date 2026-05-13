import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

// PDF processing pool — runs the OpenAlex search + bibliometric snapshot
// actions. Sized to keep external-service rate limits comfortable while
// the extraction workflow itself fans out paper × question work through
// `step.runAction`. Previous values clamped this to 3 as a workaround for
// OCC contention on the timestamp-keyed `creditsAgg` writes; with that
// hot-leaf issue fixed (random-keyed inserts), the pool can run wider.
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
