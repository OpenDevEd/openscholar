/// <reference types="vite/client" />
// The ask before the assistant adds papers to a community: its card reads what the call adds, and the person's
// choice of where the papers go replaces the assistant's when they allow it.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { people } from "./assistant.test-support";
import { seedCreditsForTest } from "../billing/billing.test-support";

const ADD_PAPERS = "evidenceLibraries/assistant:addPapers";

it("shows the community and the papers the call adds, and sends them where the person chose", async () => {
  const t = convexTest(schema);
  const who = await people(t);
  await t.run((ctx) => seedCreditsForTest(ctx, { userId: who.ada, free: 100_000 }));
  const modelId = await t.run((ctx) =>
    ctx.db.insert("models", { modelId: "mock/model", name: "Mock", provider: "openrouter", inputPricePerMillion: 1, outputPricePerMillion: 2, costMarkup: 1, contextLength: 200_000, supportedParameters: ["tools"], inputModalities: ["text"], isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 }),
  );
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Papers", modelId });
  const { stepId, libraryId } = await t.run(async (ctx) => {
    const thread = (await ctx.db.get("assistantThreads", threadId))!;
    // A community of Ada's own, so she may publish to it.
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId: who.home.ada, name: "Wealth Inequality", slug: "wealth", state: "active", createdByClerkUserId: "ada", updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 } as never);
    const input = JSON.stringify({ libraryId, papers: [{ openalexId: "W1" }, { link: "https://openscholar.ai/papers/OS2" }], publish: false, requestId: "r1" });
    const call = { toolCallId: "c1", tool: "run_action", path: ADD_PAPERS, input };
    await ctx.db.patch("assistantThreads", threadId, { asking: { senderId: who.ada, workspaceId: thread.workspaceId, order: 1, promptMessageId: "p1", modelId, spent: 0, rounds: 1, made: 1, askedAt: 1 } as never });
    const stepId = await ctx.db.insert("assistantSteps", { threadId, order: 1, userId: who.ada, workspaceId: thread.workspaceId, ...call, prompt: "p1", status: "asking", startedAt: 1 } as never);
    return { stepId, libraryId };
  });

  // Only the person it waits on reads it, with the assistant's choice and whether they may publish.
  expect(await who.asAda.query(api.assistant.replies.askedPapers, { threadId, stepId })).toMatchObject({
    libraryId,
    publish: false,
    canPublish: true,
    papers: [{ openalexId: "W1", doi: null, link: null }, { openalexId: null, doi: null, link: "https://openscholar.ai/papers/OS2" }],
    community: { name: "Wealth Inequality" },
  });

  // She publishes them, though the assistant meant them for the review queue.
  await who.asAda.mutation(api.assistant.replies.answer, { threadId, stepIds: [stepId], allow: true, publish: true });
  const step = await t.run((ctx) => ctx.db.get("assistantSteps", stepId));
  expect(step).toMatchObject({ status: "allowed" });
  expect(JSON.parse(step!.input)).toMatchObject({ libraryId, publish: true, requestId: "r1" });
  // Answered, it asks nothing more, and its card is gone rather than the plain ask in its place.
  expect(await who.asAda.query(api.assistant.replies.askedPapers, { threadId, stepId })).toBe("answered");
  // A call whose arguments were cut too long to read is asked about with the plain card.
  const cut = await t.run(async (ctx) => {
    const thread = (await ctx.db.get("assistantThreads", threadId))!;
    return await ctx.db.insert("assistantSteps", { threadId, order: 1, userId: who.ada, workspaceId: thread.workspaceId, toolCallId: "c2", tool: "run_action", path: ADD_PAPERS, input: '{"libraryId":"x","papers":[{"link":"https://', prompt: "p1", status: "asking", startedAt: 1 } as never);
  });
  expect(await who.asAda.query(api.assistant.replies.askedPapers, { threadId, stepId: cut })).toBeNull();
});
