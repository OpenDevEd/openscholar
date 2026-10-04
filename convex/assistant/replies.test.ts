/// <reference types="vite/client" />
// Assistant replies (#324): a message gets one reply, written as the person who sent it and
// paid for with their credits, one reply at a time in a chat.
import { APICallError } from "@ai-sdk/provider";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { assistant } from "./agent";
import { people } from "./assistant.test-support";
import { finishingDoStream, hangingDoStream, pacedDeltasThenHangDoStream, waitFor } from "./turn.test-support";

const { mockDoStream, modelIdsSeen, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), modelIdsSeen: [] as unknown[], fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);

// The model every reply runs on, in place of OpenRouter.
vi.mock("../chat/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async (_ctx: unknown, modelId: unknown) => {
      modelIdsSeen.push(modelId);
      return { model: new MockLanguageModelV3({ modelId: "mock/model", doStream: mockDoStream }), modelSlug: "mock/model", pricing: { input: 1_000, output: 2_000 } };
    },
  };
});

beforeEach(() => {
  mockDoStream.mockReset();
  modelIdsSeen.length = 0;
  fetchMock.mockReset();
  fakeAutumn.reset();
  fetchMock.mockImplementation(fakeAutumnFetch());
});

type Test = ReturnType<typeof convexTest>;
const firstPage = { cursor: null, numItems: 20 };

/** Ada's chat, shared with Ben to write in, and credits for both. */
async function sharedChat(t: Test) {
  const who = await people(t);
  await t.run(async (ctx) => {
    for (const userId of [who.ada, who.ben]) await seedCreditsForTest(ctx, { userId, free: 10_000 });
  });
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
  await who.asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: who.ben }, role: "write" });
  return { ...who, threadId };
}

const chat = (t: Test, threadId: Id<"assistantThreads">) => t.run(async (ctx) => ctx.db.get("assistantThreads", threadId));
/** Waits for the chat's reply to end, however it ends. */
const ended = (t: Test, threadId: Id<"assistantThreads">) => waitFor(async () => !(await chat(t, threadId))?.reply);
const charges = (t: Test) => t.run(async (ctx) => ctx.db.query("billingUsage").collect());

