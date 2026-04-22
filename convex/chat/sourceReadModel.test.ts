import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import schema from "../schema";
import {
  readChatSourcesSnapshot,
  readChatSourceRows,
  toCorpusSource,
} from "./sourceReadModel";
import {
  filterAndPreservePositions,
  renderPaperCorpus,
} from "../../lib/chat/render-corpus";

async function seedChatJob(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"extractionJobs">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "source_read_model_user",
      email: "source-read-model@test.com",
      state: "active",
      createdAt: 0,
      updatedAt: 0,
    });
    return await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat",
      sourceType: "history",
      name: "source-read-model",
      messageCount: 0,
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

describe("readChatSourceRows", () => {
  it("returns inclusion-aware rows sorted by source position and drops sources missing chatPapers", async () => {
    const t = convexTest(schema);
    const jobId = await seedChatJob(t);

    await t.run(async (ctx) => {
      const sourceOne = await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 2,
        bucketKey: "openalex:W2",
        source: "library",
        sourceRefId: "W2",
        title: "Beta",
        authors: ["Author B"],
        openalexId: "W2",
        year: 2023,
      });
      const sourceTwo = await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 1,
        bucketKey: "openalex:W1",
        source: "library",
        sourceRefId: "W1",
        title: "Alpha",
        authors: ["Author A"],
        openalexId: "W1",
        year: 2024,
      });
      const sourceThree = await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 3,
        bucketKey: "openalex:W3",
        source: "library",
        sourceRefId: "W3",
        title: "Gamma",
        authors: ["Author C"],
        openalexId: "W3",
        year: 2022,
      });

      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId: sourceOne,
        included: false,
      });
      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId: sourceTwo,
        included: true,
      });

      // Intentionally omit a chatPapers row for `sourceThree` to lock the
      // defensive "skip until the reactive next tick" behavior.
    });

    const snapshot = await t.run(async (ctx) =>
      readChatSourcesSnapshot(ctx as QueryCtx, jobId),
    );

    expect(snapshot.totalCount).toBe(3);
    expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.rows.map((row) => row.position)).toEqual([1, 2]);
    expect(snapshot.rows.map((row) => row.title)).toEqual(["Alpha", "Beta"]);
    expect(snapshot.rows.map((row) => row.included)).toEqual([true, false]);
  });

  it("produces the same included corpus that buildSystemPromptForJob renders", async () => {
    const t = convexTest(schema);
    const jobId = await seedChatJob(t);

    await t.run(async (ctx) => {
      const sourceIds: Id<"extractionJobSources">[] = [];
      for (let i = 0; i < 3; i++) {
        sourceIds.push(
          await ctx.db.insert("extractionJobSources", {
            jobId,
            position: i + 1,
            bucketKey: `openalex:W${i + 1}`,
            source: "library",
            sourceRefId: `W${i + 1}`,
            title: ["Alpha", "Beta", "Gamma"][i],
            authors: [`Author ${i + 1}`],
            openalexId: `W${i + 1}`,
            year: 2020 + i,
            abstract: `Abstract ${i + 1}`,
          }),
        );
      }
      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId: sourceIds[0],
        included: true,
      });
      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId: sourceIds[1],
        included: false,
      });
      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId: sourceIds[2],
        included: true,
      });
    });

    const rows = await t.run(async (ctx) =>
      readChatSourceRows(ctx as QueryCtx, jobId),
    );
    const derivedCorpus = renderPaperCorpus(
      filterAndPreservePositions(
        rows.map(toCorpusSource),
        new Set(rows.filter((row) => row.included).map((row) => String(row.sourceId))),
      ),
    );

    const prompt = await t.query(
      internal.chat.context.buildSystemPromptForJob,
      { jobId },
    );

    expect(prompt[1].content).toBe(derivedCorpus);
    expect(prompt[1].content).toContain('id="P1"');
    expect(prompt[1].content).not.toContain('id="P2"');
    expect(prompt[1].content).toContain('id="P3"');
  });
});
