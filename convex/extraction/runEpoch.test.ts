import { convexTest } from "convex-test";
import type { WorkflowId } from "@convex-dev/workflow";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: "clerk_run_epoch",
      email: "run-epoch@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("runEpoch defaults", () => {
  it("createJobDirect initializes new extraction jobs at epoch 0", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const jobId = await t.mutation(
      internal.extraction.mutations.internal.lifecycle.createJobDirect,
      {
        userId,
        name: "Epoch Default Job",
        sourceType: "history",
        bucketItems: [
          {
            bucketKey: "history:epoch-default",
            source: "history",
            sourceRefId: "epoch-default",
            title: "Epoch Default",
            authors: [],
          },
        ],
      },
    );

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.runEpoch).toBe(0);
  });
});

describe("handleExtractionJobComplete freshness guard", () => {
  it("ignores failed completion for a stale workflow owner", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const jobId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction" as const,
        name: "Stale Workflow Job",
        sourceType: "history" as const,
        status: "extracting" as const,
        totalPapers: 1,
        processedPapers: 0,
        failedPapers: 0,
        runEpoch: 2,
        workflowId: "wf_current",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(
      internal.extraction.mutations.internal.onComplete
        .handleExtractionJobComplete,
      {
        workflowId: "wf_stale" as WorkflowId,
        result: { kind: "failed", error: "boom" },
        context: { jobId },
      },
    );

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("extracting");
    expect(job?.error).toBeUndefined();
  });
});
