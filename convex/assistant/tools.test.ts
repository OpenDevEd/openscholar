/// <reference types="vite/client" />
// The assistant's tools (#327): a reply runs registered actions as the person who sent the
// message, each run is kept as a step, and the model reads what came of it.
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { people } from "./assistant.test-support";
import { DEFINITION_MAX, MAX_CALLS, MAX_STEPS, core, definition, found } from "./tools";
import { finishingDoStream, waitFor } from "./turn.test-support";

type Part = { type: string; text?: string; toolCallId?: string; output?: { value?: unknown } };
type Sent = Array<{ role: string; content: string | Part[] }>;

const { mockDoStream, requests, toolsSent, toolChoices, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), requests: [] as unknown[], toolsSent: [] as string[][], toolChoices: [] as string[], fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);

// The model every reply runs on, in place of OpenRouter. It keeps each request it is sent.
vi.mock("../chat/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async () => ({
      model: new MockLanguageModelV3({
        modelId: "mock/model",
        doStream: (async (options: { prompt: unknown; tools?: Array<{ name: string }>; toolChoice?: { type: string } }) => {
          requests.push(structuredClone(options.prompt));
          toolsSent.push((options.tools ?? []).map((sent) => sent.name));
          toolChoices.push(options.toolChoice?.type ?? "auto");
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
  toolChoices.length = 0;
  fetchMock.mockReset();
  fakeAutumn.reset();
  fetchMock.mockImplementation(fakeAutumnFetch());
});

type Test = ReturnType<typeof convexTest>;
const firstPage = { cursor: null, numItems: 20 };

/** A step in which the model calls tools and writes nothing. */
const calling =
  (...calls: Array<{ id: string; name: string; input: unknown; read?: number }>) =>
  async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        for (const call of calls) controller.enqueue({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: JSON.stringify(call.input) });
        // The reason in the shape the model interface defines: with a plain string the SDK runs no tool.
        controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: calls[0]?.read ?? 5, noCache: calls[0]?.read ?? 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } } });
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
  const results = () => t.run(async (ctx) => (await ctx.db.query("assistantStepResults").collect()).map((row) => JSON.parse(row.result)));
  /** The chat as its page lists it, oldest first, a line per item. */
  const shown = async () =>
    (await who.asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page
      .map((item) => ("text" in item ? `${item.role}: ${item.text}` : `step: ${item.action} ${item.status}${item.undone ? ", undone" : item.canUndo ? ", can be undone" : ""}`))
      .reverse();
  return { ...who, threadId, say, steps, results, shown };
}

