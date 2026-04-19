/**
 * Chat thread lifecycle. Implementation ships in P9.T10; this is the
 * scheduler target so startJob's chat branch can compile + ship.
 * Throwing here keeps chat-mode jobs from silently landing without a
 * backing thread; flip the extraction.chat flag OFF until T10 lands.
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";

export const ensureThreadForJob = internalAction({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async () => {
    throw createError(
      "FEATURE_DISABLED",
      "Chat mode is not yet available",
    );
  },
});
