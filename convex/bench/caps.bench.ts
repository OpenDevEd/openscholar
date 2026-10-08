// What the fixed caps cost (#631, #632, #637): making a collection when a person has many, and
// saving a search with the answers it came with, at each size.
import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import schema from "../schema";
import { createCollectionAction } from "../library/collections";
import { seedAnswers } from "../research/answers";
import { insertMany, seedAccount } from "../lib/maxSize.test-support";
import { measure, save } from "./measure.test-support";
import { ownActor } from "../workspaces/actor.test-support";

describe("fixed caps", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  afterAll(() => save(__filename));

  for (const size of [10, 499, 500, 2000]) {
    it(`a new collection beside ${size}`, async () => {
      const t = convexTest(schema);
      const { userId } = await seedAccount(t);
      // Resolved before any measured transaction, so its reads aren't counted as the core's.
      const actor = await t.run((ctx) => ownActor(ctx, userId));
      await insertMany(t, "collections", Array.from({ length: size }, (_, i) => ({ userId, name: `C${i}`, sortName: `c${i}`, itemCount: 0, createdAt: i, updatedAt: i })));
      await t.run(async (ctx) => {
        const row = await ctx.db.query("collectionCounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
        if (row) await ctx.db.patch("collectionCounts", row._id, { count: size });
        else await ctx.db.insert("collectionCounts", { userId, count: size });
      });
      await measure(t, { area: "caps", scenario: "make a collection", size }, (ctx) => createCollectionAction.run(ctx, actor, { name: "One more" }), () => "made");
    });
  }

  for (const size of [1000, 5000, 8000, 20000]) {
    it(`a search saved with ${size} answers`, async () => {
      const t = convexTest(schema);
      const { userId } = await seedAccount(t);
      const day = "2026-10-01T00:00:00Z";
      const [searchId] = await insertMany(t, "searches", [{ userId, localId: "s", revision: 1, data: { id: "s", query: "tutoring", field: "title_and_abstract", count: size, queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [], createdAt: day, updatedAt: day } }]);
      const answers = Array.from({ length: size }, (_, i) => ({ paperId: `W${i}`, responses: [{ question: "Randomized?", response: i % 2 === 0 }] }));
      await measure(t, { area: "caps", scenario: "save a search with its answers", size }, (ctx) => seedAnswers(ctx, userId, searchId, answers, "person", 1), () => "saved");
    });
  }
});
