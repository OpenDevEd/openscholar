import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { LIBRARY_EXPORT_LINK_MS } from "../../lib/library/export";
import { exportLibrary } from "./exports.test-support";

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
    expect(header).toBe("abstract,authors,citedByCount,doi,isOpenAccess,journal,oaStatus,openalexId,publicationYear,rating,savedAt,title,updatedAt");
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
    expect((await t.fetch(`/library/export?token=${token}`)).status).toBe(410);
    expect((await t.fetch("/library/export?token=guessed")).status).toBe(410);
  });

  it("stops working when the link expires", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    await seed(t, "owner", ["One"]);
    const as = t.withIdentity({ subject: "owner" });
    await as.mutation(api.library.exports.start, { digest: await digestOpaqueToken("late"), format: "csv", view });
    vi.advanceTimersByTime(LIBRARY_EXPORT_LINK_MS + 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.fetch("/library/export?token=late")).status).toBe(410);
    expect(await t.run((ctx) => ctx.db.query("libraryExports").take(1))).toEqual([]);
  });
});
