// A big bulk change's changes are kept in parts no heavier than a document can hold (#637).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { partsOf } from "./bulkPapers";

it("splits changes by their encoded size, keeping each one whole and in order", () => {
  // Papers with long non-Latin abstracts: three bytes a character.
  const items = Array.from({ length: 300 }, (_, i) => ({ openalexId: `W${i}`, abstract: "تجربة".repeat(1_200) }));
  const parts = partsOf(items);
  for (const part of parts) expect(new TextEncoder().encode(part.items).length).toBeLessThanOrEqual(512 * 1024 + 2);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.flatMap((part) => JSON.parse(part.items) as typeof items)).toEqual(items);
  expect(parts.map((part) => part.first)).toEqual(parts.map((_, i) => parts.slice(0, i).reduce((sum, earlier) => sum + JSON.parse(earlier.items).length, 0)));
});

it("keeps a bulk change's parts while it's run, and forgets them once the run is long over", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "bulk", email: "bulk@test.local", state: "active", createdAt: 1, updatedAt: 1 }));
    await t.mutation(internal.assistant.bulkPapers.keep, { userId, key: "k", first: 0, items: "[{}]" });
    await t.mutation(internal.assistant.bulkPapers.claim, { userId, key: "k" });
    const left = () => t.run(async (ctx) => (await ctx.db.query("assistantBulkPapers").collect()).length);
    // The day's cleanup comes while the run is going: it waits.
    await t.mutation(internal.assistant.bulkPapers.forget, { key: "k" });
    expect(await left()).toBe(1);
    vi.advanceTimersByTime(2 * 60 * 60_000);
    await t.finishInProgressScheduledFunctions();
    await t.mutation(internal.assistant.bulkPapers.forget, { key: "k" });
    expect(await left()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
