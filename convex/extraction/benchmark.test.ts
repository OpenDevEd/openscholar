/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { getConvexSize } from "convex/values";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a realistic-length string for benchmark seeding.
 * Uses a repeating character set that approximates natural text byte density.
 */
function realisticText(length: number): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!? ";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[i % chars.length];
  }
  return result;
}

const CONFIDENCES = ["high", "medium", "low"] as const;
const CRITIC_VERDICTS = ["supported", "contradicted", null] as const;

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_benchmark_test",
      email: "benchmark-test@example.com",
      firstName: "Benchmark",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get(userId))!;
  });
}

async function seedSubscription(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("subscriptions", {
      userId,
      plan: "free",
      status: "active",
      currentPeriodStart: Date.now(),
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  });
}

/**
 * Seed a complete extraction job with papers and results for payload benchmarking.
 *
 * @param paperCount - Number of papers to seed
 * @param questionCount - Number of questions per paper
 * @param answerLength - Character length of each answer field
 * @param reasoningLength - Character length of each reasoning field
 */
async function seedExtractionJobWithResults(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  opts: {
    paperCount: number;
    questionCount: number;
    answerLength: number;
    reasoningLength: number;
  },
) {
  const { paperCount, questionCount, answerLength, reasoningLength } = opts;

  // Build questions array
  const questions = Array.from({ length: questionCount }, (_, i) => ({
    key: `q${i + 1}`,
    question: `What is the main finding regarding topic ${i + 1}?`,
  }));

  // Create job
  const jobId = await t.run(async (ctx) => {
    return await ctx.db.insert("extractionJobs", {
      userId,
      status: "completed",
      totalPapers: paperCount,
      processedPapers: paperCount,
      failedPapers: 0,
      questions,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
  });

  // Seed papers and results in batches to stay within transaction limits.
  // convex-test t.run() executes as a single Convex mutation/transaction,
  // and Convex transactions have document-write limits. We batch to avoid
  // hitting those limits.
  const BATCH_SIZE = 50;
  const paperIds: Id<"extractionPapers">[] = [];

  for (let batchStart = 0; batchStart < paperCount; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, paperCount);
    const batchPaperIds = await t.run(async (ctx) => {
      const ids: Id<"extractionPapers">[] = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const paperId = await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `W${String(i).padStart(10, "0")}`,
          title: `Research Paper on Topic ${i}: A Systematic Review of Evidence`,
          doi: `10.1234/benchmark.${i}`,
          status: "completed",
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        ids.push(paperId);
      }
      return ids;
    });
    paperIds.push(...batchPaperIds);
  }

  // Seed results for each paper, batched by paper groups
  const RESULTS_BATCH_SIZE = 10; // papers per batch (each paper creates questionCount results)
  for (
    let batchStart = 0;
    batchStart < paperCount;
    batchStart += RESULTS_BATCH_SIZE
  ) {
    const batchEnd = Math.min(batchStart + RESULTS_BATCH_SIZE, paperCount);
    await t.run(async (ctx) => {
      for (let i = batchStart; i < batchEnd; i++) {
        const paperId = paperIds[i];
        for (let q = 0; q < questionCount; q++) {
          const confIdx = (i * questionCount + q) % CONFIDENCES.length;
          const verdictIdx =
            (i * questionCount + q) % CRITIC_VERDICTS.length;
          await ctx.db.insert("extractionResults", {
            jobId,
            paperId,
            questionId: `q${q + 1}`,
            answer: realisticText(answerLength),
            confidence: CONFIDENCES[confIdx],
            evidenceQuote: realisticText(100),
            reasoning: realisticText(reasoningLength),
            modelUsed: "openai/gpt-4o-mini",
            criticVerdict: CRITIC_VERDICTS[verdictIdx] ?? undefined,
            tokensIn: 4500 + (i % 500),
            tokensOut: 180 + (q * 10),
            createdAt: Date.now(),
          });
        }
      }
    });
  }

  return { jobId, paperIds, questions };
}

// ---------------------------------------------------------------------------
// Benchmark Tests (GAP-04)
// ---------------------------------------------------------------------------

describe("GAP-04: Payload size benchmark", () => {
  it("1000 papers x 7 questions payload is under 5 MB", { timeout: 120_000 }, async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      await seedSubscription(t, user._id);

      const { jobId } = await seedExtractionJobWithResults(t, user._id, {
        paperCount: 1000,
        questionCount: 7,
        answerLength: 150,
        reasoningLength: 200,
      });

      // Query all results for this job, matching the getExtractionResults pattern
      const resultArray = await t.run(async (ctx) => {
        const papers = await ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .take(1000);

        const allResults = [];
        for (const paper of papers) {
          const results = await ctx.db
            .query("extractionResults")
            .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
            .take(100);

          allResults.push({
            _id: paper._id,
            title: paper.title,
            openalexId: paper.openalexId,
            doi: paper.doi,
            status: paper.status,
            results: results.map((r) => ({
              questionId: r.questionId,
              answer: r.answer,
              confidence: r.confidence,
              evidenceQuote: r.evidenceQuote,
              reasoning: r.reasoning,
              modelUsed: r.modelUsed,
              criticVerdict: r.criticVerdict,
            })),
          });
        }
        return allResults;
      });

      const payloadBytes = getConvexSize(resultArray);
      const payloadMB = payloadBytes / (1024 * 1024);

      console.log(
        `Benchmark: 1000 papers x 7 questions = ${payloadMB.toFixed(2)} MB (limit: 5 MB)`,
      );
      console.log(
        `  Raw bytes: ${payloadBytes.toLocaleString()} | Rows: ${resultArray.length} papers, ${resultArray.reduce((s, p) => s + p.results.length, 0)} results`,
      );

      expect(payloadMB).toBeLessThan(5);
  });

  it("worst-case payload (500-char answers) stays under 16 MiB hard cap", { timeout: 120_000 }, async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      await seedSubscription(t, user._id);

      const { jobId } = await seedExtractionJobWithResults(t, user._id, {
        paperCount: 1000,
        questionCount: 7,
        answerLength: 500,
        reasoningLength: 800,
      });

      const resultArray = await t.run(async (ctx) => {
        const papers = await ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .take(1000);

        const allResults = [];
        for (const paper of papers) {
          const results = await ctx.db
            .query("extractionResults")
            .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
            .take(100);

          allResults.push({
            _id: paper._id,
            title: paper.title,
            openalexId: paper.openalexId,
            doi: paper.doi,
            status: paper.status,
            results: results.map((r) => ({
              questionId: r.questionId,
              answer: r.answer,
              confidence: r.confidence,
              evidenceQuote: r.evidenceQuote,
              reasoning: r.reasoning,
              modelUsed: r.modelUsed,
              criticVerdict: r.criticVerdict,
            })),
          });
        }
        return allResults;
      });

      const payloadBytes = getConvexSize(resultArray);
      const payloadMB = payloadBytes / (1024 * 1024);

      console.log(
        `Worst-case benchmark: 1000 papers x 7 questions (500-char answers, 800-char reasoning) = ${payloadMB.toFixed(2)} MB (hard cap: 16 MiB)`,
      );
      console.log(
        `  Raw bytes: ${payloadBytes.toLocaleString()} | Rows: ${resultArray.length} papers, ${resultArray.reduce((s, p) => s + p.results.length, 0)} results`,
      );

      expect(payloadMB).toBeLessThan(16);
  });
});