describe("assistant replies", () => {
  it("answer a message as the person who sent it, on their credits", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ada, ben, threadId } = await sharedChat(t);
    mockDoStream.mockImplementation(finishingDoStream(["Hello", " Ben"]));

    await asBen.mutation(api.assistant.replies.send, { threadId, text: "Hi there" });
    await ended(t, threadId);

    const { page } = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage });
    expect(page).toMatchObject([
      { role: "assistant", text: "Hello Ben", status: "done", model: "mock/model", mine: false },
      { role: "user", text: "Hi there", status: "done", sender: { userId: ben }, mine: false },
    ]);
    expect((await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[1].mine).toBe(true);
    expect(page[0].order).toBe(page[1].order);
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toBeNull();
    // The list shows the chat by what was said last.
    expect((await asAda.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage })).page[0]).toMatchObject({ preview: "Hello Ben", writing: false });
    expect((await asAda.query(api.assistant.threads.list, { scope: "all", text: "hello b", paginationOpts: firstPage })).page).toHaveLength(1);

    // Ben sent it, so Ben pays, though the chat is Ada's.
    const paid = await charges(t);
    expect(paid).toMatchObject([{ userId: ben, kind: "chat", model: "mock/model" }]);
    expect(paid[0].credits).toBeGreaterThan(0);
    expect(paid.some((charge) => charge.userId === ada)).toBe(false);
  });

  it("are written one at a time in a chat, show as they arrive, and stop when someone with write access stops them", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, asCy, ada, threadId } = await sharedChat(t);
    // Text reaches the page a whole word at a time, so each of these ends its word.
    mockDoStream.mockImplementation(pacedDeltasThenHangDoStream(["One ", "two ", "three "], 300));

    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Count for me" });
    await expect(asBen.mutation(api.assistant.replies.send, { threadId, text: "Me too" })).rejects.toThrow(/still replying/);
    await expect(asCy.mutation(api.assistant.replies.send, { threadId, text: "And me" })).rejects.toThrow(/Chat not found/);
    await expect(asCy.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).rejects.toThrow(/Chat not found/);
    await expect(asCy.query(api.assistant.replies.live, { threadId })).rejects.toThrow(/Chat not found/);

    // Ben watches it arrive.
    await waitFor(async () => (await asBen.query(api.assistant.replies.live, { threadId }))?.text.includes("three") === true, { timeoutMs: 5_000 });
    const live = await asBen.query(api.assistant.replies.live, { threadId });
    expect(live).toMatchObject({ senderId: ada, stopping: false, text: "One two three " });
    const writing = await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage });
    expect(writing.page[0]).toMatchObject({ role: "assistant", status: "pending", order: live!.order });

    // A Stop for some other reply does nothing; Ben's stops this one.
    await asBen.mutation(api.assistant.replies.stop, { threadId, attemptId: "another" });
    expect((await chat(t, threadId))?.reply?.stop).toBeUndefined();
    await asBen.mutation(api.assistant.replies.stop, { threadId, attemptId: live!.attemptId });
    await ended(t, threadId);

    const { page } = await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage });
    expect(page[0]).toMatchObject({ role: "assistant", status: "stopped" });
    expect(page[0].text.trim()).toBe("One two three");
    expect(page[0].error).toBeUndefined();

    // The chat takes the next message.
    mockDoStream.mockImplementation(finishingDoStream(["Done"]));
    await asBen.mutation(api.assistant.replies.send, { threadId, text: "Thanks" });
    await ended(t, threadId);
    expect((await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[0]).toMatchObject({ text: "Done", status: "done" });
  });

  it("can't be asked for by someone who only reads the chat", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ben, threadId } = await sharedChat(t);
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: ben }, role: "read" });

    await expect(asBen.mutation(api.assistant.replies.send, { threadId, text: "Hi" })).rejects.toThrow(/not write/);
    await expect(asBen.mutation(api.assistant.threads.setModel, { threadId, modelId: await mockModel(t) })).rejects.toThrow(/not write/);
    expect((await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page).toEqual([]);
    expect(mockDoStream).not.toHaveBeenCalled();
  });

  it("are limited to three at once for one person", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    const others = await Promise.all(["Two", "Three", "Four"].map((title) => asAda.mutation(api.assistant.threads.create, { title })));
    mockDoStream.mockImplementation(hangingDoStream());

    const writing = [threadId, others[0], others[1]];
    // A lock whose action died, older than the live ones, doesn't count and doesn't hide them.
    const dead = await asAda.mutation(api.assistant.threads.create, { title: "Dead" });
    await t.run(async (ctx) => {
      const scheduledId = await ctx.scheduler.runAfter(60 * 60 * 1000, internal.assistant.replies.sweep, {});
      await ctx.scheduler.cancel(scheduledId);
      await ctx.db.patch("assistantThreads", dead, { reply: { attemptId: "dead", senderId: ada, order: 0, startedAt: 1, scheduledId } });
    });
    for (const id of writing) await asAda.mutation(api.assistant.replies.send, { threadId: id, text: "Go" });
    await expect(asAda.mutation(api.assistant.replies.send, { threadId: others[2], text: "Go" })).rejects.toThrow(/already writing 3 replies/);

    for (const id of writing) {
      await asAda.mutation(api.assistant.replies.stop, { threadId: id, attemptId: (await chat(t, id))!.reply!.attemptId });
      await ended(t, id);
    }
    mockDoStream.mockImplementation(finishingDoStream(["Ok"]));
    await asAda.mutation(api.assistant.replies.send, { threadId: others[2], text: "Go" });
    await ended(t, others[2]);
  });

  it("say why when they fail, and charge nothing", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, asCy, threadId } = await sharedChat(t);
    mockDoStream.mockImplementation(async () => {
      throw new APICallError({ message: "Too many requests", url: "https://openrouter.ai", requestBodyValues: {}, statusCode: 429, isRetryable: true });
    });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Hi" });
    await ended(t, threadId);
    const failed = (await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[0];
    expect(failed).toMatchObject({ role: "assistant", status: "failed", error: { code: "rate_limit" } });
    expect(await charges(t)).toEqual([]);

    // Cy has no credits: the reply fails before it reaches the model.
    const own = await asCy.mutation(api.assistant.threads.create, {});
    mockDoStream.mockClear();
    await asCy.mutation(api.assistant.replies.send, { threadId: own, text: "Hi" });
    await ended(t, own);
    expect((await asCy.query(api.assistant.replies.messages, { threadId: own, paginationOpts: firstPage })).page[0]).toMatchObject({
      status: "failed",
      error: { code: "insufficient_credits" },
    });
    expect(mockDoStream).not.toHaveBeenCalled();
  });

  it("run on the Balanced preset's chat model until someone who writes in the chat picks one", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, threadId } = await sharedChat(t);
    const [balanced, picked] = [await mockModel(t, "mock/balanced"), await mockModel(t, "mock/picked")];
    await t.run(async (ctx) => ctx.db.insert("aiModelConfig", { key: "preset.balanced.chat", modelId: "mock/balanced", updatedAt: 1 }));
    mockDoStream.mockImplementation(finishingDoStream(["Ok"]));

    expect(await asAda.query(api.assistant.threads.get, { threadId })).toMatchObject({ model: { _id: balanced } });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "First" });
    await ended(t, threadId);
    await asBen.mutation(api.assistant.threads.setModel, { threadId, modelId: picked });
    expect(await asAda.query(api.assistant.threads.get, { threadId })).toMatchObject({ model: { _id: picked } });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Second" });
    await ended(t, threadId);
    expect(modelIdsSeen).toEqual([balanced, picked]);

    // An effort with no model to take it is refused, not dropped.
    await expect(asAda.mutation(api.assistant.threads.create, { effort: "low" })).rejects.toThrow(/Pick a model/);

    // A chat started on a model runs on it from its first message.
    const own = await asAda.mutation(api.assistant.threads.create, { modelId: picked });
    await asAda.mutation(api.assistant.replies.send, { threadId: own, text: "First" });
    await ended(t, own);
    expect(modelIdsSeen.at(-1)).toBe(picked);
  });

  it("hold their chat while their action waits or runs, and no longer once it has ended", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ada, threadId } = await sharedChat(t);
    // A reply whose action hasn't started: its message is saved, pending, and its lock names the waiting action.
    const scheduledId = await t.run(async (ctx) => {
      const thread = (await ctx.db.get("assistantThreads", threadId))!;
      const { messageId, message } = await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId: ada, prompt: "Hi", skipEmbeddings: true });
      await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, promptMessageId: messageId, message: { role: "assistant", content: "" }, metadata: { status: "pending" }, skipEmbeddings: true });
      const waiting = await ctx.scheduler.runAfter(60 * 60 * 1000, internal.assistant.replies.sweep, {});
      await ctx.db.patch("assistantThreads", threadId, { reply: { attemptId: "waiting", senderId: ada, order: message.order, startedAt: Date.now() - 6 * 60 * 1000, scheduledId: waiting } });
      return waiting;
    });
    const newest = async () => (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[0];

    // However long it has waited, nobody takes its place and the sweep leaves it.
    await expect(asBen.mutation(api.assistant.replies.send, { threadId, text: "Me too" })).rejects.toThrow(/still replying/);
    await t.mutation(internal.assistant.replies.sweep, {});
    expect((await chat(t, threadId))?.reply?.attemptId).toBe("waiting");
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toMatchObject({ attemptId: "waiting", text: "" });
    expect(await newest()).toMatchObject({ role: "assistant", status: "pending" });

    // Its action is gone without releasing the lock: the reply shows as failed at once, and the sweep clears the lock.
    await t.run(async (ctx) => ctx.scheduler.cancel(scheduledId));
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toBeNull();
    expect(await newest()).toMatchObject({ role: "assistant", status: "failed" });
    await t.mutation(internal.assistant.replies.sweep, {});
    expect((await chat(t, threadId))?.reply).toBeUndefined();

    mockDoStream.mockImplementation(finishingDoStream(["Ok"]));
    await asBen.mutation(api.assistant.replies.send, { threadId, text: "Me too" });
    await ended(t, threadId);
    expect(await newest()).toMatchObject({ text: "Ok", status: "done" });
  });

  it("stopped before their action starts call no model and charge nothing", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    const turn = await t.run(async (ctx) => {
      const thread = (await ctx.db.get("assistantThreads", threadId))!;
      const { messageId, message } = await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId: ada, prompt: "Hi", skipEmbeddings: true });
      const scheduledId = await ctx.scheduler.runAfter(60 * 60 * 1000, internal.assistant.replies.sweep, {});
      await ctx.db.patch("assistantThreads", threadId, { reply: { attemptId: "early", senderId: ada, order: message.order, startedAt: Date.now(), scheduledId, stop: true } });
      return { agentThreadId: thread.agentThreadId, promptMessageId: messageId };
    });

    await t.action(internal.assistant.replies.reply, { threadId, attemptId: "early", ...turn, senderId: ada, modelId: null });

    expect(mockDoStream).not.toHaveBeenCalled();
    expect(await charges(t)).toEqual([]);
    expect((await chat(t, threadId))?.reply).toBeUndefined();
    expect((await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[0]).toMatchObject({ role: "assistant", status: "stopped", text: "" });
  });

  it("page their chat's messages within a limit the caller can't lift", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    await t.run(async (ctx) => {
      const thread = (await ctx.db.get("assistantThreads", threadId))!;
      for (let i = 0; i < 70; i++) await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId: ada, prompt: `Message ${i}`, skipEmbeddings: true });
    });
    // An end cursor makes the agent component's paginator ignore `numItems`.
    const { page, isDone } = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { cursor: null, numItems: 500, endCursor: "[]" } });
    expect(page.length).toBeLessThanOrEqual(50);
    expect(page[0].text).toBe("Message 69");
    expect(isDone).toBe(false);
  });

  it("are refused while the assistant is switched off", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await sharedChat(t);
    await t.run(async (ctx) => {
      const flag = (await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "assistant.enabled")).unique())!;
      await ctx.db.patch("featureFlags", flag._id, { enabled: false });
    });
    await expect(asAda.mutation(api.assistant.replies.send, { threadId, text: "Hi" })).rejects.toThrow(/disabled/);
    await expect(asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).rejects.toThrow(/disabled/);
    await expect(asAda.query(api.assistant.replies.live, { threadId })).rejects.toThrow(/disabled/);
  });
});

function mockModel(t: Test, slug = "mock/model") {
  return t.run(async (ctx) =>
    ctx.db.insert("models", {
      modelId: slug,
      name: "Mock Model",
      provider: "openrouter",
      inputPricePerMillion: 1_000,
      outputPricePerMillion: 2_000,
      costMarkup: 1,
      isServed: true,
      sortOrder: 0,
      syncedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}
