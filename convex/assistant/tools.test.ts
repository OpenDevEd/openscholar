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
import { screeningHold } from "../screening/estimate";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { people } from "./assistant.test-support";
import { detailsOf } from "./details";
import { allowAlways, carriedOn, pausedAt } from "./spending";
import { MAX_ASKS, MODEL_READS, STEPS_SHOWN, forModel } from "./steps";
import { BULK_FIRST, DEFINITION_MAX, MAX_FAILED_ROUNDS, askedSteps, batched, circling, core, definition, found, kindOf, written } from "./tools";
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
    // The call named the paper by its ID alone, so the step is about the paper it came back with.
    expect(await steps()).toMatchObject([{ path: "library/papers:save", status: "done", subject: "Tutoring at scale", undo: { path: "library/mutations:removeFromLibrary" } }]);
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

  it("ask once before a change to many records, with the list, run every one when the person allows it, and refuse more than ten of a kind made one by one", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, say, sayUntilAsked, settled, steps } = await chatOf(t);
    const work = (n: number) => ({ openalexId: `https://openalex.org/W${n}`, title: `Trial ${n}` });
    for (let n = 1; n <= 12; n++) await asAda.mutation(api.library.mutations.saveToLibrary, work(n));
    const saved = () => t.run(async (ctx) => (await ctx.db.query("libraryItems").collect()).map((item) => item.title).sort());
    // On a card, a saved paper's ID reads as its title. A title or a name typed to look like an ID stays as typed, and what a call does to a record is always said.
    const said = (args: unknown) => t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify(args)));
    expect(await said({ title: "W1", openalexId: work(1).openalexId })).toEqual([{ name: "title", value: "W1" }, { name: "title", value: "Trial 1" }]);
    expect(await said({ command: { kind: "editSearch", edit: { kind: "clearResponses", paperId: work(1).openalexId } } })).toContainEqual({ name: "kind", value: "clearResponses" });

    // Twelve removals in one call: nothing is removed, and Ada is asked once, with how many and the first of them by title.
    mockDoStream.mockImplementationOnce(
      calling({ id: "all", name: "run_many", input: { name: "library/mutations:removeFromLibrary", each: Array.from({ length: 12 }, (_, i) => ({ openalexId: work(i + 1).openalexId })) } }),
    );
    await sayUntilAsked("Remove everything in my library");
    expect(await saved()).toHaveLength(12);
    const waiting = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.filter((item) => item.role === "step");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ action: "library/mutations:removeFromLibrary", status: "asking", canAnswer: true, batch: 12, each: [1, 2, 3, 4, 5].map((n) => [{ name: "title", value: `Trial ${n}` }]) });

    // Her yes runs every one, each a step of its own that she can undo, and the model reads what all of them came to.
    mockDoStream.mockImplementationOnce(finishingDoStream(["Your library is empty now."]));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: (await steps()).find((step) => step.status === "asking")!._id, allow: true });
    await settled();
    expect(await saved()).toEqual([]);
    const ran = await steps();
    expect(ran.filter((step) => step.batch === undefined && step.status === "done" && step.undo)).toHaveLength(12);
    expect(ran.find((step) => step.batch === 12)).toMatchObject({ status: "done" });
    expect((told(1, "all") as { results: unknown[] }).results).toHaveLength(12);

    // Made one by one, the eleventh change of a kind in a reply is refused, and the model is told to put the rest in one call.
    // The count is the reply's, not one request's: a twelfth in its next request is refused too.
    mockDoStream
      .mockImplementationOnce(calling(...Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, name: "run_action", input: { name: "library/mutations:saveToLibrary", arguments: work(101 + i) } }))))
      .mockImplementationOnce(calling({ id: "later", name: "run_action", input: { name: "library/mutations:saveToLibrary", arguments: work(112) } }))
      .mockImplementationOnce(finishingDoStream(["Saved ten."]));
    await say("Save these twelve");
    expect(await saved()).toHaveLength(10);
    const refused = Array.from({ length: 11 }, (_, i) => told(3, `s${i}`)).filter((value) => (value as { error?: string }).error === BULK_FIRST);
    expect(refused).toHaveLength(1);
    expect(told(4, "later")).toEqual({ error: BULK_FIRST });
    // Changes are counted by what they change, whichever action makes them: a rating set through a save counts with the ratings.
    const action = (path: string) => USER_ACTIONS.find((entry) => entry.path === path)!;
    expect(kindOf(action("library/mutations:setLibraryRating"), {})).toBe(kindOf(action("library/mutations:saveToLibrary"), {}));
    expect(kindOf(action("research/searches:restore"), {})).toBe(kindOf(action("research/records:change"), { command: { kind: "editSearch" } }));
    // A batch is one change made to many records, so its card can say what it does: not two jobs of one action, at any depth.
    const rating = { requestId: "r1", command: { kind: "rating", paperId: "W1", rating: 5 } };
    expect(batched("run_many", { name: "research/records:change", each: [rating, { ...rating, requestId: "r2" }] })).not.toBeNull();
    expect(batched("run_many", { name: "research/records:change", each: [rating, { requestId: "r3", command: { kind: "clearShortcuts" } }] })).toBeNull();
    const edit = (kind: string, more: object) => ({ requestId: kind, command: { kind: "editSearch", id: "s1", edit: { kind, ...more } } });
    expect(batched("run_many", { name: "research/records:change", each: [edit("patch", { fields: { query: "tutoring" }, clear: [] }), edit("clearResponses", { paperId: "W1" })] })).toBeNull();
    // A batch of one is that one change, asked about as it would be alone.
    const [one] = askedSteps([{ toolCallId: "one", toolName: "run_many", input: { name: "library/mutations:removeFromLibrary", each: [{ openalexId: work(1).openalexId }] } }]);
    expect(one).toMatchObject({ path: "library/mutations:removeFromLibrary", input: JSON.stringify({ openalexId: work(1).openalexId }) });
    expect(one).not.toHaveProperty("batch");

    // A few changes in one call run at once, as they would one by one.
    mockDoStream
      .mockImplementationOnce(calling({ id: "few", name: "run_many", input: { name: "library_mutations_setLibraryRating", each: [101, 102, 103].map((n) => ({ openalexId: work(n).openalexId, rating: 4 })) } }))
      .mockImplementationOnce(finishingDoStream(["Rated three."]));
    await say("Rate the first three 4 stars");
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItems").collect()).filter((item) => item.rating === 4).length)).toBe(3);

    // One whose changes all fail says so as a failed call does, with what each came to.
    mockDoStream
      .mockImplementationOnce(calling({ id: "none", name: "run_many", input: { name: "library/mutations:setLibraryRating", each: [901, 902].map((n) => ({ openalexId: work(n).openalexId, rating: 2 })) } }))
      .mockImplementationOnce(finishingDoStream(["Those aren't in your library."]));
    await say("Rate two I never saved");
    expect(told(8, "none")).toMatchObject({ error: expect.stringContaining("None of these 2"), results: [{ error: expect.any(String) }, { error: expect.any(String) }] });
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
    const live = (await asAda.query(api.assistant.replies.live, { threadId }))!;
    expect(live.activity.phase).toBe("waiting");
    const waiting = live.attemptId;
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

  it("ask before an action that spends credits, with the most it holds, and run it unasked once the person allows that much in the chat", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const { asAda, threadId, say, sayUntilAsked, settled, steps } = await chatOf(t);
    const { id: collectionId } = await asAda.mutation(api.library.collections.createCollection, { name: "Trials" });
    for (const n of [1, 2, 3]) await asAda.mutation(api.library.mutations.setPaperInCollection, { paper: { openalexId: `https://openalex.org/W${n}`, title: `Trial ${n}`, abstract: "A trial of tutoring." }, collectionId, inCollection: true });
    const screen = (id: string, last = 3) => ({
      id,
      name: "run_action",
      input: { name: "screening/start:screen", arguments: { set: { kind: "collection", collectionId }, first: 1, last, questions: [{ key: "q1", question: "Is this a trial?" }], scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 0, stars: 1 }] }, saveTo: { kind: "none" } } },
    });
    const jobs = () => t.run(async (ctx) => (await ctx.db.query("screeningJobs").collect()).length);
    const limits = async () => {
      const { recent: _recent, ...read } = await asAda.query(api.assistant.spending.get, { threadId });
      return read;
    };

    // Nothing starts until she says so. She is shown the most it holds: every paper the collection has, however far the call said to go.
    mockDoStream.mockImplementationOnce(calling(screen("first", 500)));
    await sayUntilAsked("Screen my trials");
    expect(await jobs()).toBe(0);
    const asked = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.find((item) => item.role === "step" && item.status === "asking");
    expect(asked).toMatchObject({ action: "screening/start:screen", canAnswer: true, credits: 14 });
    // She is asked about the papers and the question, with her collection by its name, and not about how each answer scores.
    expect(asked && "details" in asked && asked.details).toEqual([{ name: "collection", value: "Trials" }, { name: "first", value: "1" }, { name: "last", value: "500" }, { name: "question", value: "Is this a trial?" }]);

    // "Always allow in this chat": it runs, and from now on jobs that hold no more than the smallest listed limit covering it run without asking.
    mockDoStream.mockImplementationOnce(finishingDoStream(["Screening them now."]));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: (await steps()).find((step) => step.status === "asking")!._id, allow: true, always: true });
    await settled();
    expect(await jobs()).toBe(1);
    expect(await limits()).toEqual({ replyLimit: null, allowance: { cap: 100 } });
    // A chat she starts takes it too, while her new chats take this chat's limits.
    await asAda.mutation(api.assistant.spending.setForNewChats, { threadId, on: true });
    const next = await asAda.mutation(api.assistant.threads.create, { title: "Another" });
    expect(await asAda.query(api.assistant.spending.get, { threadId: next })).toMatchObject({ allowance: { cap: 100 }, newChats: { replyLimit: null, allowance: { cap: 100 } } });
    await asAda.mutation(api.assistant.spending.setForNewChats, { threadId, on: false });
    mockDoStream.mockImplementationOnce(calling(screen("second"))).mockImplementationOnce(finishingDoStream(["And again."]));
    await say("Screen them again");
    expect(await jobs()).toBe(2);
    expect((await steps()).filter((step) => step.path === "screening/start:screen").map((step) => [step.status, step.credits])).toEqual([["done", 14], ["done", 14]]);
    // Each job may spend what she let it hold, asked or allowed, and stops there.
    expect(await t.run(async (ctx) => (await ctx.db.query("screeningJobs").collect()).map((job) => job.spendCap))).toEqual([14, 14]);
    // The Spending sheet lists them under the settings that decide for them.
    const listed = await asAda.query(api.assistant.spending.jobs, { threadId, paginationOpts: { cursor: null, numItems: 1 } });
    expect(listed).toMatchObject({ page: [{ action: "screening/start:screen", credits: 14 }], isDone: false });
    expect((await asAda.query(api.assistant.spending.jobs, { threadId, paginationOpts: { cursor: listed.continueCursor, numItems: 5 } })).page).toHaveLength(1);

    // A yes while her balance can't cover what the call holds starts nothing, and keeps no allowance: it waits for credits.
    await asAda.mutation(api.assistant.spending.setAllowance, { threadId, allowance: null });
    mockDoStream.mockImplementationOnce(calling(screen("short")));
    await sayUntilAsked("Screen them a third time");
    const waits = (await steps()).find((step) => step.status === "asking")!._id;
    const account = await t.run(async (ctx) => (await ctx.db.query("billingAccounts").first())!);
    await t.run(async (ctx) => ctx.db.patch("billingAccounts", account._id, { balance: 5 }));
    await expect(asAda.mutation(api.assistant.replies.answer, { threadId, stepId: waits, allow: true, always: true })).rejects.toThrow(/enough credits/);
    expect(await limits()).toEqual({ replyLimit: null, allowance: null });
    await t.run(async (ctx) => ctx.db.patch("billingAccounts", account._id, { balance: account.balance }));
    mockDoStream.mockImplementationOnce(finishingDoStream(["Left as it is."]));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: waits, allow: false });
    await settled();
    expect(await jobs()).toBe(2);

    // One that holds more than she allowed asks, and a no starts nothing.
    await asAda.mutation(api.assistant.spending.setAllowance, { threadId, allowance: { cap: 10 } });
    mockDoStream.mockImplementationOnce(calling(screen("third")));
    await sayUntilAsked("And once more");
    mockDoStream.mockImplementationOnce(finishingDoStream(["Left as it is."]));
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: (await steps()).find((step) => step.status === "asking")!._id, allow: false });
    await settled();
    expect(await jobs()).toBe(2);

    // "Always" keeps a limit of hers that already covers the job, her own number included, raises one that doesn't to the smallest listed that does, and past the largest listed there is none.
    const always = (cap: number, credits: number) =>
      t.run(async (ctx) => {
        const userId = (await ctx.db.get("assistantThreads", threadId))!.ownerId;
        await ctx.db.patch("assistantLimits", (await ctx.db.query("assistantLimits").withIndex("by_thread_and_user", (q) => q.eq("threadId", threadId).eq("userId", userId)).unique())!._id, { jobs: { cap } });
        return allowAlways(ctx, threadId, userId, credits);
      });
    expect(await always(1_500, 14)).toEqual({ cap: 1_500 });
    expect(await always(10, 14)).toEqual({ cap: 100 });
    expect(await always(300, 400)).toEqual({ cap: 1_000 });
    expect(await always(300, 5_000)).toEqual({});
    // A search's papers are OpenAlex's to count, so its hold is for the whole range asked for, whatever count the account last saw.
    expect(await t.run(async (ctx) => screeningHold(ctx, (await ctx.db.get("assistantThreads", threadId))!.ownerId, { set: { kind: "search", searchId: "not-counted-yet" }, first: 1, last: 100 }))).toBe(450);
    // A collection saved before counts were kept is counted from its papers, not taken for an empty one that would cost nothing.
    const uncounted = await t.run(async (ctx) => {
      const userId = (await ctx.db.get("assistantThreads", threadId))!.ownerId;
      const collectionId = await ctx.db.insert("collections", { userId, name: "Saved long ago", createdAt: 1, updatedAt: 1 });
      for (const openalexId of ["W91", "W92", "W93"]) {
        const libraryItemId = await ctx.db.insert("libraryItems", { userId, openalexId, title: openalexId, searchableText: openalexId, rating: 0, savedAt: 1, updatedAt: 1 });
        await ctx.db.insert("libraryItemCollections", { userId, collectionId, libraryItemId, assignedAt: 1 });
      }
      return screeningHold(ctx, userId, { set: { kind: "collection", collectionId }, first: 1, last: 100 });
    });
    expect(uncounted).toBe(14);

    // Asked before every job again, and an action that spends credits with no estimate to ask with isn't run at all.
    await asAda.mutation(api.assistant.spending.setAllowance, { threadId, allowance: null });
    expect(await limits()).toEqual({ replyLimit: null, allowance: null });
    requests.length = 0;
    mockDoStream
      .mockImplementationOnce(calling({ id: "extract", name: "run_action", input: { name: "extraction/mutations:startJob", arguments: { name: "Sizes", mode: "extraction", bucketItems: [], questions: [] } } }))
      .mockImplementationOnce(finishingDoStream(["I can't start that here."]));
    await say("Extract the sample sizes");
    expect(told(1, "extract")).toMatchObject({ error: expect.stringMatching(/can't be asked for here/) });
    expect(await t.run(async (ctx) => (await ctx.db.query("extractionJobs").collect()).length)).toBe(0);
  });

  it("show the person what a call acts on and what it changes before anything else about it", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId } = await chatOf(t);
    const { id: collectionId } = await asAda.mutation(api.library.collections.createCollection, { name: "Trials" });
    const paper = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`field${index}`, `value ${index}`]));
    const details = await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ paper, collectionId, inCollection: false, note: null })));
    // The call's own arguments lead, a value taken off is said, and the paper's fields fill what's left.
    expect(details.slice(0, 3)).toEqual([{ name: "collection", value: "Trials" }, { name: "inCollection", value: "false" }, { name: "note", value: "null" }]);
    expect(details).toHaveLength(12);
    // A collection that isn't hers stays an ID.
    const theirs = await t.run(async (ctx) => ctx.db.insert("collections", { ...(await ctx.db.get("collections", collectionId))!, _id: undefined, _creationTime: undefined, userId: (await ctx.db.query("users").collect()).find((user) => user._id !== ada)!._id, name: "Private to someone else" } as never));
    expect(await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ collectionId: theirs })))).toEqual([{ name: "collection", value: theirs }]);
    // A collection named by its ID and again by the name the call expects it to have is one line.
    expect(await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ collectionId, name: "Trials" })))).toEqual([{ name: "collection", value: "Trials" }]);
    // What an undo expects the record to be, and which kind of record an ID beside it names, aren't part of what's asked.
    expect(await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ threadId, principal: { kind: "user", userId: ada }, role: "read", expect: { answer: true, by: "model", at: 7 } })))).toEqual([
      { name: "thread", value: "Reading trials" },
      { name: "role", value: "read" },
      { name: "user", value: expect.any(String) },
    ]);
    // A saved search is shown by its query, and one saved with filters alone by nothing, never by its ID.
    const { id: asked } = await asAda.mutation(api.research.searches.create, { query: "tutoring trials" });
    const { id: filtered } = await asAda.mutation(api.research.searches.create, { fromYear: 2020, toYear: 2024 });
    expect(await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ id: asked })))).toEqual([{ name: "id", value: "tutoring trials" }]);
    expect(await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ id: filtered })))).toEqual([{ name: "id", value: "" }]);
    // Two records that share a name are both said: who a chat is shared with is never left out.
    await asAda.mutation(api.assistant.threads.rename, { threadId, title: "Trials" });
    expect(await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", ada))!, JSON.stringify({ threadId, collectionId })))).toEqual([{ name: "thread", value: "Trials" }, { name: "collection", value: "Trials" }]);
  });

  it("name a step after the saved paper or the collection its call gave only the ID of", async () => {
    const t = convexTest(schema);
    const { ada, asAda, say, steps } = await chatOf(t);
    const { id: collectionId } = await asAda.mutation(api.library.collections.createCollection, { name: "Trials" });
    await t.run(async (ctx) => {
      await ctx.db.insert("libraryItems", { userId: ada, openalexId: "https://openalex.org/W7", title: "Tutoring at scale", paperData: "{}", savedAt: 1, updatedAt: 1, searchableText: "tutoring at scale" });
    });
    mockDoStream
      // The paper by its short ID, as results give it, and a collection of hers.
      .mockImplementationOnce(calling({ id: "collect", name: "run_action", input: { name: "library/papers:collect", arguments: { id: "W7", collectionId, inCollection: true } } }))
      .mockImplementationOnce(calling({ id: "open", name: "run_action", input: { name: "library/collections:getCollection", arguments: { collectionId } } }))
      .mockImplementationOnce(finishingDoStream(["Done."]));
    await say("Put that paper in Trials");
    expect((await steps()).map((step) => [step.path, step.subject])).toEqual([["library/papers:collect", "Tutoring at scale"], ["library/collections:getCollection", "Trials"]]);
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

  it("pause a reply at the credits its sender lets one spend, carry it on for as much again from where it stands, and keep what it cost among their last", async () => {
    const t = convexTest(schema);
    const { ada, ben, asAda, asBen, threadId, thread, settled } = await chatOf(t);
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: ben }, role: "write" });
    // A limit is a whole number of credits from 1.
    for (const limit of [0, 1.5, -3]) await expect(asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit })).rejects.toThrow(/whole number/);
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: 1 });
    expect(await asAda.query(api.assistant.spending.get, { threadId })).toEqual({ replyLimit: 1, allowance: null, recent: [] });
    // It is hers alone: Ben, in the same chat, has none.
    expect((await asBen.query(api.assistant.spending.get, { threadId })).replyLimit).toBeNull();

    const list = () => ({ id: `c${requests.length}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: (requests.length % 3) + 1 } } });
    // Five requests that each read something, and a sixth that answers.
    const rounds = 6;
    mockDoStream.mockImplementation(async () => (requests.length < rounds ? calling(list())() : finishingDoStream(["That's all of them."])()));
    /** Waits until the reply has paused, or has ended. */
    const rested = () => waitFor(async () => !(await thread())?.reply, { timeoutMs: 5_000 });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Read all my collections" });
    await rested();
    const first = (await thread())!.asking!;
    // It stopped with more to do, at or past what she allowed, and nothing is running.
    expect(first).toMatchObject({ paused: "credits", cap: 1 });
    expect(first.spent).toBeGreaterThanOrEqual(1);
    expect(requests.length).toBeLessThan(rounds);
    expect(await asAda.query(api.assistant.replies.live, { threadId })).toMatchObject({ asking: true, paused: "credits", spent: first.spent, cap: 1 });
    // What it has cost is hers to see, and carrying it on is hers to do.
    const seenByBen = await asBen.query(api.assistant.replies.live, { threadId });
    expect(seenByBen).toMatchObject({ paused: "credits" });
    expect(seenByBen).not.toHaveProperty("spent");
    await expect(asBen.mutation(api.assistant.replies.carryOn, { threadId })).rejects.toThrow(/Only the person/);
    // The chat takes no message meanwhile.
    await expect(asAda.mutation(api.assistant.replies.send, { threadId, text: "And?" })).rejects.toThrow(/paused/);

    // Each time it's carried on it may spend as much again, counted from where it stands.
    let pauses = 0;
    for (; pauses < 20 && (await thread())?.asking; pauses++) {
      const waiting = (await thread())!.asking!;
      await asAda.mutation(api.assistant.replies.carryOn, { threadId });
      expect((await thread())?.reply).toMatchObject({ spent: waiting.spent, cap: waiting.spent + 1 });
      await rested();
    }
    await settled();
    expect(pauses).toBeGreaterThan(0);
    // It made every request once, through all its pauses, and answered.
    expect(requests).toHaveLength(rounds);
    await expect(asAda.mutation(api.assistant.replies.carryOn, { threadId })).rejects.toThrow(/isn't paused/);
    // What it cost in all is the newest of her last replies.
    const paid = (await t.run(async (ctx) => ctx.db.query("billingUsage").collect())).filter((charge) => charge.userId === ada).reduce((sum, charge) => sum + charge.credits, 0);
    expect((await asAda.query(api.assistant.spending.get, { threadId })).recent).toEqual([paid]);
    // A request stopped partway is settled after its reply has ended. What it cost is added to that reply, whichever is recorded first.
    const [{ reply }] = (await t.run(async (ctx) => ctx.db.query("assistantSpenders").collect()))[0].recent;
    await t.mutation(internal.assistant.spending.settledLate, { userId: ada, reply, credits: 4 });
    await t.mutation(internal.assistant.spending.settledLate, { userId: ada, reply: "a reply not recorded yet", credits: 7 });
    expect((await asAda.query(api.assistant.spending.get, { threadId })).recent).toEqual([paid + 4, 7]);
  });

  it.each([true, false])("hold a reply that asked with its limit already reached until it's carried on, when the answer is %s", async (allow) => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, thread, steps, settled } = await chatOf(t);
    const other = await asAda.mutation(api.assistant.threads.create, { title: "Old chat" });
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: 1 });
    mockDoStream
      .mockImplementationOnce(calling({ id: "delete", name: "run_action", input: { name: "assistant/threads:remove", arguments: { threadId: other } } }))
      .mockImplementationOnce(finishingDoStream(["Done."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Delete my old chat" });
    await waitFor(async () => (await thread())?.asking !== undefined, { timeoutMs: 5_000 });
    // The request that asked cost what she allowed, as she was charged for it.
    const paid = (await t.run(async (ctx) => ctx.db.query("billingUsage").collect())).filter((charge) => charge.userId === ada).reduce((sum, charge) => sum + charge.credits, 0);
    expect((await thread())!.asking!.spent).toBe(paid);
    expect(paid).toBeGreaterThanOrEqual(1);
    // As many replies of hers as one person has at once are being written elsewhere. Her answer is still taken: it starts none.
    await t.run(async (ctx) => {
      for (let n = 0; n < ASSISTANT_REPLIES_AT_ONCE; n++) {
        const scheduledId = await ctx.scheduler.runAfter(60_000, internal.assistant.replies.sweep, {});
        await ctx.db.insert("assistantThreads", { ownerId: ada, title: "Busy", agentThreadId: `busy${n}`, lastMessageAt: 1, createdAt: 1, updatedAt: 1, reply: { attemptId: `busy${n}`, senderId: ada, order: 0, startedAt: 1, scheduledId } });
      }
    });
    // Answering the question isn't agreeing to more credits: the reply waits to be carried on, with the answer kept.
    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: (await steps()).find((step) => step.status === "asking")!._id, allow });
    expect(await thread()).toMatchObject({ asking: { paused: "credits" } });
    expect((await thread())?.reply).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.get("assistantThreads", other))).not.toBeNull();
    // Carrying it on does start one, so it waits its turn.
    await expect(asAda.mutation(api.assistant.replies.carryOn, { threadId })).rejects.toThrow(/already writing/);
    await t.run(async (ctx) => {
      for (const busy of await ctx.db.query("assistantThreads").collect()) if (busy.title === "Busy") await ctx.db.delete("assistantThreads", busy._id);
    });
    // Carried on, it runs what she allowed, or is told she didn't allow it, and answers.
    await asAda.mutation(api.assistant.replies.carryOn, { threadId });
    await settled();
    expect((await t.run(async (ctx) => ctx.db.get("assistantThreads", other))) === null).toBe(allow);
    expect(requests).toHaveLength(2);
  });

  it("keep nothing for a sender whose account is gone when their paused reply is stopped", async () => {
    const t = convexTest(schema);
    const { ada, ben, asAda, asBen, threadId, thread } = await chatOf(t);
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: ben }, role: "write" });
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: 1 });
    mockDoStream.mockImplementation(async () => calling({ id: `c${requests.length}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: (requests.length % 3) + 1 } } })());
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Read all my collections" });
    await waitFor(async () => (await thread())?.asking?.paused !== undefined, { timeoutMs: 5_000 });
    // Her account is purged, record and all, while her reply waits in a chat Ben can write in.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("assistantSpenders").collect()) await ctx.db.delete("assistantSpenders", row._id);
      await ctx.db.delete("users", ada);
    });
    await asBen.mutation(api.assistant.replies.stop, { threadId, attemptId: (await asBen.query(api.assistant.replies.live, { threadId }))!.attemptId });
    expect((await thread())?.asking).toBeUndefined();
    expect(await t.run(async (ctx) => ctx.db.query("assistantSpenders").collect())).toEqual([]);
  });

  it("end a paused reply when it's stopped, and take the next message", async () => {
    const t = convexTest(schema);
    const { asAda, threadId, say, thread, stop, shown } = await chatOf(t);
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: 1 });
    mockDoStream.mockImplementation(async () => calling({ id: `c${requests.length}`, name: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: (requests.length % 3) + 1 } } })());
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Read all my collections" });
    await waitFor(async () => (await thread())?.asking?.paused !== undefined, { timeoutMs: 5_000 });
    const spent = (await thread())!.asking!.spent;
    await stop();
    expect((await thread())?.reply).toBeUndefined();
    expect((await thread())?.asking).toBeUndefined();
    expect((await shown()).at(-1)).toBe("assistant: (stopped)");
    expect((await asAda.query(api.assistant.spending.get, { threadId })).recent).toEqual([spent]);
    mockDoStream.mockImplementation(finishingDoStream(["Here."]));
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: null });
    await say("Just tell me");
    expect((await shown()).at(-1)).toBe("assistant: Here.");
  });

  it("pause a reply after a thousand requests whatever they cost, and give it a thousand more when it's carried on", () => {
    expect(pausedAt({ spent: 3, rounds: 999 })).toBeNull();
    expect(pausedAt({ spent: 3, rounds: 1_000 })).toBe("requests");
    // The credit limit it had stays as it was.
    expect(carriedOn({ spent: 3, rounds: 1_000, paused: "requests", cap: 50 }, 50)).toEqual({ cap: 50, lap: 2_000 });
    expect(pausedAt({ spent: 3, rounds: 1_000, cap: 50, lap: 2_000 })).toBeNull();
    // At a credit limit: as much again from where it stands, or none when the limit was lifted while it waited.
    expect(carriedOn({ spent: 12, rounds: 4, paused: "credits", cap: 10, lap: 2_000 }, 10)).toEqual({ cap: 22, lap: 2_000 });
    expect(carriedOn({ spent: 12, rounds: 4, paused: "credits", cap: 10 }, undefined)).toEqual({});
  });

  it("start a person's new chats on the limit they chose for them, keep it in step while they change it, and forget a deleted chat's", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOf(t);
    const limitIn = async (chat: Id<"assistantThreads">) => {
      const { recent: _recent, allowance: _allowance, ...limits } = await asAda.query(api.assistant.spending.get, { threadId: chat });
      return limits;
    };
    const started = () => asAda.mutation(api.assistant.threads.create, { title: "Another" });
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: 25 });
    // Until she says so, a new chat has no limit.
    expect(await limitIn(await started())).toEqual({ replyLimit: null });
    await asAda.mutation(api.assistant.spending.setForNewChats, { threadId, on: true });
    expect(await limitIn(threadId)).toEqual({ replyLimit: 25, newChats: { replyLimit: 25, allowance: null } });
    const second = await started();
    expect(await limitIn(second)).toEqual({ replyLimit: 25, newChats: { replyLimit: 25, allowance: null } });
    // Changing it where new chats take it from changes what they start with. A chat already started keeps its own.
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: 50 });
    expect(await limitIn(await started())).toMatchObject({ replyLimit: 50 });
    expect(await limitIn(second)).toEqual({ replyLimit: 25, newChats: { replyLimit: 50, allowance: null } });
    // Lifted there, new chats start with none.
    await asAda.mutation(api.assistant.spending.setReplyLimit, { threadId, limit: null });
    expect(await limitIn(await started())).toEqual({ replyLimit: null, newChats: { replyLimit: null, allowance: null } });
    await asAda.mutation(api.assistant.spending.setForNewChats, { threadId, on: false });
    expect(await limitIn(threadId)).toEqual({ replyLimit: null });
    // A deleted chat's limit goes with it.
    await asAda.mutation(api.assistant.threads.remove, { threadId: second });
    await waitFor(async () => (await t.run(async (ctx) => ctx.db.query("assistantLimits").collect())).every((row) => row.threadId !== second), { timeoutMs: 5_000 });
  });

  it("bring a long reply's steps with the chat's newest page, though the message it answers is pages back", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, say, thread } = await chatOf(t);
    mockDoStream.mockImplementationOnce(finishingDoStream(["All read."]));
    await say("Read a great deal");
    const agentThreadId = (await thread())!.agentThreadId;
    await t.run(async (ctx) => {
      // Thirty requests that each called an action: sixty rows the chat doesn't show, between the message and its answer's page.
      const prompt = (await listMessages(ctx, components.agent, { threadId: agentThreadId, paginationOpts: { cursor: null, numItems: 10 } })).page.find((doc) => doc.message?.role === "user")!;
      const call = (id: string) => ({ role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId: id, toolName: "library_collections_listCollections", input: { paginationOpts: { cursor: null, numItems: 5 } } }] });
      const result = (id: string) => ({ role: "tool" as const, content: [{ type: "tool-result" as const, toolCallId: id, toolName: "library_collections_listCollections", output: { type: "json" as const, value: { page: [] } } }] });
      for (let round = 0; round < 30; round++) {
        await saveMessages(ctx, components.agent, { threadId: agentThreadId, promptMessageId: prompt._id, messages: [call(`c${round}`), result(`c${round}`)] });
        await ctx.db.insert("assistantSteps", { threadId, order: 0, userId: ada, toolCallId: `c${round}`, path: "library/collections:listCollections", input: "{}", subject: `Read ${round}`, status: "done", startedAt: round, endedAt: round });
      }
    });
    const read = (paginationOpts: { cursor: string | null; numItems: number }) => asAda.query(api.assistant.replies.messages, { threadId, stepsAhead: true, paginationOpts });
    // A reader that doesn't ask, as the assistant reading its own chat, gets each step once, with the message it answers.
    expect((await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page).toEqual([]);
    const newest = await read(firstPage);
    // For the panel, the newest page holds none of the reply's messages to show, and all its steps, newest first.
    expect(newest.page.filter((item) => item.role !== "step")).toEqual([]);
    expect(newest.page.map((item) => (item.role === "step" ? item.subject : item.role))).toEqual(Array.from({ length: 30 }, (_, i) => `Read ${29 - i}`));
    // A page before it isn't the newest: it brings steps only with the message they answer, under the same IDs.
    const all = [...newest.page];
    for (let cursor = newest.continueCursor, done = newest.isDone; !done; ) {
      const page = await read({ cursor, numItems: 20 });
      all.push(...page.page);
      cursor = page.continueCursor;
      done = page.isDone;
    }
    const stepIds = all.flatMap((item) => (item.role === "step" ? [item.id] : []));
    expect(stepIds).toHaveLength(60);
    expect(new Set(stepIds).size).toBe(30);
    expect(all.filter((item) => item.role !== "step").map((item) => `${item.role}: ${"text" in item ? item.text : ""}`)).toEqual(["assistant: All read.", "user: Read a great deal"]);
  });

  it("say which kind of change a step made to the person's research records, the one action that makes several", async () => {
    const t = convexTest(schema);
    const { ada, asAda, threadId, say } = await chatOf(t);
    mockDoStream.mockImplementationOnce(finishingDoStream(["Rated."]));
    await say("Rate that paper");
    await t.run(async (ctx) => {
      const step = { threadId, order: 0, userId: ada, toolCallId: "rate", path: "research/records:change", status: "done" as const, startedAt: 1, endedAt: 1 };
      await ctx.db.insert("assistantSteps", { ...step, input: JSON.stringify({ requestId: "r1", command: { kind: "rating", paperId: "W1", rating: 5 } }) });
      // Arguments too long to keep whole were cut, and don't parse: the step still shows, as the action alone.
      await ctx.db.insert("assistantSteps", { ...step, toolCallId: "cut", input: '{"requestId":"r2","command":{"kind":"createSea' });
    });
    const page = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: firstPage })).page.flatMap((item) => (item.role === "step" ? [item] : []));
    expect(page.map((item) => [item.action, item.variant])).toEqual([["research/records:change", undefined], ["research/records:change", "rating"]]);
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
    expect(toolsSent[0].slice(-3)).toEqual(["find_action", "run_action", "run_many"]);
    expect(toolsSent[0]).toHaveLength(core().length + 3);
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
