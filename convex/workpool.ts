import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

// For PDF processing - limited to avoid overwhelming external services
// Reduced to 3 to prevent database conflicts with onComplete handlers
export const pdfProcessingPool = new Workpool(components.workpool, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});
