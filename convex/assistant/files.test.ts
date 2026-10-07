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
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
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

/** Starts an upload as the person's browser does: a token of its own, whose digest makes the file's row. */
async function start(as: Person, name = "figure.png") {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const fileId = await as.mutation(api.assistant.files.startUpload, { name, digest: await digestOpaqueToken(token) });
  return { fileId, token };
}
const post = (t: Test, token: string, bytes: Uint8Array, type = "image/png") => t.fetch(`/assistant/upload?token=${token}`, { method: "POST", headers: { "Content-Type": type }, body: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
const storedFiles = (t: Test) => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);

/** Uploads an image as the person's browser does: the row first, then the bytes with the token. */
async function attach(t: Test, as: Person, bytes = PNG) {
  const { fileId, token } = await start(as);
  expect((await post(t, token, bytes)).status).toBe(200);
  const storageId = (await t.run((ctx) => ctx.db.get("assistantFiles", fileId)))!.storageId!;
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
  it("stores the bytes for the token's row, once, and nothing for a token that isn't one", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const { fileId, token } = await start(asAda);

    expect((await post(t, "not-a-token", PNG)).status).toBe(410);
    expect(await storedFiles(t)).toBe(0);
    expect((await post(t, token, PNG)).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ state: "pending", mediaType: "image/png", bytes: PNG.length });
    // The token can't be used again, so nothing else can be stored for the file.
    expect((await post(t, token, PNG)).status).toBe(410);
    expect(await storedFiles(t)).toBe(1);
  });

  it("refuses bytes that aren't an image, and the file with them", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const { fileId, token } = await start(asAda, "notes.txt");

    expect((await post(t, token, new TextEncoder().encode("hello"), "image/png")).status).toBe(400);
    expect(await storedFiles(t)).toBe(0);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toBeNull();
  });

  it("keeps nothing of a file removed while its bytes were on the way", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const { fileId, token } = await start(asAda);

    await asAda.mutation(api.assistant.files.remove, { fileId });
    expect((await post(t, token, PNG)).status).toBe(410);
    expect(await storedFiles(t)).toBe(0);

    // Removed after its token was taken and before its bytes were bound: the bytes stored for it go.
    const late = await start(asAda);
    await t.mutation(internal.assistant.files.redeem, { digest: await digestOpaqueToken(late.token) });
    await asAda.mutation(api.assistant.files.remove, { fileId: late.fileId });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: "image/png" })));
    expect(await t.mutation(internal.assistant.files.bind, { fileId: late.fileId, storageId, bytes: PNG.length, mediaType: "image/png" })).toBe(false);
    expect(await storedFiles(t)).toBe(0);
  });

  it("allows as many uploads an hour as the person's plan", async () => {
    const t = convexTest(schema);
    const { asAda, ada } = await people(t);
    await t.run(async (ctx) => {
      await seedCreditsForTest(ctx, { userId: ada, free: 10 });
      const account = await ctx.db.query("billingAccounts").withIndex("by_user", (q) => q.eq("userId", ada)).unique();
      await ctx.db.patch("billingAccounts", account!._id, { limits: { uploads_per_hour: 2 } });
    });
    await start(asAda, "a.png");
    await start(asAda, "b.png");
    await expect(start(asAda, "c.png")).rejects.toThrow(/2 files an hour/);
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

  it("tells a model that takes no images about the ones already in the chat, instead of sending them", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image"]);
    const { fileId } = await attach(t, asAda);
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What does this show?", files: [fileId] });
    await replied(t, threadId);

    await asAda.mutation(api.assistant.threads.setModel, { threadId, modelId: await model(t, ["text"]) });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "And now?" });
    await replied(t, threadId);
    const earlier = (mockDoStream.mock.lastCall![0].prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>).filter((message) => message.role === "user")[0]!.content;
    expect(earlier.some((part) => part.type === "file")).toBe(false);
    expect(earlier.some((part) => part.type === "text" && /can't see images/.test(part.text ?? ""))).toBe(true);
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
