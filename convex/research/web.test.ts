/// <reference types="vite/client" />
// The assistant's web search (#648): what one search returns and is charged, and how the
// person is asked about it in a chat.
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { people } from "../assistant/assistant.test-support";
import { callingDoStream, finishingDoStream, waitFor } from "../assistant/turn.test-support";

const { mockDoStream, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);
vi.mock("../ai/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return { resolveOpenRouterModel: async () => ({ model: new MockLanguageModelV3({ modelId: "mock/model", doStream: mockDoStream }), modelSlug: "mock/model", pricing: { input: 1_000, output: 2_000 } }) };
});

/** OpenRouter's answer to a search: the pages as the small model's citations, and what it cost. */
const found = {
  choices: [
    {
      message: {
        content: "Sources",
        annotations: [
          { type: "url_citation", url_citation: { url: "https://www.gov.uk/loot-boxes", title: "Government response", content: "The government chose not to legislate." } },
          { type: "url_citation", url_citation: { url: "https://www.gov.uk/loot-boxes", title: "Government response", content: "Again." } },
          { type: "url_citation", url_citation: { url: "https://gamingcommission.be/report", title: "Research report on loot boxes", content: "Paid loot boxes are games of chance." } },
        ],
      },
    },
  ],
  usage: { cost: 0.0081 },
};

beforeEach(() => {
  mockDoStream.mockReset();
  fakeAutumn.reset();
  const autumn = fakeAutumnFetch();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("https://openrouter.ai/api/v1/chat/completions") ? new Response(JSON.stringify(found), { status: 200 }) : autumn(input, init),
  );
});

type Test = ReturnType<typeof convexTest>;
const replied = (t: Test, threadId: Id<"assistantThreads">) => waitFor(async () => !(await t.run((ctx) => ctx.db.get("assistantThreads", threadId)))?.reply);

async function chat(t: Test) {
  const who = await people(t);
  await t.run((ctx) => seedCreditsForTest(ctx, { userId: who.ada, free: 100_000 }));
  const modelId = await t.run((ctx) =>
    ctx.db.insert("models", { modelId: "mock/model", name: "Mock", provider: "openrouter", inputPricePerMillion: 1, outputPricePerMillion: 2, costMarkup: 1, contextLength: 200_000, supportedParameters: ["tools"], isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 }),
  );
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Regulation", modelId });
  return { ...who, threadId };
}

describe("web search", () => {
  it("returns each page it found once, and charges what OpenRouter says the search cost", async () => {
    const t = convexTest(schema);
    const { asAda } = await chat(t);

    const read = await asAda.action(api.research.web.search, { query: "loot box regulation" });
    expect(read.results.map((result) => result.url)).toEqual(["https://www.gov.uk/loot-boxes", "https://gamingcommission.be/report"]);
    expect(read.results[0]).toMatchObject({ title: "Government response", excerpt: "The government chose not to legislate." });
    const charged = await t.run((ctx) => ctx.db.query("billingUsage").collect());
    expect(charged).toMatchObject([{ kind: "search", costUsd: 0.0081 }]);
  });

  it("tries again when the provider is down for a moment", async () => {
    const t = convexTest(schema);
    const { asAda } = await chat(t);
    const answer = fetchMock.getMockImplementation()!;
    let busy = 1;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://openrouter.ai") && busy-- > 0 ? new Response(JSON.stringify({ error: { code: 503, message: "Provider returned error" } }), { status: 503 }) : answer(input, init),
    );

    const read = await asAda.action(api.research.web.search, { query: "loot box regulation" });
    expect(read.results).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("https://openrouter.ai"))).toHaveLength(2);
  });

  it("asks first in a chat, and Always allow lets later searches run without asking, but not jobs", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t);
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "web-1", name: "research_web_search", input: { query: "loot box regulation" } }))
      .mockImplementation(finishingDoStream(["Belgium banned them."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What have regulators done?" });
    await replied(t, threadId);

    const asking = await t.run((ctx) => ctx.db.query("assistantSteps").withIndex("by_thread_and_status", (q) => q.eq("threadId", threadId).eq("status", "asking")).collect());
    expect(asking).toMatchObject([{ path: "research/web:search" }]);
    expect(asking[0].credits).toBeGreaterThan(0);

    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: asking[0]._id, allow: true, always: true });
    await replied(t, threadId);
    const step = await t.run((ctx) => ctx.db.get("assistantSteps", asking[0]._id));
    expect(step).toMatchObject({ status: "done", sources: [{ url: "https://www.gov.uk/loot-boxes" }, { url: "https://gamingcommission.be/report" }] });
    // Searches are allowed from now on in this chat; jobs that spend credits still ask.
    expect(await asAda.query(api.assistant.spending.get, { threadId })).toMatchObject({ web: true, files: false, allowance: null });
  });
});
