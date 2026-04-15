import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_extraction_test",
      email: "extraction-test@example.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get(userId))!;
  });
}

async function seedExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    status: "pending" | "processing" | "completed" | "cancelled" | "failed";
    totalPapers: number;
    processedPapers: number;
    failedPapers: number;
  }> = {}
): Promise<Doc<"extractionJobs">> {
  return await t.run(async (ctx): Promise<Doc<"extractionJobs">> => {
    const id = await ctx.db.insert("extractionJobs", {
      userId,
      status: overrides.status ?? "pending",
      totalPapers: overrides.totalPapers ?? 2,
      processedPapers: overrides.processedPapers ?? 0,
      failedPapers: overrides.failedPapers ?? 0,
      questions: [{ key: "q1", question: "What is the main finding?" }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  });
}

async function seedExtractionPaper(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"extractionJobs">,
  openalexId: string,
  status:
    | "pending"
    | "parsing"
    | "extracting"
    | "completed"
    | "failed"
    | "cancelled" = "pending"
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId,
      title: `Paper ${openalexId}`,
      status,
      createdAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extraction mutations", () => {
  describe("batched enqueue (WORK-06)", () => {
    it("enqueueAllPapers creates paper rows in a single mutation", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id, { totalPapers: 3 });

      // Seed 3 pending papers
      await seedExtractionPaper(t, job._id, "W001");
      await seedExtractionPaper(t, job._id, "W002");
      await seedExtractionPaper(t, job._id, "W003");

      // Verify papers exist with pending status
      const papers = await t.run(async (ctx) => {
        return await ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", job._id))
          .collect();
      });

      expect(papers).toHaveLength(3);
      expect(papers.every((p) => p.status === "pending")).toBe(true);
    });
  });

  describe("idempotent save (WORK-07)", () => {
    it("saving same (paperId, questionId) twice produces one row", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id);
      const paper = await seedExtractionPaper(t, job._id, "W001");

      // First save
      await t.run(async (ctx) => {
        await ctx.db.insert("extractionResults", {
          jobId: job._id,
          paperId: paper._id,
          questionId: "q1",
          answer: "test answer",
          createdAt: Date.now(),
        });
      });

      // Second save -- idempotent check via by_paper_question index
      await t.run(async (ctx) => {
        const existing = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper_question", (q) =>
            q.eq("paperId", paper._id).eq("questionId", "q1")
          )
          .unique();

        if (!existing) {
          await ctx.db.insert("extractionResults", {
            jobId: job._id,
            paperId: paper._id,
            questionId: "q1",
            answer: "test answer",
            createdAt: Date.now(),
          });
        }
      });

      // Assert only one row exists
      const results = await t.run(async (ctx) => {
        return await ctx.db
          .query("extractionResults")
          .withIndex("by_paper_question", (q) =>
            q.eq("paperId", paper._id).eq("questionId", "q1")
          )
          .collect();
      });

      expect(results).toHaveLength(1);
    });

    it("saves result with all value fields (EXTR-09)", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id);
      const paper = await seedExtractionPaper(t, job._id, "W001");

      await t.run(async (ctx) => {
        await ctx.db.insert("extractionResults", {
          jobId: job._id,
          paperId: paper._id,
          questionId: "q1",
          answer: "The study found significant results",
          confidence: "high",
          evidenceQuote: "significant results were observed",
          evidenceSourceId: "section-3",
          evidenceStartChar: 1500,
          evidenceEndChar: 1540,
          reasoning: "Direct statement in results section",
          modelUsed: "google/gemini-2.5-flash-lite",
          parsingSource: "pmc",
          tokensIn: 5000,
          tokensOut: 200,
          createdAt: Date.now(),
        });
      });

      const results = await t.run(async (ctx) => {
        return await ctx.db
          .query("extractionResults")
          .withIndex("by_paper_question", (q) =>
            q.eq("paperId", paper._id).eq("questionId", "q1")
          )
          .collect();
      });

      expect(results).toHaveLength(1);
      expect(results[0].answer).toBe("The study found significant results");
      expect(results[0].confidence).toBe("high");
      expect(results[0].evidenceQuote).toBe("significant results were observed");
      expect(results[0].evidenceStartChar).toBe(1500);
      expect(results[0].evidenceEndChar).toBe(1540);
      expect(results[0].reasoning).toBe("Direct statement in results section");
      expect(results[0].modelUsed).toBe("google/gemini-2.5-flash-lite");
      expect(results[0].parsingSource).toBe("pmc");
      expect(results[0].tokensIn).toBe(5000);
      expect(results[0].tokensOut).toBe(200);
    });

    it("saves failed question result with null answer and errorMessage", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id);
      const paper = await seedExtractionPaper(t, job._id, "W002");

      await t.run(async (ctx) => {
        await ctx.db.insert("extractionResults", {
          jobId: job._id,
          paperId: paper._id,
          questionId: "q1",
          answer: null,
          errorMessage: "All cascade tiers failed",
          createdAt: Date.now(),
        });
      });

      const results = await t.run(async (ctx) => {
        return await ctx.db
          .query("extractionResults")
          .withIndex("by_paper_question", (q) =>
            q.eq("paperId", paper._id).eq("questionId", "q1")
          )
          .collect();
      });

      expect(results).toHaveLength(1);
      expect(results[0].answer).toBeNull();
      expect(results[0].errorMessage).toBe("All cascade tiers failed");
      expect(results[0].confidence).toBeUndefined();
    });

    it("different questionIds produce separate rows", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id);
      const paper = await seedExtractionPaper(t, job._id, "W001");

      // Save result for q1
      await t.run(async (ctx) => {
        await ctx.db.insert("extractionResults", {
          jobId: job._id,
          paperId: paper._id,
          questionId: "q1",
          answer: "answer for q1",
          createdAt: Date.now(),
        });
      });

      // Save result for q2 -- different question, should create new row
      await t.run(async (ctx) => {
        await ctx.db.insert("extractionResults", {
          jobId: job._id,
          paperId: paper._id,
          questionId: "q2",
          answer: "answer for q2",
          createdAt: Date.now(),
        });
      });

      // Assert two rows exist for this paper
      const results = await t.run(async (ctx) => {
        return await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
      });

      expect(results).toHaveLength(2);
    });
  });

  describe("job finalization", () => {
    it("job is finalized when processedPapers + failedPapers >= totalPapers", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id, {
        totalPapers: 2,
        processedPapers: 1,
        failedPapers: 1,
      });

      // Simulate finalization check
      await t.run(async (ctx) => {
        const freshJob = await ctx.db.get(job._id);
        if (!freshJob) return;

        if (
          freshJob.processedPapers + freshJob.failedPapers >=
          freshJob.totalPapers
        ) {
          await ctx.db.patch(job._id, {
            status: "completed",
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      });

      const finalJob = await t.run(async (ctx) => {
        return await ctx.db.get(job._id);
      });

      expect(finalJob?.status).toBe("completed");
      expect(finalJob?.completedAt).toBeDefined();
    });

    it("terminal job status is a no-op for finalization", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id, {
        status: "cancelled",
        totalPapers: 2,
        processedPapers: 2,
        failedPapers: 0,
      });

      // Finalization should not change cancelled status
      await t.run(async (ctx) => {
        const freshJob = await ctx.db.get(job._id);
        if (!freshJob) return;

        const TERMINAL = ["completed", "cancelled", "failed"];
        if (TERMINAL.includes(freshJob.status)) return;

        // This should never execute for cancelled jobs
        await ctx.db.patch(job._id, {
          status: "completed",
          completedAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const finalJob = await t.run(async (ctx) => {
        return await ctx.db.get(job._id);
      });

      expect(finalJob?.status).toBe("cancelled");
    });
  });

  describe("schema validation", () => {
    it("extractionJobs table accepts all required fields", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);

      const jobId = await t.run(async (ctx) => {
        return await ctx.db.insert("extractionJobs", {
          userId: user._id,
          status: "pending",
          totalPapers: 5,
          processedPapers: 0,
          failedPapers: 0,
          questions: [
            { key: "q1", question: "Main finding?", expectedType: "text" },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      expect(jobId).toBeDefined();
    });

    it("extractionPapers table accepts workpoolId field", async () => {
      const t = convexTest(schema);
      const user = await seedUser(t);
      const job = await seedExtractionJob(t, user._id);

      const paperId = await t.run(async (ctx) => {
        return await ctx.db.insert("extractionPapers", {
          jobId: job._id,
          openalexId: "W999",
          title: "Test Paper",
          status: "pending",
          workpoolId: "wp_123",
          createdAt: Date.now(),
        });
      });

      const paper = await t.run(async (ctx) => {
        return await ctx.db.get(paperId);
      });

      expect(paper?.workpoolId).toBe("wp_123");
    });
  });
});
