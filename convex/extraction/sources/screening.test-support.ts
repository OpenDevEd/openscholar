import { convexTest } from "convex-test";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { insertMany, seedAccount, text } from "../../lib/maxSize.test-support";
import { seedCreditsForTest } from "../../billing/billing.test-support";
import { insertJob } from "../../screening/createJob.test-support";
import type { FunctionArgs } from "convex/server";
import type { Id } from "../../_generated/dataModel";

type SourceInput = FunctionArgs<typeof api.extraction.mutations.startJob>["bucketItems"][number];

export async function screeningInputs(count = 2) {
  const t = convexTest(schema);
  const { userId, as } = await seedAccount(t, "screening_owner");
  const jobId = await t.run(async ctx => {
    await seedCreditsForTest(ctx, { userId, free: 100_000 });
    return insertJob(ctx, {
      userId, status: "completed", totalPapers: count, unsaved: true, label: "Reading interventions",
      questions: [{ key: "q1", question: "Randomized?" }, { key: "q2", question: "Primary schools?" }],
      scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }, { questionKey: "q2", yesPoints: 0, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 1, stars: 5 }], minimumScore: 1 },
      createdAt: 1, updatedAt: 1,
    });
  });
  await insertMany(t, "screeningResults", Array.from({ length: count }, (_, i) => ({
    jobId, openalexId: `https://openalex.org/W${i}`, title: `Study ${i}`, abstract: text(2_000, i), authors: ["Piper, B.", "ليلى"], publicationYear: 2024, venue: "Education Research", doi: `10.1234/${i}`, citedByCount: 0,
    status: "completed", answers: { q1: true, q2: true }, score: 1, stars: 5, qualified: true, outcome: "included",
    counted: { qualified: true, outcome: "included", answers: { q1: true, q2: true } }, createdAt: 1,
  })), 100);
  await t.run(async ctx => {
    const progress = (await ctx.db.query("screeningJobProgress").withIndex("by_job", q => q.eq("jobId", jobId)).unique())!;
    await ctx.db.patch("screeningJobProgress", progress._id, { completed: count, qualified: count });
  });
  const selection = async (): Promise<SourceInput> => {
    const job = (await as.query(api.screening.queries.getScreeningJob, { jobId }))!;
    return { source: "screening", bucketKey: `screening:${jobId}`, sourceRefId: jobId, title: "Browser title", authors: ["Browser author"], abstract: "Browser abstract", screeningSelection: { jobId, revision: job.revision, count: job.qualifiedPapers } };
  };
  const start = async (items?: SourceInput[]) => as.mutation(api.extraction.mutations.startJob, { name: "Included snapshot", mode: "extraction", bucketItems: items ?? [await selection()], questions: [{ key: "answer", question: "What was measured?", type: "string" }], usePdfs: false });
  const snapshot = (extractionJobId: Id<"extractionJobs">) => t.action(internal.extraction.actions.fetchAndPersistPapers, { jobId: extractionJobId });
  const papers = (extractionJobId: Id<"extractionJobs">) => t.run(ctx => ctx.db.query("extractionPapers").withIndex("by_job", q => q.eq("jobId", extractionJobId)).take(count + 1));
  return { t, as, userId, jobId, selection, start, snapshot, papers };
}
