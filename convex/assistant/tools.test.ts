/// <reference types="vite/client" />
// The assistant's tools (#327): a reply runs registered actions as the person who sent the
// message, each run is kept as a step, and the model reads what came of it.
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listMessages, saveMessages } from "@convex-dev/agent";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { inputSchema } from "../lib/assistantTools";
import { ASSISTANT_REPLIES_AT_ONCE } from "../lib/constants";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { people } from "./assistant.test-support";
import { detailsOf } from "./details";
import { MAX_ASKS, MODEL_READS, STEPS_SHOWN, forModel } from "./steps";
import { DEFINITION_MAX, MAX_FAILED_ROUNDS, circling, core, definition, found, written } from "./tools";
import { callingDoStream as calling, finishingDoStream, hangingDoStream, waitFor } from "./turn.test-support";

type Part = { type: string; text?: string; toolCallId?: string; output?: { type?: string; value?: unknown } };
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

/** What the model was told came of a call, whole, from the request that followed it. */
function outcome(request: number, toolCallId: string) {
  const parts = (requests[request] as Sent).flatMap((message) => (message.role === "tool" && Array.isArray(message.content) ? message.content : []));
  return parts.find((part) => part.type === "tool-result" && part.toolCallId === toolCallId)?.output;
}
/** The same, as the value a call returned. */
const told = (request: number, toolCallId: string) => outcome(request, toolCallId)?.value;

async function chatOf(t: Test) {
  const who = await people(t);
  await t.run(async (ctx) => seedCreditsForTest(ctx, { userId: who.ada, free: 100_000 }));
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
  /** Sends a message and waits until its reply is written. */
  const say = async (text: string) => {
    await who.asAda.mutation(api.assistant.replies.send, { threadId, text });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 });
  };
  const thread = () => t.run(async (ctx) => ctx.db.get("assistantThreads", threadId));
  /** Sends a message and waits until its reply stops to ask the person something. */
  const sayUntilAsked = async (text: string) => {
    await who.asAda.mutation(api.assistant.replies.send, { threadId, text });
    await waitFor(async () => (await thread())?.asking !== undefined, { timeoutMs: 5_000 });
  };
  /** Waits until the chat is free again. */
  const settled = () => waitFor(async () => !(await thread())?.reply && !(await thread())?.asking, { timeoutMs: 5_000 });
  /** Stops the reply being written, or waiting, as the panel does. */
  const stop = async () => who.asAda.mutation(api.assistant.replies.stop, { threadId, attemptId: (await who.asAda.query(api.assistant.replies.live, { threadId }))!.attemptId });
  const steps = () => t.run(async (ctx) => ctx.db.query("assistantSteps").collect());
  const results = () => t.run(async (ctx) => (await ctx.db.query("assistantStepResults").collect()).map((row) => JSON.parse(row.result)));
  /** The chat as its page lists it, oldest first, a line per item. */
  const shown = async () =>
    (await who.asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page
      .map((item) => ("text" in item ? `${item.role}: ${item.text}${item.status === "stopped" ? "(stopped)" : ""}` : `step: ${item.action} ${item.status}${item.undone ? ", undone" : item.canUndo ? ", can be undone" : item.canAnswer ? ", can be answered" : ""}`))
      .reverse();
  return { ...who, threadId, say, sayUntilAsked, settled, stop, thread, steps, results, shown };
}

