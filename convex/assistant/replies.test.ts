/// <reference types="vite/client" />
// Assistant replies (#324): a message gets one reply, written as the person who sent it and
// paid for with their credits, one reply at a time in a chat.
import { APICallError } from "@ai-sdk/provider";
import { listMessages, saveMessages } from "@convex-dev/agent";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import { ASSISTANT_REPLIES_AT_ONCE } from "../lib/constants";
import schema from "../schema";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { endStep } from "./steps";
import { ABORT_ERROR_STRING } from "../../lib/chat/abort-signal";
import { assistant } from "./agent";
import { people } from "./assistant.test-support";
import { erroringOnAbortDoStream, finishingDoStream, hangingDoStream, pacedDeltasThenHangDoStream, waitFor } from "./turn.test-support";

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

type PageOpts = { cursor: string | null; numItems: number; endCursor?: string };
type PageRead = { texts: string[]; isDone: boolean; continueCursor: string; splitCursor?: string | null; pageStatus?: string | null };
/**
 * A chat's pages as the panel's hook keeps them (`usePaginatedQuery`): a page that says where
 * to split is replaced by its two halves, each read to a fixed end, and `more` adds the page
 * after the last. Every read is of all the pages, as a subscription's is.
 */
function pagesOf(read: (opts: PageOpts) => Promise<PageRead>, numItems = 20) {
  const pages: Omit<PageOpts, "numItems">[] = [{ cursor: null }];
  const settle = async () => {
    for (let turn = 0; turn < 60; turn++) {
      const results = await Promise.all(pages.map((page) => read({ numItems, ...page })));
      const at = results.findIndex((result) => result.splitCursor && result.pageStatus);
      if (at < 0) return results;
      const { splitCursor, continueCursor } = results[at];
      pages.splice(at, 1, { cursor: pages[at].cursor, endCursor: splitCursor! }, { cursor: splitCursor!, endCursor: continueCursor });
    }
    throw new Error("the pages never stopped splitting");
  };
  return {
    texts: async () => (await settle()).flatMap((result) => result.texts),
    done: async () => (await settle()).at(-1)!.isDone,
    more: async () => void pages.push({ cursor: (await settle()).at(-1)!.continueCursor }),
  };
}

