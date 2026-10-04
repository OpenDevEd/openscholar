/// <reference types="vite/client" />
// The assistant's tools (#327): a reply runs registered actions as the person who sent the
// message, each run is kept as a step, and the model reads what came of it.
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { people } from "./assistant.test-support";
import { z } from "zod";
import { inputSchema } from "../lib/assistantTools";
import { CORE, found } from "./tools";
import { finishingDoStream, waitFor } from "./turn.test-support";

type Part = { type: string; text?: string; toolCallId?: string; output?: { value?: unknown } };
type Sent = Array<{ role: string; content: string | Part[] }>;

const { mockDoStream, requests, toolsSent, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), requests: [] as unknown[], toolsSent: [] as string[][], fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);

// The model every reply runs on, in place of OpenRouter. It keeps each request it is sent.
vi.mock("../chat/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async () => ({
      model: new MockLanguageModelV3({
        modelId: "mock/model",
        doStream: (async (options: { prompt: unknown; tools?: Array<{ name: string }> }) => {
          requests.push(structuredClone(options.prompt));
          toolsSent.push((options.tools ?? []).map((sent) => sent.name));
          return mockDoStream(options);
        }) as never,
      }),
      modelSlug: "mock/model",
      pricing: { input: 1, output: 2 },
    }),
  };
});

beforeEach(() => {
  mockDoStream.mockReset();
  requests.length = 0;
  toolsSent.length = 0;
  fetchMock.mockReset();
  fakeAutumn.reset();
  fetchMock.mockImplementation(fakeAutumnFetch());
});

type Test = ReturnType<typeof convexTest>;
const firstPage = { cursor: null, numItems: 20 };

/** A step in which the model calls tools and writes nothing. */
const calling =
  (...calls: Array<{ id: string; name: string; input: unknown }>) =>
  async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        for (const call of calls) controller.enqueue({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: JSON.stringify(call.input) });
        // The reason in the shape the model interface defines: with a plain string the SDK runs no tool.
        controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } } });
        controller.close();
      },
    }),
  });

/** What the model was told came of a call, from the request that followed it. */
function told(request: number, toolCallId: string) {
  const parts = (requests[request] as Sent).flatMap((message) => (message.role === "tool" && Array.isArray(message.content) ? message.content : []));
  return parts.find((part) => part.type === "tool-result" && part.toolCallId === toolCallId)?.output?.value;
}

async function chatOf(t: Test) {
  const who = await people(t);
  await t.run(async (ctx) => seedCreditsForTest(ctx, { userId: who.ada, free: 100_000 }));
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
  /** Sends a message and waits until its reply is written. */
  const say = async (text: string) => {
    await who.asAda.mutation(api.assistant.replies.send, { threadId, text });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 });
  };
  const steps = () => t.run(async (ctx) => ctx.db.query("assistantSteps").collect());
  /** The chat as its page lists it, oldest first, a line per item. */
  const shown = async () =>
    (await who.asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page
      .map((item) => ("text" in item ? `${item.role}: ${item.text}` : `step: ${item.action} ${item.status}${item.canUndo ? ", can be undone" : ""}`))
      .reverse();
  return { ...who, threadId, say, steps, shown };
}