describe("the assistant's tools", () => {
  it("run an action as the person who sent the message, keep it as a step, and tell the model what came of it", async () => {
    const t = convexTest(schema);
    const { ada, threadId, say, steps, results, shown } = await chatOf(t);
    mockDoStream.mockImplementationOnce(calling({ id: "save", name: "run_action", input: { name: "library/mutations:saveToLibrary", arguments: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } } })).mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");

    // The paper is in the sender's library, not anyone else's.
    const [saved] = await t.run(async (ctx) => ctx.db.query("libraryItems").collect());
    expect(saved).toMatchObject({ userId: ada, openalexId: "https://openalex.org/W1" });
    expect(await steps()).toMatchObject([{ threadId, order: 0, userId: ada, toolCallId: "save", path: "library/mutations:saveToLibrary", status: "done", input: expect.stringContaining("Tutoring at scale"), subject: "Tutoring at scale", undo: { path: "library/mutations:removeFromLibrary" } }]);
    // The whole result is kept beside the step, and the model's next request holds it.
    expect(await results()).toMatchObject([{ id: saved._id }]);
    expect(told(1, "save")).toMatchObject({ id: saved._id, undo: { path: "library/mutations:removeFromLibrary" } });
    expect(await shown()).toEqual(["user: Save that paper", "step: library/mutations:saveToLibrary done, can be undone", "assistant: Saved it."]);
    // The reply made two requests, each an action of its own that holds and settles its own credits.
    expect(await t.run(async (ctx) => (await ctx.db.query("billingUsage").collect()).length)).toBe(2);
    expect(await t.run(async (ctx) => ctx.db.query("billingHolds").collect())).toEqual([]);
  });

  it("run a change that an action makes after reading from outside, with its write ending the step once, undo and all", async () => {
    const t = convexTest(schema);
    const { ada, say, steps, results, shown } = await chatOf(t);
    vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
    const autumn = fakeAutumnFetch();
    // OpenAlex answers for the paper; everything else is the billing service.
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) =>
      String(input).includes("openalex.org") ? new Response(JSON.stringify({ id: "https://openalex.org/W7", display_name: "Tutoring at scale", publication_year: 2021 }), { status: 200 }) : autumn(input as never, init as never),
    );
    mockDoStream.mockImplementationOnce(calling({ id: "save", name: "library_papers_save", input: { id: "W7", rating: null } })).mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");
    vi.unstubAllEnvs();

    const [saved] = await t.run(async (ctx) => ctx.db.query("libraryItems").collect());
    expect(saved).toMatchObject({ userId: ada, openalexId: "https://openalex.org/W7", title: "Tutoring at scale" });
    expect(await steps()).toMatchObject([{ path: "library/papers:save", status: "done", undo: { path: "library/mutations:removeFromLibrary" } }]);
    // One result beside the step: the write ended it, and nothing ended it again.
    expect(await results()).toEqual([expect.objectContaining({ libraryItemId: saved._id, title: "Tutoring at scale" })]);
    expect(await shown()).toEqual(["user: Save that paper", "step: library/papers:save done, can be undone", "assistant: Saved it."]);
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

  it("don't run an action that doesn't exist, or one whose arguments don't fit, and say why", async () => {
    const t = convexTest(schema);
    const { say, steps } = await chatOf(t);
    mockDoStream
      .mockImplementationOnce(
        calling(
          { id: "missing", name: "run_action", input: { name: "library/mutations:burn", arguments: {} } },
          { id: "unfit", name: "run_action", input: { name: "library/collections:renameCollection", arguments: { name: 3 } } },
        ),
      )
      .mockImplementationOnce(finishingDoStream(["I couldn't."]));
    await say("Clear everything");

    expect(told(1, "missing")).toMatchObject({ error: expect.stringMatching(/No action is named/) });
    // The arguments the action takes come back with the refusal.
    expect(told(1, "unfit")).toMatchObject({ error: expect.stringMatching(/don't fit/), arguments: { type: "object" } });
    expect(await steps()).toEqual([]);
  });

  it("ask the person before a change that would show outside the account, and run it once they allow it", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ben, threadId, sayUntilAsked, settled, thread, steps, shown } = await chatOf(t);
    const { id: followed } = await asAda.mutation(api.library.collections.createCollection, { name: "Published" });
    const { id: own } = await asAda.mutation(api.library.collections.createCollection, { name: "Private" });
    // A library that follows the first collection.
    await t.run(async (ctx) => {
      const organizationId = (await ctx.db.query("organizations").first())!._id;
      const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("evidenceLibraryCollectionSources", { libraryId, collectionId: followed, connectedByClerkUserId: "ada", connectedAt: 1 });
    });
    const collected = () => t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").collect()).map((row) => row.collectionId));
    const paper = { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" };
    mockDoStream.mockImplementationOnce(
      calling(
        { id: "public", name: "run_action", input: { name: "library/mutations:setPaperInCollection", arguments: { paper, collectionId: followed, inCollection: true } } },
        { id: "private", name: "run_action", input: { name: "library/mutations:setPaperInCollection", arguments: { paper, collectionId: own, inCollection: true } } },
      ),
    );
    await sayUntilAsked("Add it to both");

    // The one nobody else sees ran at once. The other waits, and the reply holds the chat without running anything.
    expect(await collected()).toEqual([own]);
    expect(await shown()).toEqual(["user: Add it to both", "step: library/mutations:setPaperInCollection done, can be undone", "step: library/mutations:setPaperInCollection asking, can be answered"]);
    expect(requests).toHaveLength(1);
    await expect(asAda.mutation(api.assistant.replies.send, { threadId, text: "And another thing" })).rejects.toThrow(/waiting for an answer/);
    // Ada is shown what it would do, with her own collection by its name.
    const asked = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.find((item) => item.role === "step" && item.status === "asking");
    expect(asked).toMatchObject({ canAnswer: true, details: expect.arrayContaining([{ name: "collection", value: "Published" }, { name: "title", value: "Tutoring at scale" }, { name: "inCollection", value: "true" }]) });
    // It would run with Ada's access, so only she can allow it.
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: ben }, role: "write" });
    const asking = (await steps()).find((step) => step.status === "asking")!;
    await expect(asBen.mutation(api.assistant.replies.answer, { threadId, stepId: asking._id, allow: true })).rejects.toThrow(/Only the person/);
    // He sees that it waits, and nothing of what it would do.
    const seen = (await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.find((item) => item.role === "step" && item.status === "asking");
    expect(seen).toMatchObject({ canAnswer: false });
    expect(seen).not.toHaveProperty("details");

    mockDoStream.mockImplementationOnce(finishingDoStream(["It's in both now."]));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: asking._id, allow: true });
    await settled();
    // It ran, as its own step, and the model read what came of it where its call left off.
    expect(await collected()).toEqual(expect.arrayContaining([own, followed]));
    expect(outcome(1, "public")).toMatchObject({ type: "json" });
    // The reply carries on from one conversation, each message once: the question, the calls, then each call's result.
    expect((requests[1] as Sent).map((message) => (Array.isArray(message.content) ? `${message.role}: ${message.content.map((part) => `${part.type}${part.toolCallId ? ` ${part.toolCallId}` : ""}`).join(", ")}` : message.role))).toEqual([
      "system",
      // What the person wrote, and the app's note after it.
      "user: text, text",
      "assistant: tool-call public, tool-call private",
      "tool: tool-result private, tool-result public",
    ]);
    expect(await shown()).toEqual([
      "user: Add it to both",
      "step: library/mutations:setPaperInCollection done, can be undone",
      "step: library/mutations:setPaperInCollection done, can be undone",
      "assistant: It's in both now.",
    ]);
    expect((await thread())?.reply).toBeUndefined();
    // An answer given twice changes nothing.
    await expect(asAda.mutation(api.assistant.replies.answer, { threadId, stepId: asking._id, allow: true })).rejects.toThrow(/already been answered/);
  });

  it("tell the model a change that returns nothing was made, make again a write that collided, and keep a reply going past arguments the asking check can't read", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, sayUntilAsked, settled, steps, shown } = await chatOf(t);
    // Deleting a collection asks first and returns nothing. Told nothing, a weaker model said the deletion was still waiting for the person.
    const { id: collectionId } = await asAda.mutation(api.library.collections.createCollection, { name: "Empty" });
    mockDoStream.mockImplementationOnce(calling({ id: "delete", name: "run_action", input: { name: "library/collections:deleteCollection", arguments: { collectionId } } }));
    await sayUntilAsked("Delete it");
    const [asking] = await steps();
    mockDoStream.mockImplementationOnce(finishingDoStream(["Deleted."]));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: asking._id, allow: true });
    await settled();
    expect(told(1, "delete")).toEqual({ done: true });
    expect(await shown()).toEqual(["user: Delete it", "step: library/collections:deleteCollection done", "assistant: Deleted."]);

    // Whether a call asks first is read before it runs. Arguments that check can't read aren't a reason to ask: the call goes on to run, and fails there with a message the model reads.
    expect(await t.query(internal.assistant.asking.first, { userId: ada, path: "library/mutations:removeFromLibrary", input: "{}" })).toBe(false);

    // Calls made in one step run together. A write that lost a race for a row changed nothing, and is made again.
    const collision = new Error('Documents read from or written to the "libraryCounts" table changed while this mutation was being run and on every subsequent retry.');
    const write = vi.fn().mockRejectedValueOnce(collision).mockRejectedValueOnce(collision).mockResolvedValueOnce("saved");
    expect(await written(write)).toBe("saved");
    expect(write).toHaveBeenCalledTimes(3);
    const refused = vi.fn().mockRejectedValue(new Error("Not your collection"));
    await expect(written(refused)).rejects.toThrow(/Not your collection/);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("ask about each change that would have no undo, tell the model which the person didn't allow, and carry on once all are answered", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, sayUntilAsked, settled, thread, steps, shown } = await chatOf(t);
    // The paper already has a rating on search cards, which removing it from the library would clear: saving it has no undo.
    await asAda.mutation(api.research.records.change, { accountId: "ada", requestId: "rated", command: { kind: "rating", paperId: "https://openalex.org/W1", rating: 4 } });
    const { id: followed } = await asAda.mutation(api.library.collections.createCollection, { name: "Published" });
    await t.run(async (ctx) => {
      const organizationId = (await ctx.db.query("organizations").first())!._id;
      const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "ada", updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("evidenceLibraryCollectionSources", { libraryId, collectionId: followed, connectedByClerkUserId: "ada", connectedAt: 1 });
    });
    mockDoStream.mockImplementationOnce(
      calling(
        { id: "save", name: "run_action", input: { name: "library/mutations:saveToLibrary", arguments: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } } },
        // A library that follows the collection shows its name.
        { id: "rename", name: "run_action", input: { name: "library/collections:renameCollection", arguments: { collectionId: followed, name: "Public reading" } } },
      ),
    );
    await sayUntilAsked("Save it and rename the collection");
    const [save, rename] = await steps();
    expect([save, rename]).toMatchObject([
      { path: "library/mutations:saveToLibrary", status: "asking", tool: "run_action", subject: "Tutoring at scale" },
      { path: "library/collections:renameCollection", status: "asking", tool: "run_action", subject: "Public reading" },
    ]);

    // The first answer isn't the last, so the reply still waits.
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: rename._id, allow: false });
    expect((await thread())?.asking).toBeDefined();
    // What she declined shows so at once. What she allows doesn't show as running before anything runs.
    expect((await shown()).slice(1)).toEqual(["step: library/mutations:saveToLibrary asking, can be answered", "step: library/collections:renameCollection declined"]);
    mockDoStream.mockImplementationOnce(finishingDoStream(["Saved. The collection keeps its name."]));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: save._id, allow: true });
    await settled();
    expect(outcome(1, "rename")).toMatchObject({ type: "execution-denied" });
    expect(outcome(1, "save")).toMatchObject({ type: "json", value: { id: expect.any(String) } });
    expect(await t.run(async (ctx) => (await ctx.db.get("collections", followed))?.name)).toBe("Published");
    expect(await shown()).toEqual([
      "user: Save it and rename the collection",
      "step: library/mutations:saveToLibrary done",
      "step: library/collections:renameCollection declined",
      "assistant: Saved. The collection keeps its name.",
    ]);

    // The change holds the same check in its own transaction, for a collection that comes to be followed between the two.
    const add = { userId: ada, paper: { openalexId: "https://openalex.org/W2", title: "Another paper" }, collectionId: followed, inCollection: true };
    await expect(t.mutation(internal.library.mutations.setPaperInCollectionForAssistant, add)).rejects.toThrow(/needs the person's say first/);
    // The person's own click is their approval.
    await t.mutation(internal.library.mutations.setPaperInCollectionForAssistant, { ...add, approved: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").collect()).length)).toBe(1);
  });

  it("decline what a reply still asks when it's stopped, and take the next message as usual", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, sayUntilAsked, stop, thread, shown } = await chatOf(t);
    // Deleting a chat can't be undone.
    const other = await asAda.mutation(api.assistant.threads.create, { title: "Old chat" });
    mockDoStream.mockImplementationOnce(calling({ id: "delete", name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId: other } } }));
    await sayUntilAsked("Delete my old chat");
    await stop();

    expect([(await thread())?.reply, (await thread())?.asking]).toEqual([undefined, undefined]);
    expect(await t.run(async (ctx) => ctx.db.get("assistantThreads", other))).not.toBeNull();
    expect(await shown()).toEqual(["user: Delete my old chat", "step: assistant/threads:remove declined", "assistant: (stopped)"]);
    // The call the reply ended on has its answer, so the conversation still reads whole to the model.
    requests.length = 0;
    mockDoStream.mockImplementationOnce(finishingDoStream(["Nothing was deleted."]));
    await say("What happened?");
    expect(outcome(0, "delete")).toMatchObject({ type: "execution-denied" });
    expect((await shown()).at(-1)).toBe("assistant: Nothing was deleted.");
  });

  it("run nothing the person allowed once the reply is stopped, and still give every call its result", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, sayUntilAsked, steps, shown } = await chatOf(t);
    const [first, second] = await Promise.all(["Old chat", "Older chat"].map((title) => asAda.mutation(api.assistant.threads.create, { title })));
    const remove = (id: string, chat: string) => ({ id, name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId: chat } } });
    mockDoStream.mockImplementationOnce(calling(remove("one", first), remove("two", second)));
    await sayUntilAsked("Delete my old chats");
    const [one, two] = await steps();
    // What Stop takes while the reply waits, as another tab of hers holds it.
    const waiting = (await asAda.query(api.assistant.replies.live, { threadId }))!.attemptId;
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: one._id, allow: true });
    // The last answer starts the reply again. Stop, pressed on the waiting reply, arrives just after it: it stops the reply all the same.
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: two._id, allow: true });
    await asAda.mutation(api.assistant.replies.stop, { threadId, attemptId: waiting });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 });

    // Neither chat was deleted, and both calls show as not run.
    expect(await t.run(async (ctx) => Promise.all([first, second].map((id) => ctx.db.get("assistantThreads", id))))).not.toContain(null);
    expect(await shown()).toEqual(["user: Delete my old chats", "step: assistant/threads:remove declined", "step: assistant/threads:remove declined", "assistant: (stopped)"]);
    // The next message reads a conversation where each call has its answer.
    requests.length = 0;
    mockDoStream.mockImplementationOnce(finishingDoStream(["Nothing was deleted."]));
    await say("What happened?");
    expect([outcome(0, "one"), outcome(0, "two")]).toMatchObject([{ type: "execution-denied" }, { type: "execution-denied" }]);
  });

  it("hold a reply that carries on to how many a person has at once, and tell the model when a call it asked about was cut off mid-run", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, sayUntilAsked, steps, thread } = await chatOf(t);
    const others = await Promise.all(Array.from({ length: ASSISTANT_REPLIES_AT_ONCE }, (_, index) => asAda.mutation(api.assistant.threads.create, { title: `Chat ${index + 2}` })));
    const old = await asAda.mutation(api.assistant.threads.create, { title: "Old chat" });
    mockDoStream.mockImplementationOnce(calling({ id: "delete", name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId: old } } }));
    await sayUntilAsked("Delete my old chat");
    const [asked] = await steps();

    // As many replies of hers as one person has at once are being written elsewhere. Waiting isn't one of them, but carrying on would be one more.
    mockDoStream.mockImplementation(hangingDoStream());
    for (const id of others) await asAda.mutation(api.assistant.replies.send, { threadId: id, text: "Go" });
    await expect(asAda.mutation(api.assistant.replies.answer, { threadId, stepId: asked._id, allow: true })).rejects.toThrow(new RegExp(`already writing ${ASSISTANT_REPLIES_AT_ONCE} replies`));
    expect((await steps())[0].status).toBe("asking");
    for (const id of others) {
      await asAda.mutation(api.assistant.replies.stop, { threadId: id, attemptId: (await t.run(async (ctx) => ctx.db.get("assistantThreads", id)))!.reply!.attemptId });
      await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", id)))?.reply, { timeoutMs: 5_000 });
    }

    // A reply that died after it started the call, as its lock's sweep would leave it: the step still running, the chat free.
    await t.run(async (ctx) => {
      await ctx.db.patch("assistantSteps", asked._id, { status: "running" });
      await ctx.db.patch("assistantThreads", threadId, { asking: undefined });
    });
    requests.length = 0;
    mockDoStream.mockReset();
    mockDoStream.mockImplementationOnce(finishingDoStream(["It may have been deleted. I'd check."]));
    await say("Did that work?");
    expect(outcome(0, "delete")).toMatchObject({ type: "json", value: { error: expect.stringMatching(/may or may not have finished/) } });
    expect((await steps())[0]).toMatchObject({ status: "failed" });
    expect((await thread())?.asking).toBeUndefined();
  });

  it("give a call its result from the conversation itself, when its reply died before recording that it asked", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, sayUntilAsked, steps } = await chatOf(t);
    const other = await asAda.mutation(api.assistant.threads.create, { title: "Old chat" });
    // The model names both rounds' calls alike, as some do: the first has its result, the second doesn't.
    mockDoStream
      .mockImplementationOnce(calling({ id: "delete", name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } } }))
      .mockImplementationOnce(calling({ id: "delete", name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId: other } } }));
    await sayUntilAsked("Delete my old chat");
    // The call is saved with the reply's message. A reply that dies right then leaves no step for it and holds nothing.
    await t.run(async (ctx) => {
      for (const step of await ctx.db.query("assistantSteps").collect()) await ctx.db.delete("assistantSteps", step._id);
      await ctx.db.patch("assistantThreads", threadId, { asking: undefined });
    });
    requests.length = 0;
    mockDoStream.mockImplementationOnce(finishingDoStream(["It wasn't deleted."]));
    await say("Did that work?");
    // Both calls have a result now: the list it read, and that the deletion was never run.
    const outcomes = (requests[0] as Sent).flatMap((message) => (message.role === "tool" && Array.isArray(message.content) ? message.content : [])).filter((part) => part.toolCallId === "delete").map((part) => part.output?.type);
    expect(outcomes).toEqual(["json", "execution-denied"]);
    expect(await steps()).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.get("assistantThreads", other))).not.toBeNull();
  });

  it("show the person what a call acts on and what it changes before anything else about it", async () => {
    const t = convexTest(schema);
    const { ada, asAda } = await chatOf(t);
    const { id: collectionId } = await asAda.mutation(api.library.collections.createCollection, { name: "Trials" });
    const paper = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`field${index}`, `value ${index}`]));
    const details = await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ paper, collectionId, inCollection: false, note: null })));
    // The call's own arguments lead, a value taken off is said, and the paper's fields fill what's left.
    expect(details.slice(0, 3)).toEqual([{ name: "collection", value: "Trials" }, { name: "inCollection", value: "false" }, { name: "note", value: "null" }]);
    expect(details).toHaveLength(12);
    // A collection that isn't hers stays an ID.
    const theirs = await t.run(async (ctx) => ctx.db.insert("collections", { ...(await ctx.db.get("collections", collectionId))!, _id: undefined, _creationTime: undefined, userId: (await ctx.db.query("users").collect()).find((user) => user._id !== ada)!._id, name: "Private to someone else" } as never));
    expect(await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ collectionId: theirs })))).toEqual([{ name: "collection", value: theirs }]);
  });

  it("carry a reply on through a pause, for as many requests as its work takes", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, sayUntilAsked, settled, steps, thread } = await chatOf(t);
    const other = await asAda.mutation(api.assistant.threads.create, { title: "Old chat" });
    // No three calls in a row alike: the same call a third time running isn't run.
    const list = () => ({ id: `c${requests.length}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: (requests.length % 3) + 1 } } });
    // More rounds of reading than a reply was once held to, then a round that asks.
    const before = 30;
    mockDoStream.mockImplementation(async () => (requests.length < before ? calling(list())() : calling({ id: "delete", name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId: other } } })()));
    await sayUntilAsked("Read around, then delete my old chat");
    expect((await thread())?.asking).toMatchObject({ rounds: before, made: before });
    expect((await steps()).filter((step) => step.status === "done")).toHaveLength(before - 1);

    // Carrying on, it reads some more, and answers when it's done. No request is made its answer for it.
    toolChoices.length = 0;
    mockDoStream.mockImplementation(async () => (requests.length < before + 4 ? calling(list())() : finishingDoStream(["Deleted, and read the rest."])()));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: (await steps()).find((step) => step.status === "asking")!._id, allow: true });
    await settled();
    expect(requests).toHaveLength(before + 4);
    expect(toolChoices).toEqual(["auto", "auto", "auto", "auto"]);
    expect(await t.run(async (ctx) => ctx.db.get("assistantThreads", other))).toBeNull();
  });

  it("claim a step the person allowed only for the reply that carries on, and not once that reply is stopped", async () => {
    const t = convexTest(schema);
    const { ada, threadId } = await chatOf(t);
    const { stepId, reply } = await t.run(async (ctx) => {
      const scheduledId = await ctx.scheduler.runAfter(60 * 60 * 1000, internal.assistant.replies.sweep, {});
      const reply = { attemptId: "carrying-on", senderId: ada, order: 0, startedAt: 1, scheduledId };
      await ctx.db.patch("assistantThreads", threadId, { reply });
      return { reply, stepId: await ctx.db.insert("assistantSteps", { threadId, order: 0, userId: ada, toolCallId: "call", tool: "run_action", prompt: "message", path: "assistant/threads:remove", input: "{}", status: "allowed", startedAt: 1 }) };
    });
    // Another reply's attempt can't take it, and neither can this one once it's stopped.
    expect(await t.mutation(internal.assistant.steps.resume, { stepId, attemptId: "another" })).toBe(false);
    await t.run(async (ctx) => ctx.db.patch("assistantThreads", threadId, { reply: { ...reply, stop: true } }));
    expect(await t.mutation(internal.assistant.steps.resume, { stepId, attemptId: "carrying-on" })).toBe(false);
    await t.run(async (ctx) => ctx.db.patch("assistantThreads", threadId, { reply }));
    // It's taken once.
    expect(await t.mutation(internal.assistant.steps.resume, { stepId, attemptId: "carrying-on" })).toBe(true);
    expect(await t.mutation(internal.assistant.steps.resume, { stepId, attemptId: "carrying-on" })).toBe(false);
    await t.run(async (ctx) => ctx.scheduler.cancel(reply.scheduledId));
  });

  it("ask about a few actions at a time, and carry on from the answers with the person's credits still to spend", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, sayUntilAsked, settled, steps, thread } = await chatOf(t);
    const chats = await Promise.all(Array.from({ length: MAX_ASKS + 1 }, (_, index) => asAda.mutation(api.assistant.threads.create, { title: `Chat ${index}` })));
    // One round that asks about more than a person would read. Its request reads enough to cost more than one request holds.
    mockDoStream.mockImplementationOnce(calling(...chats.map((chat, index) => ({ id: `rename${index}`, name: "run_action", input: { name: "assistant/threads:rename", arguments: { threadId: chat, title: `Renamed ${index}` } }, ...(index ? {} : { read: 100_000 }) }))));
    await sayUntilAsked("Rename them all");
    const asked = await steps();
    expect(asked).toHaveLength(MAX_ASKS);
    // What the reply has used so far waits with it.
    expect((await thread())?.asking).toMatchObject({ rounds: 1, spent: expect.any(Number) });
    expect((await thread())!.asking!.spent).toBeGreaterThan(1_000);

    // Carrying on, the last call is already answered: it was refused, since it wasn't asked about.
    mockDoStream.mockImplementationOnce(calling({ id: "more", name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } } })).mockImplementationOnce(finishingDoStream(["Ten renamed."]));
    for (const step of asked) await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: step._id, allow: true });
    await settled();
    expect(outcome(1, `rename${MAX_ASKS}`)).toMatchObject({ type: "execution-denied" });
    expect(await t.run(async (ctx) => (await ctx.db.get("assistantThreads", chats[0]))?.title)).toBe("Renamed 0");
    expect(await t.run(async (ctx) => (await ctx.db.get("assistantThreads", chats[MAX_ASKS]))?.title)).toBe(`Chat ${MAX_ASKS}`);
    // What the reply had cost before it asked holds nothing back: what it calls next runs.
    expect(told(2, "more")).toMatchObject({ page: [] });
  });

  it("run as many actions as a reply's work takes, and go on past what one request holds", async () => {
    const t = convexTest(schema);
    const { say, steps, shown } = await chatOf(t);
    const list = (index: number, read?: number) => ({ id: `c${index}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: (index % 3) + 1 } }, ...(read ? { read } : {}) });
    // More actions in one round than a reply was once held to in all: every one of them runs.
    mockDoStream.mockImplementationOnce(calling(...Array.from({ length: 120 }, (_, index) => list(index)))).mockImplementationOnce(finishingDoStream(["Looked at all of it."]));
    await say("Look at everything");
    expect((await steps()).filter((step) => step.status === "done")).toHaveLength(120);

    // A round that read a great deal costs about 2,000 credits, twice what a request holds. The person has many
    // more, so the action called next runs, and no request is made the reply's answer for it.
    requests.length = 0;
    toolChoices.length = 0;
    mockDoStream.mockImplementationOnce(calling(list(1_000, 150_000))).mockImplementationOnce(calling(list(1_001))).mockImplementationOnce(finishingDoStream(["Done."]));
    await say("Look again");
    expect(told(2, "c1001")).toMatchObject({ page: [] });
    expect(toolChoices).toEqual(["auto", "auto", "auto"]);
    expect((await shown()).at(-1)).toBe("assistant: Done.");
    // Each request settled what it cost, and nothing is left held.
    expect(await t.run(async (ctx) => ctx.db.query("billingHolds").collect())).toEqual([]);
  });

  it("go on to a reply's next request on what the person has left, send back only calls that ran, and keep what a request read when the next one fails", async () => {
    const t = convexTest(schema);
    const { asBen, ben, steps } = await chatOf(t);
    const list = (id: string, read?: number) => ({ id, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } }, ...(read ? { read } : {}) });
    const chat = async (free: number) => {
      await t.run(async (ctx) => {
        const account = await ctx.db.query("billingAccounts").withIndex("by_user", (q) => q.eq("userId", ben)).unique();
        if (account) await ctx.db.delete("billingAccounts", account._id);
        await seedCreditsForTest(ctx, { userId: ben, free });
      });
      const threadId = await asBen.mutation(api.assistant.threads.create, { title: `Chat with ${free}` });
      const say = async (text: string) => {
        await asBen.mutation(api.assistant.replies.send, { threadId, text });
        await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 });
      };
      const newest = async () => (await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page[0];
      return { threadId, say, newest };
    };

    // 500 credits. The first request costs about 350 of them and runs an action. The least a reply starts on is 200,
    // more than is left, but the reply is under way: it holds what there is, and answers.
    const small = await chat(500);
    mockDoStream.mockImplementationOnce(calling(list("first", 27_000))).mockImplementationOnce(finishingDoStream(["Nothing there."]));
    await small.say("What collections do I have?");
    expect(await small.newest()).toMatchObject({ role: "assistant", text: "Nothing there.", status: "done" });

    // A request the provider cut short at its length names a call that never ran. Nothing is sent back for it: the reply ends there.
    const cut = await chat(100_000);
    mockDoStream.mockReset();
    mockDoStream.mockImplementationOnce(async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "tool-call", toolCallId: "never", toolName: "library_collections_listCollections", input: JSON.stringify({ paginationOpts: { cursor: null, numItems: 5 } }) });
          controller.enqueue({ type: "finish", finishReason: { unified: "length", raw: "length" }, usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } } });
          controller.close();
        },
      }),
    }));
    const before = (await steps()).length;
    await cut.say("List them");
    expect(mockDoStream).toHaveBeenCalledTimes(1);
    expect(await steps()).toHaveLength(before);

    // A request that read a great deal, then one the provider refuses: the conversation is still as long as the first found it, and its summary is owed.
    const long = await chat(100_000);
    mockDoStream.mockReset();
    mockDoStream.mockImplementationOnce(calling(list("big", 60_000))).mockImplementationOnce(async () => {
      throw Object.assign(new Error("Too many requests"), { statusCode: 429 });
    });
    await long.say("Look at everything");
    expect(await long.newest()).toMatchObject({ role: "assistant", status: "failed" });
    expect((await t.run(async (ctx) => ctx.db.get("assistantThreads", long.threadId)))?.compactionOwed).toBe(true);
  });

  it("hold what the person has when that's less than a reply may cost, so a small balance still gets an answer", async () => {
    const t = convexTest(schema);
    const { asBen, ben } = await chatOf(t);
    // What a new free account starts with: half of what a reply may cost.
    await t.run(async (ctx) => seedCreditsForTest(ctx, { userId: ben, free: 500 }));
    const threadId = await asBen.mutation(api.assistant.threads.create, { title: "First chat" });
    mockDoStream.mockImplementationOnce(finishingDoStream(["Here."]));
    await asBen.mutation(api.assistant.replies.send, { threadId, text: "Hello" });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 });
    const { page } = await asBen.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage });
    expect(page[0]).toMatchObject({ role: "assistant", text: "Here.", status: "done" });

    // He tops up. The account's copy of his balance hasn't heard yet, and the reply reads the real one:
    // a first request that costs more than his old balance doesn't stop its actions.
    fakeAutumn.setBalance(ben, { free: 5_000, paid: 0 });
    requests.length = 0;
    const list = (id: string, read?: number) => ({ id, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } }, ...(read ? { read } : {}) });
    mockDoStream.mockImplementationOnce(calling(list("first", 50_000))).mockImplementationOnce(calling(list("second"))).mockImplementationOnce(finishingDoStream(["Both read."]));
    await asBen.mutation(api.assistant.replies.send, { threadId, text: "Read my collections twice" });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 });
    expect(told(2, "second")).toMatchObject({ page: [] });
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
      .mockImplementationOnce(calling({ id: "add", name: "run_action", input: { name: "library/mutations:setPaperInCollection", arguments: { paper: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" }, collectionId: theirs, inCollection: true } } }))
      .mockImplementationOnce(finishingDoStream(["That collection isn't yours."]));
    await say("Add it to Ben's collection");

    expect(told(1, "add")).toEqual({ error: "Not your collection" });
    expect(await steps()).toMatchObject([{ path: "library/mutations:setPaperInCollection", status: "failed", error: "Not your collection" }]);
    expect(await shown()).toEqual(["user: Add it to Ben's collection", "step: library/mutations:setPaperInCollection failed", "assistant: That collection isn't yours."]);
    expect(await t.run(async (ctx) => ctx.db.query("libraryItems").collect())).toEqual([]);
  });

  it("show a step whose reply died as failed, not as running for ever, and stop a reply that goes round in circles", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, say, shown } = await chatOf(t);
    // A step whose action is still running, as the page reads it mid-reply.
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Save that paper" }).catch(() => {});
    await t.mutation(internal.assistant.steps.begin, { threadId, order: 0, userId: ada, toolCallId: "save", path: "library/mutations:saveToLibrary", input: "{}" });
    await waitFor(async () => !(await t.run(async (ctx) => ctx.db.get("assistantThreads", threadId)))?.reply, { timeoutMs: 5_000 }).catch(() => {});
    // Its reply is over without ending it: the step shows as failed, not as running for ever.
    expect((await shown())[1]).toBe("step: library/mutations:saveToLibrary failed");

    // A reply whose every action fails, request after request, is told so after so many of them: its actions are
    // refused with the reason. One that calls an action again gets a request that is its answer.
    requests.length = 0;
    toolChoices.length = 0;
    mockDoStream.mockReset();
    const missing = () => calling({ id: `c${requests.length}`, name: "run_action", input: { name: `no/such:action${requests.length}`, arguments: {} } })();
    mockDoStream.mockImplementation(async (options: { toolChoice?: { type: string } }) => (options.toolChoice?.type === "none" ? finishingDoStream(["I couldn't find a way to do that."])() : missing()));
    await say("Keep going");
    expect(toolChoices).toEqual([...Array.from({ length: MAX_FAILED_ROUNDS + 1 }, () => "auto"), "none"]);
    expect(told(MAX_FAILED_ROUNDS + 1, `c${MAX_FAILED_ROUNDS + 1}`)).toMatchObject({ error: expect.stringMatching(/Every action in your last/) });
    expect((await shown()).at(-1)).toBe("assistant: I couldn't find a way to do that.");

    // A model that calls an action in that request all the same gets it refused, and the reply ends there.
    requests.length = 0;
    mockDoStream.mockReset();
    mockDoStream.mockImplementation(async () => missing());
    await say("And again");
    expect(requests).toHaveLength(MAX_FAILED_ROUNDS + 2);

    // Three requests running that make the same call and get the same result: the reply is going round in
    // circles. A fourth identical call isn't run, and the model is told why. The request after is its answer.
    requests.length = 0;
    toolChoices.length = 0;
    mockDoStream.mockReset();
    const same = () => calling({ id: `same${requests.length}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } } })();
    mockDoStream.mockImplementation(async (options: { toolChoice?: { type: string } }) => (options.toolChoice?.type === "none" ? finishingDoStream(["You have no collections."])() : same()));
    await say("Look, and look again");
    expect(toolChoices).toEqual(["auto", "auto", "auto", "auto", "none"]);
    expect(told(4, "same4")).toMatchObject({ error: expect.stringMatching(/same thing over again/) });
    expect((await shown()).at(-1)).toBe("assistant: You have no collections.");
    // A step that lists things says how many it found.
    expect((await t.run(async (ctx) => ctx.db.query("assistantSteps").collect())).at(-1)).toMatchObject({ path: "library/collections:listCollections", status: "done", count: 0 });

    // Two requests that take turns, three times over, are the same thing.
    expect(circling(["a", "b", "a", "b", "a", "b"])).toBe(true);
    // A read whose result changes, such as a job's progress, is never a circle, and neither is work that varies.
    expect(circling(["a", "a", "b"])).toBe(false);
    expect(circling(["a", "b", "c", "a", "b", "c"])).toBe(false);
    expect(circling(["a", "b", "a", "b"])).toBe(false);
  });

  it("stop asking the person for the same thing once they have declined it three times", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, sayUntilAsked, settled, steps, shown, thread } = await chatOf(t);
    const other = await asAda.mutation(api.assistant.threads.create, { title: "Old chat" });
    const remove = () => calling({ id: `remove${requests.length}`, name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId: other } } })();
    mockDoStream.mockImplementation(async (options: { toolChoice?: { type: string } }) => (options.toolChoice?.type === "none" ? finishingDoStream(["I'll leave it."])() : remove()));
    await sayUntilAsked("Delete my old chat");
    // Declined, and asked again, three times over.
    for (let round = 0; round < 3; round++) {
      const waiting = (await steps()).find((step) => step.status === "asking")!;
      await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: waiting._id, allow: false });
      if (round < 2) await waitFor(async () => (await steps()).some((step) => step.status === "asking"), { timeoutMs: 5_000 });
    }
    await settled();
    // The fourth time it isn't asked: the model is told it's going round in circles, and the reply ends with its answer.
    expect((await steps()).filter((step) => step.status === "declined")).toHaveLength(3);
    expect((await thread())?.asking).toBeUndefined();
    expect(told(4, "remove4")).toMatchObject({ error: expect.stringMatching(/same thing over again/) });
    expect((await shown()).at(-1)).toBe("assistant: I'll leave it.");
    expect(await t.run(async (ctx) => ctx.db.get("assistantThreads", other))).not.toBeNull();
  });

  it("list an exchange's newest steps with its messages, and page through the ones before them", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, say } = await chatOf(t);
    mockDoStream.mockImplementationOnce(finishingDoStream(["Done."]));
    await say("Save them all");
    // More changes than one page lists, as a reply with no cap on its actions can make.
    const total = STEPS_SHOWN + 30;
    await t.run(async (ctx) => {
      for (let index = 0; index < total; index++) {
        await ctx.db.insert("assistantSteps", { threadId, order: 0, userId: ada, toolCallId: `call${index}`, path: "library/mutations:saveToLibrary", input: "{}", subject: `Paper ${index}`, status: "done", undo: { path: "library/mutations:removeFromLibrary", args: "{}" }, startedAt: index, endedAt: index });
      }
    });
    const withMessages = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.flatMap((item) => (item.role === "step" ? [item] : []));
    // Newest first, like the page: the last one made is listed first, and the first thirty aren't among them.
    expect(withMessages).toHaveLength(STEPS_SHOWN);
    expect(withMessages[0].subject).toBe(`Paper ${total - 1}`);
    // The ones before them are read a page at a time, each with its Undo.
    const first = await asAda.query(api.assistant.replies.steps, { threadId, order: 0, paginationOpts: { cursor: null, numItems: STEPS_SHOWN } });
    const rest = await asAda.query(api.assistant.replies.steps, { threadId, order: 0, paginationOpts: { cursor: first.continueCursor, numItems: STEPS_SHOWN } });
    expect(first.page.map((step) => step.id)).toEqual(withMessages.map((step) => step.id));
    expect(rest.page).toHaveLength(30);
    expect(rest.page.at(-1)).toMatchObject({ subject: "Paper 0", canUndo: true });
    expect(rest.isDone).toBe(true);
  });

  it("read a reply's steps through the exchanges it carried on in, and say which of its messages ran actions too", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, say, thread } = await chatOf(t);
    mockDoStream.mockImplementationOnce(finishingDoStream(["All saved."]));
    await say("Save them all");
    const agentThreadId = (await thread())!.agentThreadId;
    await t.run(async (ctx) => {
      // A reply that was summarized partway carried on in the two exchanges after its own.
      for (const [order, calls] of [[0, 2], [1, 3], [2, 1]] as const) {
        for (let index = 0; index < calls; index++) await ctx.db.insert("assistantSteps", { threadId, order, userId: ada, toolCallId: `call${order}.${index}`, path: "library/mutations:saveToLibrary", input: "{}", subject: `Paper ${order}.${index}`, status: "done", startedAt: index, endedAt: index });
      }
      // One of its requests said something and called an action.
      const prompt = (await listMessages(ctx, components.agent, { threadId: agentThreadId, paginationOpts: { cursor: null, numItems: 10 } })).page.find((doc) => doc.message?.role === "user")!;
      await saveMessages(ctx, components.agent, {
        threadId: agentThreadId,
        promptMessageId: prompt._id,
        messages: [{ role: "assistant", content: [{ type: "text", text: "Saving the first two." }, { type: "tool-call", toolCallId: "call0.0", toolName: "run_action", input: {} }] }],
      });
    });
    const read = async (range: { order: number; through?: number }) => (await asAda.query(api.assistant.replies.steps, { threadId, ...range, paginationOpts: { cursor: null, numItems: STEPS_SHOWN } })).page.map((step) => step.subject);
    expect(await read({ order: 0 })).toEqual(["Paper 0.1", "Paper 0.0"]);
    expect(await read({ order: 0, through: 1 })).toEqual(["Paper 1.2", "Paper 1.1", "Paper 1.0", "Paper 0.1", "Paper 0.0"]);
    // The message that called an action isn't the reply's last, and the page says so; its answer is.
    const said = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.flatMap((item) => (item.role === "assistant" ? [[item.text, item.acted === true]] : []));
    expect(said).toEqual([["Saving the first two.", true], ["All saved.", false]]);
  });

  it("give a call left without a result its result, however long the reply it's in ran", async () => {
    const t = convexTest(schema);
    const { say, shown, thread } = await chatOf(t);
    mockDoStream.mockImplementationOnce(finishingDoStream(["On it."]));
    await say("Read a great deal");
    // A long reply's exchange, as its requests left it: more rounds of calls and results than the repair reads,
    // then a request the provider cut short, whose call never ran.
    const agentThreadId = (await thread())!.agentThreadId;
    await t.run(async (ctx) => {
      const prompt = (await listMessages(ctx, components.agent, { threadId: agentThreadId, paginationOpts: { cursor: null, numItems: 10 } })).page.find((doc) => doc.message?.role === "user")!;
      const call = (id: string) => ({ role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId: id, toolName: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } } }] });
      const result = (id: string) => ({ role: "tool" as const, content: [{ type: "tool-result" as const, toolCallId: id, toolName: "library_collections_listCollections", output: { type: "json" as const, value: { page: [] } } }] });
      for (let round = 0; round < 45; round++) await saveMessages(ctx, components.agent, { threadId: agentThreadId, promptMessageId: prompt._id, messages: [call(`c${round}`), result(`c${round}`)] });
      await saveMessages(ctx, components.agent, { threadId: agentThreadId, promptMessageId: prompt._id, messages: [call("never")] });
    });
    // The next message is still answered: the call has its result, though the exchange's first message is far behind the ones read.
    requests.length = 0;
    mockDoStream.mockImplementationOnce(finishingDoStream(["Here you are."]));
    await say("And now?");
    expect(outcome(0, "never")).toMatchObject({ type: "execution-denied" });
    expect((await shown()).at(-1)).toBe("assistant: Here you are.");
  });

  it("hold what the person really has when the account's copy of the balance is behind a charge", async () => {
    const t = convexTest(schema);
    const { ada, say } = await chatOf(t);
    // The account's copy says 1,500 credits. The billing service has 900: a charge was just made.
    await t.run(async (ctx) => {
      fakeAutumn.setBalance(ada, { free: 900, paid: 0 });
      const account = await ctx.db.query("billingAccounts").withIndex("by_user", (q) => q.eq("userId", ada)).unique();
      await ctx.db.patch("billingAccounts", account!._id, { balance: 1_500 });
    });
    let held: number[] = [];
    mockDoStream.mockImplementationOnce(async () => {
      held = await t.run(async (ctx) => (await ctx.db.query("billingHolds").collect()).map((row) => row.credits));
      return finishingDoStream(["Here."])();
    });
    await say("Hello");
    // A hold of 1,000 was refused, so the request held the 900 there are, and went ahead.
    expect(held).toEqual([900]);
  });

  it("are undone by the person they ran for, once, and by no one else in the chat", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, threadId, say, steps, shown } = await chatOf(t);
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: (await t.run(async (ctx) => (await ctx.db.query("users").collect()).find((user) => user.clerkId === "ben")))!._id }, role: "write" });
    mockDoStream.mockImplementationOnce(calling({ id: "save", name: "run_action", input: { name: "library/mutations:saveToLibrary", arguments: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } } })).mockImplementationOnce(finishingDoStream(["Saved it."]));
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

  it("return nothing Convex can't keep: no field of an action's definition is named with a dollar sign or an underscore", () => {
    // A tool's result is saved with the reply as it streams. A field named like that fails the save, which ends the reply.
    const reserved = (value: unknown, path = ""): string[] =>
      !value || typeof value !== "object" ? [] : Object.entries(value).flatMap(([key, inner]) => [...(/^[$_]/.test(key) ? [path + "." + key] : []), ...reserved(inner, path + "." + key)]);
    expect(USER_ACTIONS.flatMap((entry) => reserved(definition(entry), entry.path))).toEqual([]);
    expect(reserved(found("rename collection share chat delete search"))).toEqual([]);
  });

  it("return nothing nested deeper than Convex keeps: what sits below is given as text", () => {
    // Convex keeps a document sixteen levels deep, and a reply's message holds a tool's result five levels down.
    const KEPT = 16 - 5;
    const depth = (value: unknown): number => (value && typeof value === "object" ? 1 + Math.max(0, ...Object.values(value).map(depth)) : 0);
    // An action whose arguments are lists of objects of lists: looking it up ended the reply.
    const looked = found("country region filter search");
    expect(depth(looked)).toBeGreaterThan(KEPT);
    expect(depth(forModel(looked))).toBeLessThanOrEqual(KEPT);
    // Nothing is lost: the levels below are there as their JSON text.
    const deep = Array.from({ length: 14 }).reduce<unknown>((inner) => ({ inner }), "the bottom");
    const kept = forModel(deep);
    expect(depth(kept)).toBeLessThanOrEqual(KEPT);
    expect(JSON.stringify(kept)).toContain("the bottom");
    // A result that was shallow enough comes back as it was.
    expect(forModel({ page: [{ id: "W1", authors: [{ name: "Ada" }] }] })).toEqual({ page: [{ id: "W1", authors: [{ name: "Ada" }] }] });
  });

  it("ask for a page by how many and where from, and drop the read limits a model fills in with it", () => {
    const listed = USER_ACTIONS.find((entry) => entry.path === "library/collections:listCollections")!;
    // Convex's page options also take limits on what one page reads. Set to 0, as a model that fills in every argument sets them, the read failed.
    const filled = { paginationOpts: { numItems: 50, cursor: null, endCursor: null, id: 0, maximumRowsRead: 0, maximumBytesRead: 0 } };
    expect(inputSchema(listed).parse(filled)).toEqual({ paginationOpts: { numItems: 50, cursor: null } });
    expect(Object.keys((definition(listed).arguments as unknown as { properties: { paginationOpts: { properties: object } } }).properties.paginationOpts.properties)).toEqual(["numItems", "cursor"]);
  });

  it("find actions by what they do, with the arguments they take and whether they ask first", () => {
    const { actions } = found("delete an assistant chat");
    const remove = actions.find((action) => action.name === "assistant/threads:remove");
    expect(remove).toMatchObject({ asksFirst: true, arguments: { type: "object", properties: { threadId: { type: "string" } } } });
    // An action named outright comes first.
    expect(found("library/collections:renameCollection").actions[0]).toMatchObject({ name: "library/collections:renameCollection", arguments: { type: "object" } });
    // One too long to be a tool of its own is found like the rest.
    expect(found("research/records:change clear every saved search").actions.map((action) => action.name)).toContain("research/records:change");
    expect(found("zzzz").actions).toEqual([]);
    // What a search returns stays within what the model reads at once.
    expect(JSON.stringify(found("list count get search collection paper screening extraction")).length).toBeLessThanOrEqual(MODEL_READS + 6 * 60);
  });

  it("go with their chat when it's deleted", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, steps, results } = await chatOf(t);
    mockDoStream.mockImplementationOnce(calling({ id: "save", name: "run_action", input: { name: "library/mutations:saveToLibrary", arguments: { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" } } })).mockImplementationOnce(finishingDoStream(["Saved it."]));
    await say("Save that paper");
    expect(await steps()).toHaveLength(1);
    await asAda.mutation(api.assistant.threads.remove, { threadId: threadId as Id<"assistantThreads"> });
    await waitFor(async () => (await steps()).length === 0 && (await results()).length === 0, { timeoutMs: 5_000 });
  });
});
