import { convexTest } from "convex-test";
import { runUncapped } from "../../tests/convex-test-with-limits";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { MAX_ERROR_CONTEXT_BYTES, MAX_TOPIC_KEYWORDS, listsIn, overCap } from "./listCaps";

/** A topic details row whose keywords list holds `count` entries. */
const topic = (count: number) => ({
  id: "T1",
  description: "",
  keywords: Array.from({ length: count }, (_, i) => `keyword ${i}`),
  worksCount: 0,
  fetchedAt: 0,
  revision: "r1",
});

describe("list caps (#426)", () => {
  it("caps every array and record the schema stores", () => {
    const uncapped = Object.entries(schema.tables).flatMap(([table, definition]) =>
      listsIn(definition.validator)
        .filter((list) => list.cap === undefined)
        .map((list) => `${table}.${list.path.join(".")}`),
    );
    expect(uncapped).toEqual([]);
  });

  it("rejects a write that puts more in a list than its cap", async () => {
    const t = convexTest(schema);
    await t.run((ctx) => ctx.db.insert("topicDetails", topic(MAX_TOPIC_KEYWORDS)));
    await expect(t.run((ctx) => ctx.db.insert("topicDetails", topic(MAX_TOPIC_KEYWORDS + 1)))).rejects.toThrow(/topicDetails\.keywords/);
  });

  it("rejects an update that grows a list past its cap", async () => {
    const t = convexTest(schema);
    const id = await t.run((ctx) => ctx.db.insert("topicDetails", topic(1)));
    await expect(t.run((ctx) => ctx.db.patch("topicDetails", id, { keywords: topic(MAX_TOPIC_KEYWORDS + 1).keywords }))).rejects.toThrow(/topicDetails\.keywords/);
  });

  it("checks a patch given only an ID against its table", async () => {
    const t = convexTest(schema);
    const id = await t.run((ctx) => ctx.db.insert("topicDetails", topic(1)));
    await expect(t.run((ctx) => ctx.db.patch(id, { keywords: topic(MAX_TOPIC_KEYWORDS + 1).keywords }))).rejects.toThrow(/topicDetails\.keywords/);
    // A forwarded, unset third argument still means `(id, value)`, as Convex reads it.
    await expect(t.run((ctx) => (ctx.db.patch as (...args: unknown[]) => Promise<void>)(id, { keywords: topic(MAX_TOPIC_KEYWORDS + 1).keywords }, undefined))).rejects.toThrow(/topicDetails\.keywords/);
  });

  it("lets a row saved before its cap be patched on other fields", async () => {
    const t = convexTest(schema);
    const id = await runUncapped(t, (ctx) => ctx.db.insert("topicDetails", topic(MAX_TOPIC_KEYWORDS + 1)));
    await t.run((ctx) => ctx.db.patch("topicDetails", id, { description: "Refreshed" }));
    expect(await t.run((ctx) => ctx.db.get("topicDetails", id))).toMatchObject({ description: "Refreshed" });
  });

  it("applies the caps in the app's mutations, not only in tests", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.topics.details.save, topic(MAX_TOPIC_KEYWORDS));
    await expect(t.mutation(internal.topics.details.save, topic(MAX_TOPIC_KEYWORDS + 1))).rejects.toThrow(/topicDetails\.keywords/);
  });

  it("refuses an untyped field whose JSON is longer than its size", () => {
    const lists = listsIn(schema.tables.extractionPaperErrors.validator);
    const error = (characters: number) => ({ context: { detail: "x".repeat(characters) } });
    expect(overCap(error(MAX_ERROR_CONTEXT_BYTES - 50), lists)).toBeUndefined();
    expect(overCap(error(MAX_ERROR_CONTEXT_BYTES), lists)).toMatchObject({ path: "context", unit: "bytes", cap: MAX_ERROR_CONTEXT_BYTES });
    // Bytes, not characters: 2,000 three-byte characters are about 6,000 bytes.
    expect(overCap({ context: { detail: "研".repeat(2_000) } }, lists)).toMatchObject({ unit: "bytes" });
    // A binary value counts in full, not as `{}`.
    expect(overCap({ context: { blob: new Uint8Array(MAX_ERROR_CONTEXT_BYTES).buffer } }, lists)).toMatchObject({ unit: "bytes" });
  });
});
