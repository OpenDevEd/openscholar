import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertJob } from "./screening/createJob.test-support";
import { digestOpaqueToken } from "./lib/opaqueTokenDigest";
import { EXPORT_LINK_MS } from "../lib/export";
import { exportLibrary, exportParts } from "./exports.test-support";

const view = { sortBy: "savedAt" as const, sortOrder: "desc" as const };

async function seed(t: ReturnType<typeof convexTest>, clerkId: string, titles: string[]) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", libraryItemCount: titles.length, createdAt: 1, updatedAt: 1 });
    for (const [i, title] of titles.entries()) {
      await ctx.db.insert("libraryItems", { userId, openalexId: `https://openalex.org/W${clerkId}${i}`, title, searchableText: title, savedAt: 1_000 + i, updatedAt: 1_000 + i });
    }
    return userId;
  });
}

afterEach(() => vi.useRealTimers());

describe("library export", () => {
  it("writes the person's view as CSV, quoting what needs it", async () => {
    const t = convexTest(schema);
    await seed(t, "owner", ["Plain title", 'Has "quotes", and commas']);
    await seed(t, "someone_else", ["Not theirs"]);
    const { response, text } = await exportLibrary(t, t.withIdentity({ subject: "owner" }), view, "csv");

    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="library-export-\d{4}-\d{2}-\d{2}\.csv"$/);
    const [header, ...rows] = text.trimEnd().split("\n");
    // Excel reads a CSV as UTF-8 only after a byte order mark.
    expect(header).toBe("\ufeffabstract,authors,citedByCount,doi,isOpenAccess,journal,oaStatus,openalexId,publicationYear,rating,savedAt,title,updatedAt");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(',"Has ""quotes"", and commas",');
    expect(text).not.toContain("Not theirs");
  });

  it("writes JSON that counts its papers at the end", async () => {
    const t = convexTest(schema);
    await seed(t, "owner", ["One", "Two"]);
    const { text } = await exportLibrary(t, t.withIdentity({ subject: "owner" }), view);

    expect(JSON.parse(text)).toMatchObject({ totalItems: 2, items: [{ title: "Two" }, { title: "One" }] });
  });

  it("works once", async () => {
    const t = convexTest(schema);
    await seed(t, "owner", ["One"]);
    const { token, response } = await exportLibrary(t, t.withIdentity({ subject: "owner" }), view);

    expect(response.status).toBe(200);
    expect((await t.fetch(`/export?token=${token}`)).status).toBe(410);
    expect((await t.fetch("/export?token=guessed")).status).toBe(410);
  });

  it("stops working when the link expires", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    await seed(t, "owner", ["One"]);
    const as = t.withIdentity({ subject: "owner" });
    await as.mutation(api.exports.start, { digest: await digestOpaqueToken("late"), format: "csv", source: { kind: "library", view } });
    vi.advanceTimersByTime(EXPORT_LINK_MS + 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.fetch("/export?token=late")).status).toBe(410);
    expect(await t.run((ctx) => ctx.db.query("exports").take(1))).toEqual([]);
  });
});

describe("search history export", () => {
  async function seedSearches(t: ReturnType<typeof convexTest>, clerkId: string, queries: string[]) {
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("queryShortcuts", { userId, data: { shorthand: "rct", expansion: "randomized controlled trial", createdAt: 1 } });
      for (const [i, query] of queries.entries()) {
        const at = `2026-09-0${i + 1}T00:00:00.000Z`;
        const data = { id: `${clerkId}-${i}`, query, field: "title" as const, count: 10 + i, queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: at, updatedAt: at };
        await ctx.db.insert("searches", { userId, localId: data.id, revision: 1, data });
      }
    });
  }

  it("writes the person's searches newest first, with their shortcuts expanded, as the list the upload takes back", async () => {
    const t = convexTest(schema);
    await seedSearches(t, "owner", ["tutoring", "rct... AND reading, phonics", "unknown... AND maths"]);
    await seedSearches(t, "someone_else", ["not theirs"]);
    const as = t.withIdentity({ subject: "owner" });

    const json = await exportParts(t, as, { kind: "history" });
    expect(json.response.headers.get("Content-Disposition")).toBe('attachment; filename="search_history.json"');
    expect(JSON.parse(json.text)).toEqual([
      // A shortcut the person never saved leaves the query as they wrote it.
      { count: 12, field: "title", search_query: "unknown... AND maths" },
      { count: 11, field: "title", search_query: "randomized controlled trial AND reading, phonics" },
      { count: 10, field: "title", search_query: "tutoring" },
    ]);

    const csv = await exportParts(t, as, { kind: "history" }, "csv");
    expect(csv.text.trimEnd().split("\n")).toEqual([
      "﻿count,field,search_query",
      "12,title,unknown... AND maths",
      '11,title,"randomized controlled trial AND reading, phonics"',
      "10,title,tutoring",
    ]);
  });
});

