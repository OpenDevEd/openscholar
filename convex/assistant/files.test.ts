/// <reference types="vite/client" />
// Files attached to assistant chats (#647): who an upload belongs to, what a message carries
// to the model, what expires, and what goes when a chat goes.
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { FILE_IDLE_MS } from "../../lib/assistant/files";
import { people } from "./assistant.test-support";
import { finishingDoStream, waitFor } from "./turn.test-support";

const { mockDoStream, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);

// The model every reply runs on, in place of OpenRouter.
vi.mock("../ai/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async () => ({ model: new MockLanguageModelV3({ modelId: "mock/model", doStream: mockDoStream }), modelSlug: "mock/model", pricing: { input: 1_000, output: 2_000 } }),
  };
});

beforeEach(() => {
  mockDoStream.mockReset();
  mockDoStream.mockImplementation(finishingDoStream(["Seen"]));
  fetchMock.mockReset();
  fakeAutumn.reset();
  fetchMock.mockImplementation(fakeAutumnFetch());
});

type Test = ReturnType<typeof convexTest>;
type Person = Awaited<ReturnType<typeof people>>["asAda"];

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

/** A model the assistant can run on, taking `inputs`. */
const model = (t: Test, inputs: string[]) =>
  t.run(async (ctx) =>
    ctx.db.insert("models", {
      modelId: `mock/${inputs.join("-")}`,
      name: inputs.includes("image") ? "Sees Model" : "Text Model",
      provider: "openrouter",
      inputPricePerMillion: 1_000,
      outputPricePerMillion: 2_000,
      costMarkup: 1,
      contextLength: 200_000,
      supportedParameters: ["tools"],
      inputModalities: inputs,
      isServed: true,
      sortOrder: 0,
      syncedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

/** Uploads an image as the person's browser does: the row first, then the bytes, then the two bound. */
async function attach(t: Test, as: Person, bytes = PNG, type = "image/png") {
  const { fileId } = await as.mutation(api.assistant.files.uploadUrl, { name: "figure.png" });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type })));
  await as.action(api.assistant.files.ready, { fileId, storageId });
  return { fileId, storageId };
}

async function chatOn(t: Test, inputs: string[]) {
  const who = await people(t);
  await t.run((ctx) => seedCreditsForTest(ctx, { userId: who.ada, free: 100_000 }));
  const modelId = await model(t, inputs);
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Figures", modelId });
  return { ...who, threadId };
}

const replied = (t: Test, threadId: Id<"assistantThreads">) => waitFor(async () => !(await t.run((ctx) => ctx.db.get("assistantThreads", threadId)))?.reply);
/** The parts of the last person's message the model was sent. */
const lastUserParts = () => {
  const prompt = mockDoStream.mock.lastCall![0].prompt as Array<{ role: string; content: Array<{ type: string; data?: unknown; text?: string }> }>;
  return prompt.filter((message) => message.role === "user").at(-1)!.content;
};

describe("attaching a file", () => {
  it("binds an upload only to the person who asked for it, and only to a file stored after", async () => {
    const t = convexTest(schema);
    const { asAda, asBen } = await people(t);
    const earlier = await t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: "image/png" })));
    const { fileId } = await asAda.mutation(api.assistant.files.uploadUrl, { name: "mine.png" });
    // Ben's upload starts before Ada's file is stored, so only her row holding it can stop him claiming it.
    const { fileId: bens } = await asBen.mutation(api.assistant.files.uploadUrl, { name: "theirs.png" });

    // Someone else can't finish her upload, and a file stored before the upload began isn't it.
    const stored = await t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: "image/png" })));
    await expect(asBen.action(api.assistant.files.ready, { fileId, storageId: stored })).rejects.toThrow();
    await expect(asAda.action(api.assistant.files.ready, { fileId, storageId: earlier })).rejects.toThrow();

    await asAda.action(api.assistant.files.ready, { fileId, storageId: stored });
    // A file another row holds can't be claimed, so it can't be removed by someone who saw its address.
    await expect(asBen.action(api.assistant.files.ready, { fileId: bens, storageId: stored })).rejects.toThrow();
    await asBen.mutation(api.assistant.files.remove, { fileId: bens });
    await asBen.mutation(api.assistant.files.remove, { fileId });
    expect(await t.run(async (ctx) => (await ctx.storage.get(stored)) !== null)).toBe(true);
  });

  it("refuses a file that isn't an image and deletes what was uploaded", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const { fileId } = await asAda.mutation(api.assistant.files.uploadUrl, { name: "notes.txt" });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["hello"], { type: "text/plain" })));

    await expect(asAda.action(api.assistant.files.ready, { fileId, storageId })).rejects.toThrow();
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toBeNull();
  });

  it("allows as many uploads an hour as the person's plan", async () => {
    const t = convexTest(schema);
    const { asAda, ada } = await people(t);
    await t.run(async (ctx) => {
      await seedCreditsForTest(ctx, { userId: ada, free: 10 });
      const account = await ctx.db.query("billingAccounts").withIndex("by_user", (q) => q.eq("userId", ada)).unique();
      await ctx.db.patch("billingAccounts", account!._id, { limits: { uploads_per_hour: 2 } });
    });
    await asAda.mutation(api.assistant.files.uploadUrl, { name: "a.png" });
    await asAda.mutation(api.assistant.files.uploadUrl, { name: "b.png" });
    await expect(asAda.mutation(api.assistant.files.uploadUrl, { name: "c.png" })).rejects.toThrow(/2 files an hour/);
  });
});

describe("sending files", () => {
  it("sends an image to the model as its bytes, and an expired one as a note", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image"]);
    const { fileId, storageId } = await attach(t, asAda);

    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What does this show?", files: [fileId] });
    await replied(t, threadId);
    const image = lastUserParts().find((part) => part.type === "file");
    expect(image?.data).toBeInstanceOf(Uint8Array);
    expect((image!.data as Uint8Array).length).toBe(PNG.length);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ state: "sent", threadId });

    // Unread for 30 days, it loses its bytes; the next reply is told it expired, and the chat shows it without a picture.
    await t.run((ctx) => ctx.db.patch("assistantFiles", fileId, { usedAt: Date.now() - FILE_IDLE_MS - 1 }));
    await t.mutation(internal.assistant.files.expire, {});
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);

    await asAda.mutation(api.assistant.replies.send, { threadId, text: "And again?" });
    await replied(t, threadId);
    const earlier = (mockDoStream.mock.lastCall![0].prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>).filter((message) => message.role === "user")[0]!.content;
    expect(earlier.some((part) => part.type === "file")).toBe(false);
    expect(earlier.some((part) => part.type === "text" && /expired/.test(part.text ?? ""))).toBe(true);
    const { page } = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { cursor: null, numItems: 20 } });
    expect(page.find((item) => item.role === "user" && "files" in item && item.files)).toMatchObject({ files: [{ id: fileId, url: null }] });
  });

  it("refuses files in a chat whose model reads no images", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text"]);
    const { fileId } = await attach(t, asAda);

    await expect(asAda.mutation(api.assistant.replies.send, { threadId, text: "Look", files: [fileId] })).rejects.toThrow(/can't read images/);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ state: "pending" });
  });

  it("deletes a chat's files with the chat", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image"]);
    const { fileId, storageId } = await attach(t, asAda);
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Keep this", files: [fileId] });
    await replied(t, threadId);

    await asAda.mutation(api.assistant.threads.remove, { threadId });
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);
  });
});
