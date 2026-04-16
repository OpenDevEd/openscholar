"use node";

// convex/extraction/testing.ts
// Phase 105 D-09: dev-guarded seed action for E2E workbench spec.
// Only usable in local dev or when ALLOW_TEST_SEEDING=true; throws otherwise.
// Pattern: RESEARCH.md Pattern 4 + convex/zotero/actions.ts analog.
//
// Convex runtime rule: files with `"use node"` may only export actions. The
// companion `insertSeededJob` internalMutation lives in `testing-mutations.ts`
// (V8 runtime) because mutations cannot be defined in a Node runtime module.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/** Triple-condition dev guard mirroring convex/lib/env.ts requireAppUrl. */
function assertDevEnvironment(): void {
  const isLocalhost = process.env.CONVEX_CLOUD_URL?.includes("localhost") === true;
  const isDev = process.env.NODE_ENV === "development";
  const explicitlyAllowed = process.env.ALLOW_TEST_SEEDING === "true";
  if (!isLocalhost && !isDev && !explicitlyAllowed) {
    throw new Error(
      "seedCompletedJob is dev/test only. Set ALLOW_TEST_SEEDING=true in Convex env to bypass.",
    );
  }
}

// -------------------------------------------------------------------------
// Public entry: internalAction (callable via `npx convex run` in dev or from
// other Convex functions). Delegates DB writes to the companion internalMutation
// in `testing-mutations.ts` (separate file because of the Node/V8 runtime split).
// -------------------------------------------------------------------------

export const seedCompletedJob = internalAction({
  args: {
    paperCount: v.number(),
    questionCount: v.number(),
    // `title` is kept on the action arg for forward-compatibility / future
    // schema evolution. The current `extractionJobs` schema has no `title`
    // field, so the mutation does not persist it -- it is used only for the
    // returned label (when a future query surface needs a display label, the
    // companion mutation can patch it in).
    title: v.optional(v.string()),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, { paperCount, questionCount, title }): Promise<Id<"extractionJobs">> => {
    assertDevEnvironment();

    const effectiveTitle = title ?? `E2E seed ${Date.now()}`;

    const jobId: Id<"extractionJobs"> = await ctx.runMutation(
      internal.extraction.testingMutations.insertSeededJob,
      { paperCount, questionCount, title: effectiveTitle },
    );
    return jobId;
  },
});