describe("shortcut export", () => {
  it("writes the person's shortcuts as the list the Bookmarks page's upload takes back", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      for (const clerkId of ["owner", "someone_else"]) {
        const userId = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 });
        await ctx.db.insert("queryShortcuts", { userId, data: { shorthand: "rct", expansion: `randomized, "controlled" trial by ${clerkId}`, createdAt: 1_700_000_000_000 }, sortName: "rct" });
      }
    });
    const as = t.withIdentity({ subject: "owner" });

    const json = await exportParts(t, as, { kind: "shortcuts" });
    expect(json.response.headers.get("Content-Disposition")).toBe('attachment; filename="bookmarks.json"');
    expect(JSON.parse(json.text)).toEqual([{ name: "rct", expansion: 'randomized, "controlled" trial by owner', createdAt: 1_700_000_000_000 }]);

    const csv = await exportParts(t, as, { kind: "shortcuts" }, "csv");
    expect(csv.text.trimEnd().split("\n")).toEqual(["\ufeffcreatedAt,expansion,name", '2023-11-14T22:13:20.000Z,"randomized, ""controlled"" trial by owner",rct']);
  });
});

describe("screening export", () => {
  it("writes the owner's job a page of results at a time, and nothing of anyone else's", async () => {
    const t = convexTest(schema);
    const jobId = await t.run(async (ctx) => {
      const user = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 });
      const userId = await user("owner");
      await user("someone_else");
      const jobId = await insertJob(ctx, {
        userId, status: "completed", totalPapers: 120, questions: [{ key: "q1", question: "Randomized, or quasi-experimental?" }],
        scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 1, stars: 5 }] },
        createdAt: Date.UTC(2026, 8, 1), updatedAt: 1,
      });
      // More than one read holds, so the file runs across pages.
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("screeningResults", { jobId, openalexId: `https://openalex.org/W${i}`, title: `Paper ${i}`, status: "completed", answers: { q1: i % 2 === 0 }, score: i % 2 === 0 ? 1 : 0, stars: 5, qualified: i % 2 === 0, createdAt: 1 });
      }
      return jobId;
    });
    const as = t.withIdentity({ subject: "owner" });

    const csv = await exportParts(t, as, { kind: "screening", jobId }, "csv");
    expect(csv.response.headers.get("Content-Disposition")).toBe('attachment; filename="screening-export-2026-09-01-completed.csv"');
    const lines = csv.text.split("\n");
    expect(lines).toHaveLength(121);
    expect(lines[0]).toBe('Title,Authors,Year,DOI,OpenAlex ID,"Randomized, or quasi-experimental?",Score,Stars,Qualified,Status');
    expect(lines[1]).toBe("Paper 0,,,,https://openalex.org/W0,Yes,1,5,Yes,completed");
    expect(lines[120]).toBe("Paper 119,,,,https://openalex.org/W119,No,0,5,No,completed");

    const json = JSON.parse((await exportParts(t, as, { kind: "screening", jobId })).text);
    expect(json.job).toMatchObject({ status: "completed", totalPapers: 120, createdAt: "2026-09-01T00:00:00.000Z" });
    expect(json.results).toHaveLength(120);
    expect(json.results[119]).toMatchObject({ title: "Paper 119", answers: { q1: false }, qualified: false });

    const other = await exportParts(t, t.withIdentity({ subject: "someone_else" }), { kind: "screening", jobId });
    expect(other.response.status).toBe(404);
  });
});