/** Ada's chat, shared with Ben to write in, and credits for both. */
async function sharedChat(t: Test) {
  const who = await people(t);
  await t.run(async (ctx) => {
    for (const userId of [who.ada, who.ben]) await seedCreditsForTest(ctx, { userId, free: 100_000 });
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
    expect((await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[1]).toMatchObject({ mine: true });
    expect(page[0].order).toBe(page[1].order);
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toBeNull();
    expect(await asAda.query(api.assistant.replies.outcome, { threadId })).toEqual({ phase: "complete", order: page[0].order });
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
    expect(live!.activity).toEqual({ phase: "writing", order: live!.order });
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
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toBeNull();
    expect(await asAda.query(api.assistant.replies.outcome, { threadId })).toEqual({ phase: "stopped", order: live!.order });
    expect("text" in page[0] && page[0].text.trim()).toBe("One two three");
    expect(page[0].error).toBeUndefined();

    // The chat takes the next message.
    mockDoStream.mockImplementation(finishingDoStream(["Done"]));
    await asBen.mutation(api.assistant.replies.send, { threadId, text: "Thanks" });
    await ended(t, threadId);
    expect((await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[0]).toMatchObject({ text: "Done", status: "done" });
  });

  it("show as stopped when the runtime reports the stop as an error, before the first word or after", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await sharedChat(t);
    const stopping = async () => {
      const running = await waitFor(async () => (await chat(t, threadId))?.reply !== undefined).then(async () => (await chat(t, threadId))!.reply!);
      await asAda.mutation(api.assistant.replies.stop, { threadId, attemptId: running.attemptId });
      await ended(t, threadId);
      return (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[0];
    };

    // Stopped while the model was still thinking: the request itself fails.
    mockDoStream.mockImplementation(erroringOnAbortDoStream([], 0));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Think hard" });
    await waitFor(() => mockDoStream.mock.calls.length === 1);
    const early = await stopping();
    expect(early).toMatchObject({ role: "assistant", status: "stopped", text: "" });
    expect(early.error).toBeUndefined();

    // Stopped mid-reply: the stream fails, and what was written is kept.
    mockDoStream.mockImplementation(erroringOnAbortDoStream(["One ", "two "], 300));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Count" });
    await waitFor(async () => (await asAda.query(api.assistant.replies.live, { threadId }))?.text.includes("two") === true, { timeoutMs: 5_000 });
    const late = await stopping();
    expect(late).toMatchObject({ role: "assistant", status: "stopped" });
    expect("text" in late && late.text.trim()).toBe("One two");
    expect(late.error).toBeUndefined();
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

  it("are limited to so many at once for one person, which a deployment's actions are shared by", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    const others = await Promise.all(Array.from({ length: ASSISTANT_REPLIES_AT_ONCE }, (_, index) => asAda.mutation(api.assistant.threads.create, { title: `Chat ${index + 2}` })));
    mockDoStream.mockImplementation(hangingDoStream());

    const writing = [threadId, ...others.slice(0, -1)];
    // A lock whose action died, older than the live ones, doesn't count and doesn't hide them.
    const dead = await asAda.mutation(api.assistant.threads.create, { title: "Dead" });
    await t.run(async (ctx) => {
      const scheduledId = await ctx.scheduler.runAfter(60 * 60 * 1000, internal.assistant.replies.sweep, {});
      await ctx.scheduler.cancel(scheduledId);
      await ctx.db.patch("assistantThreads", dead, { reply: { attemptId: "dead", senderId: ada, order: 0, startedAt: 1, scheduledId } });
    });
    for (const id of writing) await asAda.mutation(api.assistant.replies.send, { threadId: id, text: "Go" });
    await expect(asAda.mutation(api.assistant.replies.send, { threadId: others.at(-1)!, text: "Go" })).rejects.toThrow(new RegExp(`already writing ${ASSISTANT_REPLIES_AT_ONCE} replies`));

    for (const id of writing) {
      await asAda.mutation(api.assistant.replies.stop, { threadId: id, attemptId: (await chat(t, id))!.reply!.attemptId });
      await ended(t, id);
    }
    mockDoStream.mockImplementation(finishingDoStream(["Ok"]));
    await asAda.mutation(api.assistant.replies.send, { threadId: others.at(-1)!, text: "Go" });
    await ended(t, others.at(-1)!);
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

  it("run on what the sender's own AI settings run chat on, until someone who writes in the chat picks a model for it", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ben, threadId } = await sharedChat(t);
    const [balanced, cheap, picked] = [await mockModel(t, "mock/balanced"), await mockModel(t, "mock/cheap"), await mockModel(t, "mock/picked")];
    await t.run(async (ctx) => {
      await ctx.db.insert("aiModelConfig", { key: "preset.balanced.chat", modelId: "mock/balanced", effort: "medium", updatedAt: 1 });
      await ctx.db.insert("aiModelConfig", { key: "preset.cheap.chat", modelId: "mock/cheap", updatedAt: 1 });
      // Ben chose the Cheap preset. Ada chose nothing, which is the Balanced one.
      await ctx.db.insert("userAiConfig", { userId: ben, choice: "cheap", updatedAt: 1 });
    });
    mockDoStream.mockImplementation(finishingDoStream(["Ok"]));

    // Each reads the chat's model as their own message would run on it.
    expect(await asAda.query(api.assistant.threads.get, { threadId })).toMatchObject({ model: { _id: balanced } });
    expect(await asBen.query(api.assistant.threads.get, { threadId })).toMatchObject({ model: { _id: cheap } });
    await asBen.mutation(api.assistant.replies.send, { threadId, text: "From Ben" });
    await ended(t, threadId);
    expect(modelIdsSeen).toEqual([cheap]);
    modelIdsSeen.length = 0;
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "First" });
    await ended(t, threadId);
    await asBen.mutation(api.assistant.threads.setModel, { threadId, modelId: picked });
    expect(await asAda.query(api.assistant.threads.get, { threadId })).toMatchObject({ model: { _id: picked } });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Second" });
    await ended(t, threadId);
    expect(modelIdsSeen).toEqual([balanced, picked]);

    // An effort with no model to take it is refused, not dropped.
    await expect(asAda.mutation(api.assistant.threads.create, { effort: "low" })).rejects.toThrow(/Pick a model/);

    // A model that can't call tools, or is too small for a long conversation, can't be picked.
    const [toolless, small] = await t.run(async (ctx) => {
      const row = (await ctx.db.get("models", picked))!;
      const { _id, _creationTime, ...fields } = row;
      return [
        await ctx.db.insert("models", { ...fields, modelId: "mock/toolless", supportedParameters: [] }),
        await ctx.db.insert("models", { ...fields, modelId: "mock/small", contextLength: 32_000 }),
      ];
    });
    await expect(asAda.mutation(api.assistant.threads.setModel, { threadId, modelId: toolless })).rejects.toThrow(/tools/);
    await expect(asAda.mutation(api.assistant.threads.create, { modelId: small })).rejects.toThrow(/long enough/);

    // A chat that fell back on a model like that, or had one picked before the rule, doesn't send on it either.
    await t.run(async (ctx) => ctx.db.patch("assistantThreads", threadId, { modelId: small }));
    await expect(asAda.mutation(api.assistant.replies.send, { threadId, text: "Third" })).rejects.toThrow(/long enough/);
    await asAda.mutation(api.assistant.threads.setModel, { threadId, modelId: picked });

    // With nothing picking a model, the server's own default runs, and it's held to the rule where the catalog has it.
    const bare = await asAda.mutation(api.assistant.threads.create, {});
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("aiModelConfig").collect()) await ctx.db.delete("aiModelConfig", row._id);
      const { _id, _creationTime, ...fields } = (await ctx.db.get("models", picked))!;
      await ctx.db.insert("models", { ...fields, modelId: SERVER_MODEL_SLUG, supportedParameters: [] });
    });
    await expect(asAda.mutation(api.assistant.replies.send, { threadId: bare, text: "First" })).rejects.toThrow(/tools/);

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
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toMatchObject({ attemptId: "waiting", text: "", activity: { phase: "thinking" } });
    expect(await newest()).toMatchObject({ role: "assistant", status: "pending" });

    // Only a running search in this exchange changes the gesture. A stale tool from an older exchange does not.
    const order = (await chat(t, threadId))!.reply!.order;
    const step = await t.run(async (ctx) => {
      const fields = { threadId, userId: ada, toolCallId: "search", path: "research/papers:search", input: "{}", status: "running" as const, startedAt: 1 };
      await ctx.db.insert("assistantSteps", { ...fields, order: order - 1 });
      return ctx.db.insert("assistantSteps", { ...fields, order });
    });
    expect((await asAda.query(api.assistant.replies.live, { threadId }))!.activity).toEqual({ phase: "searching", order });
    // A later non-search tool can run alongside the search without hiding it.
    await t.run(async (ctx) => ctx.db.insert("assistantSteps", { threadId, order, userId: ada, toolCallId: "collection", path: "library/collections:create", input: "{}", status: "running", startedAt: 2 }));
    expect((await asAda.query(api.assistant.replies.live, { threadId }))!.activity).toEqual({ phase: "searching", order });
    await t.run(async (ctx) => ctx.db.patch("assistantSteps", step, { status: "done" }));
    expect((await asAda.query(api.assistant.replies.live, { threadId }))!.activity).toEqual({ phase: "thinking", order });

    // Its action is gone without releasing the lock: the reply shows as failed at once, and the sweep clears the lock.
    await t.run(async (ctx) => ctx.scheduler.cancel(scheduledId));
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toBeNull();
    expect(await asAda.query(api.assistant.replies.outcome, { threadId })).toEqual({ phase: "failed", order });
    expect(await newest()).toMatchObject({ role: "assistant", status: "failed" });
    await t.mutation(internal.assistant.replies.sweep, {});
    expect((await chat(t, threadId))?.reply).toBeUndefined();

    mockDoStream.mockImplementation(finishingDoStream(["Ok"]));
    await asBen.mutation(api.assistant.replies.send, { threadId, text: "Me too" });
    await ended(t, threadId);
    expect(await newest()).toMatchObject({ text: "Ok", status: "done" });
  });

  it("say a reply was stopped when its last message holds a call as well as text", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    const order = await t.run(async (ctx) => {
      const thread = (await ctx.db.get("assistantThreads", threadId))!;
      const { messageId, message } = await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId: ada, prompt: "Find them", skipEmbeddings: true });
      // Stopped as it called an action: what it had written is kept, with the call, under the stop's marker.
      await assistant.saveMessage(ctx, {
        threadId: thread.agentThreadId,
        promptMessageId: messageId,
        message: { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool-call", toolCallId: "search", toolName: "run_action", input: {} }] },
        metadata: { status: "failed", error: ABORT_ERROR_STRING },
        skipEmbeddings: true,
      });
      return message.order;
    });
    expect(await asAda.query(api.assistant.replies.outcome, { threadId })).toEqual({ phase: "stopped", order });
  });

  it("report failure when the reply dies before saving its first assistant message", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toBeNull();
    expect(await asAda.query(api.assistant.replies.outcome, { threadId })).toEqual({ phase: "idle", order: null });
    const { scheduledId, order } = await t.run(async (ctx) => {
      const thread = (await ctx.db.get("assistantThreads", threadId))!;
      const { message } = await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId: ada, prompt: "Hi", skipEmbeddings: true });
      const scheduledId = await ctx.scheduler.runAfter(60 * 60 * 1000, internal.assistant.replies.sweep, {});
      await ctx.db.patch("assistantThreads", threadId, { reply: { attemptId: "early-failure", senderId: ada, order: message.order, startedAt: 1, scheduledId } });
      return { scheduledId, order: message.order };
    });
    expect((await asAda.query(api.assistant.replies.live, { threadId }))!.activity).toEqual({ phase: "thinking", order });
    await t.run(async (ctx) => ctx.scheduler.cancel(scheduledId));
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toBeNull();
    expect(await asAda.query(api.assistant.replies.outcome, { threadId })).toEqual({ phase: "failed", order });
    await t.mutation(internal.assistant.replies.sweep, {});
    expect(await asAda.query(api.assistant.replies.outcome, { threadId })).toEqual({ phase: "failed", order });
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

    await t.action(internal.assistant.run.reply, { threadId, attemptId: "early", ...turn, senderId: ada, modelId: null });

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
    expect(page[0]).toMatchObject({ text: "Message 69" });
    expect(isDone).toBe(false);
  });

  it("keep every message of their chat on its pages as more arrive, as rows grow past what a page may read, and as rows go", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    const agentThreadId = (await chat(t, threadId))!.agentThreadId;
    const add = (from: number, to: number, size = 0) =>
      t.run(async (ctx) => {
        for (let i = from; i < to; i++) await assistant.saveMessage(ctx, { threadId: agentThreadId, userId: ada, prompt: `Message ${i} ${"x".repeat(size)}`, skipEmbeddings: true });
      });
    const names = (from: number, count: number) => Array.from({ length: count }, (_, i) => `Message ${from - i}`);
    const pages = () =>
      pagesOf(async (paginationOpts) => {
        const { page, ...rest } = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts });
        return { ...rest, texts: page.map((item) => ("text" in item ? item.text.slice(0, 10).trim() : "")) };
      });

    // The newest twenty, then ten more arrive: all thirty are there, none pushed out.
    await add(0, 40);
    const open = pages();
    expect(await open.texts()).toEqual(names(39, 20));
    await add(40, 50);
    expect(await open.texts()).toEqual(names(49, 30));
    // The page before them, read to its own fixed end, and then the rest.
    await open.more();
    expect(await open.texts()).toEqual(names(49, 50));
    // A full page can't tell that nothing is before it. The empty one after it can.
    expect(await open.done()).toBe(false);
    await open.more();
    expect(await open.done()).toBe(true);
    expect(await open.texts()).toEqual(names(49, 50));

    // A page whose rows are gone isn't the chat's last: the ones before it are still to read.
    const gone = pages();
    expect(await gone.texts()).toEqual(names(49, 20));
    await t.run(async (ctx) => {
      const rows = (await listMessages(ctx, components.agent, { threadId: agentThreadId, paginationOpts: { cursor: null, numItems: 20 } })).page;
      await ctx.runMutation(components.agent.messages.deleteByIds, { messageIds: rows.slice(10).map((row) => row._id) });
    });
    expect(await gone.done()).toBe(false);
    await gone.more();
    expect(await gone.texts()).toEqual([...names(49, 10), ...names(29, 20)]);
  });

  it("keep every large message on its pages: split before the size cap stops a page, and lose none when it does", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    const agentThreadId = (await chat(t, threadId))!.agentThreadId;
    // A row holds its text twice. Ten of 100 KB are a megabyte: what a page may read.
    const add = (from: number, to: number, size: number) =>
      t.run(async (ctx) => {
        for (let i = from; i < to; i++) await assistant.saveMessage(ctx, { threadId: agentThreadId, userId: ada, prompt: `Message ${i} ${"x".repeat(size)}`, skipEmbeddings: true });
      });
    const names = (from: number, count: number) => Array.from({ length: count }, (_, i) => `Message ${from - i}`);
    const read = async (paginationOpts: PageOpts) => {
      const { page, ...rest } = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts });
      return { ...rest, texts: page.map((item) => ("text" in item ? item.text.slice(0, 10).trim() : "")) };
    };
    await add(0, 4, 50_000);
    const open = pagesOf(read);
    expect(await open.texts()).toEqual(names(3, 4));
    // Past half a megabyte the page still reads whole, and says where to split.
    await add(4, 7, 50_000);
    expect(await read({ cursor: null, numItems: 20, endCursor: "[]" })).toMatchObject({ pageStatus: "SplitRecommended", texts: names(6, 7) });
    expect(await open.texts()).toEqual(names(6, 7));
    // Past a megabyte the cap stops a page that hasn't split. Its halves still end where it did.
    const late = pagesOf(read);
    await late.texts();
    await add(7, 14, 50_000);
    expect(await late.texts()).toEqual(names(13, 14));
    expect(await open.texts()).toEqual(names(13, 14));

    // Two rows that each fill most of a page, one a call the reply made: the cap stops a read at its first row.
    await t.run(async (ctx) => {
      const prompt = (await listMessages(ctx, components.agent, { threadId: agentThreadId, paginationOpts: { cursor: null, numItems: 1 } })).page[0];
      await saveMessages(ctx, components.agent, { threadId: agentThreadId, promptMessageId: prompt._id, messages: [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "big", toolName: "run_action", input: { text: "y".repeat(600_000) } }] }] });
    });
    await add(14, 15, 300_000);
    const heavy = pagesOf(read);
    // The newest page holds what fits, in halves that don't overlap.
    expect((await heavy.texts()).filter(Boolean)).toEqual(names(14, 1));
    for (let n = 0; n < 8 && !(await heavy.done()); n++) await heavy.more();
    expect((await heavy.texts()).filter(Boolean)).toEqual(names(14, 15));
  });

  it("read one message of a chat as one message, with the rest still to read", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    await t.run(async (ctx) => {
      const thread = (await ctx.db.get("assistantThreads", threadId))!;
      for (let i = 0; i < 3; i++) await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId: ada, prompt: `Message ${i}`, skipEmbeddings: true });
    });
    const one = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { cursor: null, numItems: 1 } });
    expect(one).toMatchObject({ page: [{ text: "Message 2" }], isDone: false, pageStatus: null });
    // Two rows that each fill most of a page stop the read at the first. It still has no split to offer.
    await t.run(async (ctx) => {
      const thread = (await ctx.db.get("assistantThreads", threadId))!;
      const [prompt] = (await listMessages(ctx, components.agent, { threadId: thread.agentThreadId, paginationOpts: { cursor: null, numItems: 1 } })).page;
      await saveMessages(ctx, components.agent, { threadId: thread.agentThreadId, promptMessageId: prompt._id, messages: [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "big", toolName: "run_action", input: { text: "y".repeat(600_000) } }] }] });
      await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId: ada, prompt: `Message 3 ${"x".repeat(300_000)}`, skipEmbeddings: true });
    });
    const heavy = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { cursor: null, numItems: 1 } });
    expect(heavy).toMatchObject({ isDone: false, pageStatus: null, splitCursor: null });
    expect(heavy.page).toHaveLength(1);
  });

  it("name a chat that was made before it had a message by its first one", async () => {
    const t = convexTest(schema);
    const { asAda } = await sharedChat(t);
    mockDoStream.mockImplementation(finishingDoStream(["Hello"]));
    // Made with no title, as the panel makes one to share it or to set what it may spend.
    const untitled = await asAda.mutation(api.assistant.threads.create, {});
    expect((await chat(t, untitled))?.title).toBe("New chat");
    await asAda.mutation(api.assistant.replies.send, { threadId: untitled, text: "Which trials of school feeding measured learning?\nIn sub-Saharan Africa." });
    await ended(t, untitled);
    expect((await chat(t, untitled))?.title).toBe("Which trials of school feeding measured learning?");
    // Its next message leaves the name alone, and so does a first message in a chat that was given one.
    await asAda.mutation(api.assistant.replies.send, { threadId: untitled, text: "And attendance?" });
    await ended(t, untitled);
    expect((await chat(t, untitled))?.title).toBe("Which trials of school feeding measured learning?");
    const named = await asAda.mutation(api.assistant.threads.create, { title: "New chat" });
    await asAda.mutation(api.assistant.threads.rename, { threadId: named, title: "School feeding" });
    await asAda.mutation(api.assistant.replies.send, { threadId: named, text: "Hello" });
    await ended(t, named);
    expect((await chat(t, named))?.title).toBe("School feeding");
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

  it("link a query the reply looked up to its results, with its filters, as a new search, and say how many papers it matched", async () => {
    const t = convexTest(schema);
    const { asAda, ada, threadId } = await sharedChat(t);
    mockDoStream.mockImplementation(finishingDoStream(["Found some"]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Look these up" });
    await ended(t, threadId);
    const order = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.at(-1)!.order;
    await t.run(async (ctx) => {
      const step = { threadId, order, userId: ada, status: "running" as const, startedAt: 1 };
      // A page of a search, and a count by year: each matched more papers than it returned.
      const search = await ctx.db.insert("assistantSteps", { ...step, toolCallId: "search", path: "research/papers:search", input: JSON.stringify({ query: '"machine learning"', minCitations: 11, fromYear: 2020, toYear: 2024, page: 2 }), subject: '"machine learning"' });
      await endStep(ctx, search, { total: 260, page: 2, pages: 13, papers: [] });
      const count = await ctx.db.insert("assistantSteps", { ...step, toolCallId: "count", path: "research/papers:count", input: JSON.stringify({ query: "tutoring", by: "year" }), subject: "tutoring" });
      await endStep(ctx, count, { total: 1840, groups: [{ name: "2024", count: 200 }] });
      await ctx.db.insert("assistantSteps", { ...step, status: "done", endedAt: 1, toolCallId: "collection", path: "library/collections:create", input: JSON.stringify({ name: "Trials" }), subject: "Trials" });
    });

    const steps = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.filter((item) => item.role === "step");
    expect(Object.fromEntries(steps.map((step) => [step.subject, "href" in step ? step.href : null]))).toEqual({
      '"machine learning"': "/results?q=%22machine+learning%22&yf=2020&yt=2024&mincite=11",
      tutoring: "/results?q=tutoring",
      Trials: null,
    });
    expect(Object.fromEntries(steps.map((step) => [step.subject, step.count ?? null]))).toEqual({ '"machine learning"': 260, tutoring: 1840, Trials: null });
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
      contextLength: 200_000,
      supportedParameters: ["tools"],
      isServed: true,
      sortOrder: 0,
      syncedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}