describe("the assistant's tools", () => {
  it("run an action as the person who sent the message, keep it as a step, and tell the model what came of it", async () => {
    const t = convexTest(schema);
    const { ada, threadId, say, steps, shown } = await chatOf(t);
    mockDoStream
      .mockImplementationOnce(calling({ id: "save", name: "library_mutations_saveToLibrary", input: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } }))
      .mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");

    // The paper is in the sender's library, not anyone else's.
    const [saved] = await t.run(async (ctx) => ctx.db.query("libraryItems").collect());
    expect(saved).toMatchObject({ userId: ada, openalexId: "https://openalex.org/W1" });
    expect(await steps()).toMatchObject([{ threadId, order: 0, toolCallId: "save", path: "library/mutations:saveToLibrary", status: "done", input: expect.stringContaining("Tutoring at scale") }]);
    // The model's next request holds what the action returned.
    expect(told(1, "save")).toBe(saved._id);
    expect(await shown()).toEqual(["user: Save that paper", "step: library/mutations:saveToLibrary done", "assistant: Saved it."]);
  });

  it("reach every other action through a search and a run, keep the undo a change returns, and run that undo the same way", async () => {
    const t = convexTest(schema);
    const { ada, say, steps, shown } = await chatOf(t);
    const ratings = () => t.run(async (ctx) => (await ctx.db.query("paperRatings").collect()).map((row) => ({ userId: row.userId, ...row.data })));
    mockDoStream
      .mockImplementationOnce(calling({ id: "rate", name: "run_action", input: { name: "research/records:change", arguments: { command: { kind: "rating", paperId: "W1", rating: 4 } } } }))
      .mockImplementationOnce(finishingDoStream(["Rated it 4."]));
    await say("Rate W1 four stars");
    expect(await ratings()).toEqual([{ userId: ada, paperId: "W1", rating: 4 }]);
    const [rated] = await steps();
    // The step is the action that ran, not the tool that reached it, and it holds what reverses it.
    expect(rated).toMatchObject({ path: "research/records:change", status: "done", undo: { path: "research/records:change" } });
    expect(told(1, "rate")).toMatchObject({ undo: { path: "research/records:change", args: { command: { kind: "rating", rating: null, expect: 4 } } } });
    expect((await shown())[1]).toBe("step: research/records:change done, can be undone");

    // The model runs the undo it was given, and the rating is gone.
    mockDoStream
      .mockImplementationOnce(calling({ id: "undo", name: "run_action", input: { name: rated.undo!.path, arguments: JSON.parse(rated.undo!.args) } }))
      .mockImplementationOnce(finishingDoStream(["Undone."]));
    await say("Undo that");
    expect(await ratings()).toEqual([]);
  });

  it("don't run an action that asks the person first, one that doesn't exist, or one whose arguments don't fit, and say why", async () => {
    const t = convexTest(schema);
    const { threadId, say, steps } = await chatOf(t);
    mockDoStream
      .mockImplementationOnce(
        calling(
          { id: "delete", name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId } } },
          { id: "missing", name: "run_action", input: { name: "library/mutations:burn", arguments: {} } },
          { id: "unfit", name: "run_action", input: { name: "research/records:change", arguments: { command: { kind: "rating" } } } },
        ),
      )
      .mockImplementationOnce(finishingDoStream(["I couldn't."]));
    await say("Delete this chat");

    expect(told(1, "delete")).toMatchObject({ error: expect.stringMatching(/asks the person first/) });
    expect(told(1, "missing")).toMatchObject({ error: expect.stringMatching(/No action is named/) });
    // The arguments the action takes come back with the refusal.
    expect(told(1, "unfit")).toMatchObject({ error: expect.stringMatching(/don't fit/), arguments: { type: "object" } });
    // Nothing ran: the chat is still there, and no step was kept.
    expect(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId))).not.toBeNull();
    expect(await steps()).toEqual([]);
  });

  it("tell the model why an action failed, keep the failed step, and let the reply go on", async () => {
    const t = convexTest(schema);
    const { asBen, say, steps, shown } = await chatOf(t);
    // A collection that isn't the sender's.
    const theirs = await asBen.mutation(api.library.collections.createCollection, { name: "Ben's" });
    mockDoStream
      .mockImplementationOnce(calling({ id: "add", name: "library_mutations_setPaperInCollection", input: { paper: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" }, collectionId: theirs, inCollection: true } }))
      .mockImplementationOnce(finishingDoStream(["That collection isn't yours."]));
    await say("Add it to Ben's collection");

    expect(told(1, "add")).toEqual({ error: "Not your collection" });
    expect(await steps()).toMatchObject([{ path: "library/mutations:setPaperInCollection", status: "failed", error: "Not your collection" }]);
    expect(await shown()).toEqual(["user: Add it to Ben's collection", "step: library/mutations:setPaperInCollection failed", "assistant: That collection isn't yours."]);
    expect(await t.run(async (ctx) => ctx.db.query("libraryItems").collect())).toEqual([]);
  });

  it("are one fixed list for every chat and person, each tool small enough to keep the list cheap", async () => {
    const t = convexTest(schema);
    const { asBen, ben, say } = await chatOf(t);
    mockDoStream.mockImplementation(finishingDoStream(["Hello."]));
    await say("Hello");
    // Someone else, in a chat of their own.
    await t.run(async (ctx) => seedCreditsForTest(ctx, { userId: ben, free: 100_000 }));
    const other = await asBen.mutation(api.assistant.threads.create, { title: "Another chat" });
    await asBen.mutation(api.assistant.replies.send, { threadId: other, text: "Hello" });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", other)))?.reply, { timeoutMs: 5_000 });

    expect(toolsSent).toHaveLength(2);
    expect(toolsSent[1]).toEqual(toolsSent[0]);
    expect(toolsSent[0].slice(-2)).toEqual(["find_action", "run_action"]);
    expect(toolsSent[0]).toHaveLength(CORE.length + 2);
    // About 1,000 tokens at most for a tool's description and arguments (#326).
    for (const entry of CORE) expect(entry.description.length + JSON.stringify(z.toJSONSchema(inputSchema(entry))).length, entry.path).toBeLessThan(4_000);
  });

  it("find actions by what they do, with the arguments they take and whether they ask first", () => {
    const { actions } = found("delete an assistant chat");
    const remove = actions.find((action) => action.name === "assistant/threads:remove");
    expect(remove).toMatchObject({ asksFirst: true, arguments: { type: "object", properties: { threadId: { type: "string" } } } });
    // An action too long to list beside others is named, and comes whole when it's searched for by name.
    expect(found("rate a paper").actions.find((action) => action.name === "research/records:change")).toMatchObject({ arguments: expect.stringMatching(/by its name/) });
    expect(found("research/records:change").actions[0]).toMatchObject({ name: "research/records:change", arguments: { type: "object" } });
    expect(found("zzzz").actions).toEqual([]);
  });

  it("go with their chat when it's deleted", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, steps } = await chatOf(t);
    mockDoStream
      .mockImplementationOnce(calling({ id: "save", name: "library_mutations_saveToLibrary", input: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } }))
      .mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");
    expect(await steps()).toHaveLength(1);
    await asAda.mutation(api.assistant.threads.remove, { threadId: threadId as Id<"assistantThreads"> });
    await waitFor(async () => (await steps()).length === 0, { timeoutMs: 5_000 });
  });
});
