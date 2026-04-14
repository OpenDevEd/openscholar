import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

// For bulk screening operations
export const screeningPool = new Workpool(components.screeningWorkpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});
