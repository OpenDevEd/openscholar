/**
 * Generated rows at the sizes the product allows, for tests that prove a flow stays within
 * Convex's transaction limits (#350). Row sizes follow the averages measured on shared dev
 * on 2026-09-30; the content is synthetic.
 */
import type { convexTest } from "convex-test";
import type { Id, TableNames } from "../_generated/dataModel";
import { PAPER_LIMIT } from "../../lib/extraction/limits";
import { MAX_QUESTIONS_PER_JOB } from "../extraction/validators";
import { seedFeatureUser, seedOrganizationFeatures } from "../organizationFeatures.test-support";

type Test = ReturnType<typeof convexTest>;

/** The largest sizes the product allows, and the average row sizes they are measured at. */
export const MAX_SIZE = {
  papersPerJob: PAPER_LIMIT,
  questionsPerJob: MAX_QUESTIONS_PER_JOB,
  libraryItems: 10_000,
  /** The longest OQL query saved on shared dev. */
  oqlQueryChars: 21_854,
} as const;

/** Deterministic filler text of `length` characters. */
export function text(length: number, seed = 0) {
  const words = ["tutoring", "randomized", "trial", "effects", "learning", "outcomes", "students", "schools", "evidence", "review"];
  let out = "";
  for (let i = seed; out.length < length; i++) out += `${words[i % words.length]} `;
  return out.slice(0, length);
}

/** Inserts in transactions small enough for the seeding itself, and the triggers it runs, to stay within the limits. */
export async function insertMany<T extends TableNames>(t: Test, table: T, docs: Array<Record<string, unknown>>, perTransaction = 1_000) {
  const ids: Array<Id<T>> = [];
  for (let i = 0; i < docs.length; i += perTransaction) {
    const slice = docs.slice(i, i + perTransaction);
    ids.push(...(await t.run((ctx) => Promise.all(slice.map((doc) => ctx.db.insert(table, doc as never))))));
  }
  return ids;
}

/** A signed-in account with extraction on. */
export async function seedAccount(t: Test, clerkId = "max_size_user") {
  const userId = await t.run(async (ctx) => {
    await seedOrganizationFeatures(ctx, [clerkId], { extraction: true });
    for (const key of ["extraction.enabled", "extraction.start", "extraction.chat"]) await ctx.db.insert("featureFlags", { key, enabled: true, updatedAt: 1 });
    return seedFeatureUser(ctx, clerkId);
  });
  return { userId, as: t.withIdentity({ subject: clerkId, tokenIdentifier: `${clerkId}|test` }) };
}

/** An extraction job of `papers` × `questions`, every result completed: about 3.9 KB a paper and 0.9 KB a result. */
export async function seedExtractionJob(t: Test, userId: Id<"users">, { papers = MAX_SIZE.papersPerJob as number, questions = MAX_SIZE.questionsPerJob as number } = {}) {
  const [jobId] = await insertMany(t, "extractionJobs", [{ userId, mode: "extraction", sourceType: "history", status: "completed", totalPapers: papers, name: "Max-size job", createdAt: 1, updatedAt: 1 }]);
  const keys = Array.from({ length: questions }, (_, i) => `q${i}`);
  await insertMany(t, "extractionQuestions", keys.map((key, order) => ({ jobId, key, order, question: `${text(80, order)}?`, type: "string", createdAt: 1 })));
  const paperIds = await insertMany(t, "extractionPapers", Array.from({ length: papers }, (_, i) => ({
    jobId, openalexId: `W${i}`, title: text(120, i), sortTitle: text(120, i), abstract: text(1_800, i), authors: [text(40, i), text(40, i + 1)],
    publicationYear: 2000 + (i % 25), status: "completed", sourceType: "history", sourceId: `W${i}`, processable: true,
    searchText: text(1_500, i), questionAnswerTokens: keys.map((key) => `${key}::${text(8, i)}`), avgConfidence: 0.8, hasErrors: false, hasPdfSource: false, isOpenAccess: false, completedAt: 1,
  })));
  await insertMany(t, "extractionResults", paperIds.flatMap((paperId, p) => keys.map((questionKey, q) => ({
    jobId, paperId, questionKey, status: "completed", answer: text(120, p + q), reasoning: text(500, p + q), confidence: 0.8,
    citations: [], citationStatus: "best_effort", attemptCount: 1, billed: true, creditsUsed: 1, processedAt: 1,
  }))), 500);
  return { jobId, paperIds, questionKeys: keys };
}

/** A library of `items` saved papers, about 2.1 KB each, with ratings 1 to 5 and every item in one collection. */
export async function seedLibrary(t: Test, userId: Id<"users">, { items = MAX_SIZE.libraryItems as number } = {}) {
  const itemIds = await insertMany(t, "libraryItems", Array.from({ length: items }, (_, i) => ({
    userId, openalexId: `https://openalex.org/W${i}`, rating: (i % 5) + 1, title: text(100, i), authors: text(60, i), publicationYear: 1990 + (i % 35),
    journal: text(40, i), citedByCount: i % 500, paperData: text(1_700, i), searchableText: text(160, i), savedAt: 1_700_000_000_000 + i, updatedAt: 1,
  })));
  const [collectionId] = await insertMany(t, "collections", [{ userId, name: "Everything", itemCount: items, createdAt: 1, updatedAt: 1 }]);
  await insertMany(t, "libraryItemCollections", itemIds.map((libraryItemId) => ({ userId, collectionId, libraryItemId, assignedAt: 1 })), 3_000);
  await t.run((ctx) => ctx.db.patch(userId, { libraryItemCount: items }));
  return { itemIds, collectionId };
}

/** An OQL query as long as the longest saved on shared dev. */
export const longOqlQuery = (variant = 0) => `works where title has (${text(MAX_SIZE.oqlQueryChars - 40, variant)}) ${variant}`;
