/**
 * Behavioral tests for the chat system-prompt builder.
 *
 * Locks the contract the renderer depends on:
 *  - papers list is emitted as the cache-hot second system message
 *  - first message contains the explicit citation rules (including the
 *    combined-bracket form the parser accepts)
 *  - no soft "cite if you feel like it" wording that would let the
 *    model drift into natural-language references
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

async function seedJobWithSources(
  t: ReturnType<typeof convexTest>,
  titles: string[],
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "c_ctx",
      email: "x@t",
      state: "active",
      createdAt: 0,
      updatedAt: 0,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat",
      sourceType: "history",
      name: "ctx-test",
      messageCount: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    for (let i = 0; i < titles.length; i++) {
      await ctx.db.insert("extractionJobSources", {
        jobId,
        position: i,
        bucketKey: `openalex:W${1000 + i}`,
        source: "library",
        sourceRefId: `W${1000 + i}`,
        openalexId: `W${1000 + i}`,
        title: titles[i],
        authors: ["Doe"],
        year: 2024,
        abstract: "abs",
      });
    }
    return { jobId };
  });
}

describe("buildSystemPromptForJob", () => {
  it("returns exactly two system messages — rules then papers", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithSources(t, ["Alpha", "Beta"]);

    const prompt = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );

    expect(prompt).toHaveLength(2);
    expect(prompt[0].role).toBe("system");
    expect(prompt[1].role).toBe("system");
    expect(prompt[1].content).toMatch(/<papers count="2">/);
    expect(prompt[1].content).toContain("Alpha");
    expect(prompt[1].content).toContain("Beta");
  });

  it("instructs the model to use [P<n>] bracket format", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithSources(t, ["Alpha"]);
    const [rules] = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );
    expect(rules.content).toMatch(/\[P3\]/);
    expect(rules.content.toLowerCase()).toContain("square brackets");
  });

  it("documents the combined-bracket form for multi-paper citations", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithSources(t, ["Alpha"]);
    const [rules] = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );
    expect(rules.content).toMatch(/\[P1,\s*P3,\s*P7\]/);
  });

  it("prohibits inventing ids that are not in the corpus", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithSources(t, ["Alpha"]);
    const [rules] = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );
    expect(rules.content.toLowerCase()).toMatch(/do not invent/);
  });
});
