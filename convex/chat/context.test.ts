/**
 * Behavioral tests for the chat system-prompt builder.
 *
 * Locks the contract the renderer depends on:
 *  - papers list is emitted as the cache-hot second system message
 *  - first message contains the explicit citation rules (including the
 *    combined-bracket form the parser accepts)
 *  - `buildSystemPromptForJob` live-reads `chatPapers.included` at
 *    call time (decision D2) and preserves stable positional ids
 *    across toggles (decision D1)
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

type SeededSource = {
  sourceId: Id<"extractionJobSources">;
  position: number;
  title: string;
  openalexId: string;
};

async function seedJobWithSources(
  t: ReturnType<typeof convexTest>,
  titles: string[],
  includedByIndex: boolean[] = titles.map(() => true),
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
    const sources: SeededSource[] = [];
    for (let i = 0; i < titles.length; i++) {
      const sourceId = await ctx.db.insert("extractionJobSources", {
        jobId,
        position: i + 1,
        bucketKey: `openalex:W${1000 + i}`,
        source: "library",
        sourceRefId: `W${1000 + i}`,
        openalexId: `W${1000 + i}`,
        title: titles[i],
        authors: ["Doe"],
        year: 2024,
        abstract: "abs",
      });
      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId,
        included: includedByIndex[i] ?? true,
      });
      sources.push({
        sourceId,
        position: i + 1,
        title: titles[i],
        openalexId: `W${1000 + i}`,
      });
    }
    return { jobId, sources };
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

  it("warns the model that paper ids are stable anchors and may contain gaps", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithSources(t, ["Alpha"]);
    const [rules] = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );
    const lowered = rules.content.toLowerCase();
    expect(lowered).toContain("stable anchors");
    expect(lowered).toContain("gaps");
    expect(rules.content).toMatch(/\[P1\],\s*\[P4\],\s*\[P7\]/);
  });

  it("excludes excluded papers from the prompt, keeping stable positional ids", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithSources(
      t,
      ["Alpha", "Beta", "Gamma"],
      [true, false, true],
    );

    const prompt = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );

    const papers = prompt[1].content;
    expect(papers).toMatch(/<papers count="2">/);
    expect(papers).toContain('id="P1"');
    expect(papers).toContain('id="P3"');
    expect(papers).not.toContain('id="P2"');
    expect(papers).toContain("Alpha");
    expect(papers).not.toContain("Beta");
    expect(papers).toContain("Gamma");
  });

  it("renders <papers count=\"0\"></papers> when every source is excluded (no throw)", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithSources(
      t,
      ["Alpha", "Beta", "Gamma"],
      [false, false, false],
    );

    const prompt = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );

    expect(prompt[1].content).toBe('<papers count="0"></papers>');
  });

  it("preserves positional ids across successive toggles (D1)", async () => {
    const t = convexTest(schema);
    const { jobId, sources } = await seedJobWithSources(
      t,
      ["A", "B", "C", "D", "E"],
    );

    // Exclude source #3 (position 3). Prompt should show P1, P2, P4, P5.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("chatPapers")
        .withIndex("by_job_source", (q) =>
          q.eq("jobId", jobId).eq("sourceId", sources[2].sourceId),
        )
        .unique();
      if (row) await ctx.db.patch(row._id, { included: false });
    });

    const afterFirst = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );
    expect(afterFirst[1].content).toMatch(/<papers count="4">/);
    expect(afterFirst[1].content).toContain('id="P1"');
    expect(afterFirst[1].content).toContain('id="P2"');
    expect(afterFirst[1].content).not.toContain('id="P3"');
    expect(afterFirst[1].content).toContain('id="P4"');
    expect(afterFirst[1].content).toContain('id="P5"');

    // Re-include source #3, exclude source #4. Prompt should show
    // P1, P2, P3, P5 — previously-excluded P3 reappears with its
    // original id, P4 disappears leaving a hole.
    await t.run(async (ctx) => {
      const restore = await ctx.db
        .query("chatPapers")
        .withIndex("by_job_source", (q) =>
          q.eq("jobId", jobId).eq("sourceId", sources[2].sourceId),
        )
        .unique();
      if (restore) await ctx.db.patch(restore._id, { included: true });
      const drop = await ctx.db
        .query("chatPapers")
        .withIndex("by_job_source", (q) =>
          q.eq("jobId", jobId).eq("sourceId", sources[3].sourceId),
        )
        .unique();
      if (drop) await ctx.db.patch(drop._id, { included: false });
    });

    const afterSecond = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );
    expect(afterSecond[1].content).toMatch(/<papers count="4">/);
    expect(afterSecond[1].content).toContain('id="P1"');
    expect(afterSecond[1].content).toContain('id="P2"');
    expect(afterSecond[1].content).toContain('id="P3"');
    expect(afterSecond[1].content).not.toContain('id="P4"');
    expect(afterSecond[1].content).toContain('id="P5"');
  });
});