describe("the assistant's tools", () => {
  it("run an action as the person who sent the message, keep it as a step, and tell the model what came of it", async () => {
    const t = convexTest(schema);
    const { ada, threadId, say, steps, results, shown } = await chatOf(t);
    mockDoStream.mockImplementationOnce(calling({ id: "save", name: "library_mutations_saveToLibrary", input: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } })).mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");

    // The paper is in the sender's library, not anyone else's.
    const [saved] = await t.run(async (ctx) => ctx.db.query("libraryItems").collect());
    expect(saved).toMatchObject({ userId: ada, openalexId: "https://openalex.org/W1" });
    expect(await steps()).toMatchObject([{ threadId, order: 0, userId: ada, toolCallId: "save", path: "library/mutations:saveToLibrary", status: "done", input: expect.stringContaining("Tutoring at scale"), subject: "Tutoring at scale", undo: { path: "library/mutations:removeFromLibrary" } }]);
    // The whole result is kept beside the step, and the model's next request holds it.
    expect(await results()).toMatchObject([{ id: saved._id }]);
    expect(told(1, "save")).toMatchObject({ id: saved._id, undo: { path: "library/mutations:removeFromLibrary" } });
    expect(await shown()).toEqual(["user: Save that paper", "step: library/mutations:saveToLibrary done, can be undone", "assistant: Saved it."]);
  });

  it("reach every other action through a search and a run, and run the undo a change returned the same way", async () => {
    const t = convexTest(schema);
    const { say, steps } = await chatOf(t);
    const collections = () => t.run(async (ctx) => (await ctx.db.query("collections").collect()).map((row) => row.name));
    mockDoStream
      .mockImplementationOnce(calling({ id: "make", name: "library_collections_createCollection", input: { name: "Reading" } }))
      .mockImplementationOnce(finishingDoStream(["Made it."]));
    await say("Make a Reading collection");
    const [made] = await steps();
    expect(await collections()).toEqual(["Reading"]);
    // Renaming has no tool of its own: it's reached by its name.
    const id = JSON.parse(made.undo!.args).collectionId as string;
    mockDoStream
      .mockImplementationOnce(calling({ id: "rename", name: "run_action", input: { name: "library/collections:renameCollection", arguments: { collectionId: id, name: "To read" } } }))
      .mockImplementationOnce(finishingDoStream(["Renamed it."]));
    await say("Call it To read");
    expect(await collections()).toEqual(["To read"]);
    // The step is the action that ran, not the tool that reached it.
    const renamed = (await steps())[1];
    expect(renamed).toMatchObject({ path: "library/collections:renameCollection", status: "done", undo: { path: "library/collections:renameCollection" } });
    expect(told(3, "rename")).toMatchObject({ undo: { path: "library/collections:renameCollection", args: { name: "Reading", expect: "To read" } } });

    // The model runs the undo it was given.
    mockDoStream
      .mockImplementationOnce(calling({ id: "back", name: "run_action", input: { name: renamed.undo!.path, arguments: JSON.parse(renamed.undo!.args) } }))
      .mockImplementationOnce(finishingDoStream(["Undone."]));
    await say("Undo that");
    expect(await collections()).toEqual(["Reading"]);
  });

  it("keep each call apart, though models reuse their call IDs from one message to the next", async () => {
    const t = convexTest(schema);
    const { say, steps } = await chatOf(t);
    for (const [index, name] of ["One", "Two"].entries()) {
      // The same call ID both times, as some providers number their calls from zero in every reply.
      mockDoStream.mockImplementationOnce(calling({ id: "call_0", name: "library_collections_createCollection", input: { name } })).mockImplementationOnce(finishingDoStream(["Made it."]));
      await say(`Make collection ${index}`);
    }
    expect(await t.run(async (ctx) => (await ctx.db.query("collections").collect()).map((row) => row.name).sort())).toEqual(["One", "Two"]);
    expect((await steps()).map((step) => [step.order, step.toolCallId, step.status])).toEqual([[0, "call_0", "done"], [1, "call_0", "done"]]);
  });

  it("don't run an action that asks the person first, one that doesn't exist, one too long to be a tool, or one whose arguments don't fit, and say why", async () => {
    const t = convexTest(schema);
    const { threadId, say, steps } = await chatOf(t);
    mockDoStream
      .mockImplementationOnce(
        calling(
          { id: "delete", name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId } } },
          { id: "missing", name: "run_action", input: { name: "library/mutations:burn", arguments: {} } },
          // Every saved search and shortcut could be cleared through this one, and its arguments run to thousands of tokens.
          { id: "long", name: "run_action", input: { name: "research/records:change", arguments: { command: { kind: "clearSearches" } } } },
          { id: "unfit", name: "run_action", input: { name: "library/collections:renameCollection", arguments: { name: 3 } } },
        ),
      )
      .mockImplementationOnce(finishingDoStream(["I couldn't."]));
    await say("Delete this chat");

    expect(told(1, "delete")).toMatchObject({ error: expect.stringMatching(/asks the person first/) });
    expect(told(1, "missing")).toMatchObject({ error: expect.stringMatching(/No action is named/) });
    expect(told(1, "long")).toMatchObject({ error: expect.stringMatching(/No action is named/) });
    // The arguments the action takes come back with the refusal.
    expect(told(1, "unfit")).toMatchObject({ error: expect.stringMatching(/don't fit/), arguments: { type: "object" } });
    // Nothing ran: the chat is still there, and no step was kept.
    expect(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId))).not.toBeNull();
    expect(await steps()).toEqual([]);
  });

  it("don't change a collection a library follows, which would show outside the account, until they can ask", async () => {
    const t = convexTest(schema);
    const { asAda, say, steps } = await chatOf(t);
    const { id: followed } = await asAda.mutation(api.library.collections.createCollection, { name: "Published" });
    const { id: own } = await asAda.mutation(api.library.collections.createCollection, { name: "Private" });
    // A library that follows the first collection.
    await t.run(async (ctx) => {
      const organizationId = (await ctx.db.query("organizations").first())!._id;
      const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("evidenceLibraryCollectionSources", { libraryId, collectionId: followed, connectedByClerkUserId: "ada", connectedAt: 1 });
    });
    mockDoStream
      .mockImplementationOnce(
        calling(
          { id: "public", name: "library_mutations_setPaperInCollection", input: { paper: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" }, collectionId: followed, inCollection: true } },
          { id: "private", name: "library_mutations_setPaperInCollection", input: { paper: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" }, collectionId: own, inCollection: true } },
        ),
      )
      .mockImplementationOnce(finishingDoStream(["Added it to Private only."]));
    await say("Add it to both");

    expect(told(1, "public")).toMatchObject({ error: expect.stringMatching(/asks the person first/) });
    expect(await steps()).toMatchObject([{ path: "library/mutations:setPaperInCollection", status: "done", input: expect.stringContaining(own) }]);
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").collect()).map((row) => row.collectionId))).toEqual([own]);
  });

  it("ask first where a change would have no undo, and when the check and the change disagree the change itself refuses", async () => {
    const t = convexTest(schema);
    const { ada, asAda, say, steps } = await chatOf(t);
    // The paper already has a rating on search cards, which removing it from the library would clear: saving it has no undo.
    await asAda.mutation(api.research.records.change, { accountId: "ada", requestId: "rated", command: { kind: "rating", paperId: "https://openalex.org/W1", rating: 4 } });
    const { id: followed } = await asAda.mutation(api.library.collections.createCollection, { name: "Published" });
    await t.run(async (ctx) => {
      const organizationId = (await ctx.db.query("organizations").first())!._id;
      const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "ada", updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("evidenceLibraryCollectionSources", { libraryId, collectionId: followed, connectedByClerkUserId: "ada", connectedAt: 1 });
    });
    mockDoStream
      .mockImplementationOnce(
        calling(
          { id: "save", name: "library_mutations_saveToLibrary", input: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } },
          // A library that follows the collection shows its name.
          { id: "rename", name: "run_action", input: { name: "library/collections:renameCollection", arguments: { collectionId: followed, name: "Public reading" } } },
        ),
      )
      .mockImplementationOnce(finishingDoStream(["Those need you."]));
    await say("Save it and rename the collection");
    expect(told(1, "save")).toMatchObject({ error: expect.stringMatching(/asks the person first/) });
    expect(told(1, "rename")).toMatchObject({ error: expect.stringMatching(/asks the person first/) });
    expect(await steps()).toEqual([]);

    // The change holds the same check in its own transaction, for a collection that comes to be followed between the two.
    const add = { userId: ada, paper: { openalexId: "https://openalex.org/W2", title: "Another paper" }, collectionId: followed, inCollection: true };
    await expect(t.mutation(internal.library.mutations.setPaperInCollectionForAssistant, add)).rejects.toThrow(/asks the person first/);
    // The person's own click is their approval.
    await t.mutation(internal.library.mutations.setPaperInCollectionForAssistant, { ...add, approved: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").collect()).length)).toBe(1);
  });

  it("run at most so many actions in one reply, and stop calling tools once the reply has cost what was held for it", async () => {
    const t = convexTest(schema);
    const { say, steps } = await chatOf(t);
    const list = (index: number) => ({ id: `c${index}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } } });
    // One round that calls more actions than a reply may run.
    mockDoStream.mockImplementationOnce(calling(...Array.from({ length: MAX_CALLS + 2 }, (_, index) => list(index)))).mockImplementationOnce(finishingDoStream(["That's all I could run."]));
    await say("Look at everything");
    expect(await steps()).toHaveLength(MAX_CALLS);
    expect(told(1, `c${MAX_CALLS + 1}`)).toMatchObject({ error: expect.stringMatching(/at most/) });

    // A round that read a great deal costs more than the reply's hold: the next request can't call a tool.
    toolChoices.length = 0;
    mockDoStream.mockImplementationOnce(calling({ ...list(0), read: 2_000_000_000 })).mockImplementationOnce(finishingDoStream(["Stopping here."]));
    await say("Look again");
    expect(toolChoices).toEqual(["auto", "none"]);
  });

  it("show a reply that came back with nothing, when it called no tool", async () => {
    const t = convexTest(schema);
    const { say, shown } = await chatOf(t);
    mockDoStream.mockImplementationOnce(finishingDoStream([]));
    await say("Hello");
    expect(await shown()).toEqual(["user: Hello", "assistant: "]);
  });

  it("tell the model why an action failed, keep the failed step, and let the reply go on", async () => {
    const t = convexTest(schema);
    const { asBen, say, steps, shown } = await chatOf(t);
    // A collection that isn't the sender's.
    const { id: theirs } = await asBen.mutation(api.library.collections.createCollection, { name: "Ben's" });
    mockDoStream
      .mockImplementationOnce(calling({ id: "add", name: "library_mutations_setPaperInCollection", input: { paper: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" }, collectionId: theirs, inCollection: true } }))
      .mockImplementationOnce(finishingDoStream(["That collection isn't yours."]));
    await say("Add it to Ben's collection");

    expect(told(1, "add")).toEqual({ error: "Not your collection" });
    expect(await steps()).toMatchObject([{ path: "library/mutations:setPaperInCollection", status: "failed", error: "Not your collection" }]);
    expect(await shown()).toEqual(["user: Add it to Ben's collection", "step: library/mutations:setPaperInCollection failed", "assistant: That collection isn't yours."]);
    expect(await t.run(async (ctx) => ctx.db.query("libraryItems").collect())).toEqual([]);
  });

  it("show a step whose reply died as failed, not as running for ever, and keep the last request of a reply for its answer", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, say, shown } = await chatOf(t);
    // A step whose action is still running, as the page reads it mid-reply.
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Save that paper" }).catch(() => {});
    await t.mutation(internal.assistant.steps.begin, { threadId, order: 0, userId: ada, toolCallId: "save", path: "library/mutations:saveToLibrary", input: "{}" });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 }).catch(() => {});
    // Its reply is over without ending it: the step shows as failed, not as running for ever.
    expect((await shown())[1]).toBe("step: library/mutations:saveToLibrary failed");

    // A reply that keeps calling tools is made to answer on its last request.
    requests.length = 0;
    toolChoices.length = 0;
    mockDoStream.mockReset();
    mockDoStream.mockImplementation(async (options: { toolChoice?: { type: string } }) =>
      options.toolChoice?.type === "none" ? finishingDoStream(["Here is what I did."])() : calling({ id: `c${requests.length}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } } })(),
    );
    await say("Keep going");
    expect(requests).toHaveLength(MAX_STEPS);
    // A step that lists things says how many it found.
    expect((await t.run(async (ctx) => ctx.db.query("assistantSteps").collect())).at(-1)).toMatchObject({ path: "library/collections:listCollections", count: 0 });
    expect(toolChoices.at(-1)).toBe("none");
    expect((await shown()).at(-1)).toBe("assistant: Here is what I did.");
  });

  it("are undone by the person they ran for, once, and by no one else in the chat", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, threadId, say, steps, shown } = await chatOf(t);
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: (await t.run(async (ctx) => (await ctx.db.query("users").collect()).find((user) => user.clerkId === "ben")))!._id }, role: "write" });
    mockDoStream.mockImplementationOnce(calling({ id: "save", name: "library_mutations_saveToLibrary", input: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } })).mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");
    const [step] = await steps();
    const benSees = (await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.find((item) => item.role === "step");
    // Someone else in the chat sees the step, and can't undo it: it changed the sender's library.
    expect(benSees).toMatchObject({ action: "library/mutations:saveToLibrary", canUndo: false });
    await expect(asBen.mutation(api.assistant.undo.run, { threadId, stepId: step._id })).rejects.toThrow(/Only the person/);

    await asAda.mutation(api.assistant.undo.run, { threadId, stepId: step._id });
    expect(await t.run(async (ctx) => ctx.db.query("libraryItems").collect())).toEqual([]);
    expect((await shown())[1]).toBe("step: library/mutations:saveToLibrary done, undone");
    await expect(asAda.mutation(api.assistant.undo.run, { threadId, stepId: step._id })).rejects.toThrow(/nothing left to undo/);
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
    expect(toolsSent[0]).toHaveLength(core().length + 2);
    // About 1,000 tokens at most for a tool's description and arguments (#326).
    for (const entry of core()) expect(JSON.stringify(definition(entry)).length, entry.path).toBeLessThanOrEqual(DEFINITION_MAX);
  });

  it("find actions by what they do, with the arguments they take and whether they ask first", () => {
    const { actions } = found("delete an assistant chat");
    const remove = actions.find((action) => action.name === "assistant/threads:remove");
    expect(remove).toMatchObject({ asksFirst: true, arguments: { type: "object", properties: { threadId: { type: "string" } } } });
    // An action named outright comes first.
    expect(found("library/collections:renameCollection").actions[0]).toMatchObject({ name: "library/collections:renameCollection", arguments: { type: "object" } });
    // One too long to be a tool isn't found.
    expect(found("research/records:change clear every saved search").actions.map((action) => action.name)).not.toContain("research/records:change");
    expect(found("zzzz").actions).toEqual([]);
    // What a search returns stays within what the model reads at once.
    expect(JSON.stringify(found("list count get search collection paper screening extraction")).length).toBeLessThanOrEqual(8_000 + 6 * 60);
  });

  it("go with their chat when it's deleted", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, steps, results } = await chatOf(t);
    mockDoStream.mockImplementationOnce(calling({ id: "save", name: "library_mutations_saveToLibrary", input: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } })).mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");
    expect(await steps()).toHaveLength(1);
    await asAda.mutation(api.assistant.threads.remove, { threadId: threadId as Id<"assistantThreads"> });
    await waitFor(async () => (await steps()).length === 0 && (await results()).length === 0, { timeoutMs: 5_000 });
  });
});
