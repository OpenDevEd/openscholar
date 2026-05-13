import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // Tier A: per-paper sub-workflows decouple journal contention from the
    // workpool gate. The workpool throttles concurrent queries/mutations/
    // actions across ALL in-flight workflows (parent + every child), so 10
    // was the bottleneck — paper concurrency 5 × question concurrency 5
    // already needs 25 slots before the parent ever runs a step. Pro-account
    // budget is 100 across all pools; current sum (pdf 10 + screening 5 +
    // credits 1 + this) leaves comfortable headroom at 50.
    maxParallelism: 50,
    retryActionsByDefault: true,
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 1000,
      base: 2,
    },
  },
});
