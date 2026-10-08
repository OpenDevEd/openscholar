/// <reference types="vite/client" />
// Reading a paper's open-access PDF: by the address OpenAlex gives, checked to serve a PDF,
// and sent to the model by that address in the reply that read it, never in a later one.
import { APICallError } from "@ai-sdk/provider";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { people } from "../assistant/assistant.test-support";
import { callingDoStream, finishingDoStream, waitFor } from "../assistant/turn.test-support";
import { COMPACT_AT_TOKENS } from "../assistant/context";

const { mockDoStream, mockDoGenerate, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), mockDoGenerate: vi.fn(), fetchMock: vi.fn() }));
vi.mock("../ai/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  // PDF addresses go to OpenRouter as they are, as its provider declares, so the SDK doesn't download them.
  return { resolveOpenRouterModel: async () => ({ model: new MockLanguageModelV3({ modelId: "mock/model", doStream: mockDoStream, doGenerate: mockDoGenerate, supportedUrls: { "application/*": [/^https?:\/\/.+$/] } }), modelSlug: "mock/model", pricing: { input: 1_000, output: 2_000 } }) };
});

const PDF = "https://example.org/loot-boxes.pdf";
/** OpenAlex's works: one with an open-access PDF, one with none, one whose address serves a page. */
const WORKS: Record<string, object> = {
  W1: { id: "https://openalex.org/W1", display_name: "Loot boxes and problem gambling", best_oa_location: { pdf_url: PDF } },
  W2: { id: "https://openalex.org/W2", display_name: "A closed paper", best_oa_location: null },
  W3: { id: "https://openalex.org/W3", display_name: "A landing page", best_oa_location: { pdf_url: "https://example.org/landing" } },
};
const pdfChecks: Array<string | null> = [];

beforeEach(() => {
  mockDoStream.mockReset();
  mockDoGenerate.mockReset();
  fakeAutumn.reset();
  pdfChecks.length = 0;
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  const autumn = fakeAutumnFetch();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.openalex.org") {
      const work = WORKS[url.pathname.split("/").at(-1)!];
      return work ? new Response(JSON.stringify(work), { status: 200 }) : new Response("{}", { status: 404 });
    }
    if (url.hostname === "example.org") {
      pdfChecks.push(new Headers(init?.headers).get("range"));
      if (url.href !== PDF) return new Response("<!doctype html><title>Article</title>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response("%PDF-1.7\n%âãÏÓ\n1 0 obj", { status: new Headers(init?.headers).has("range") ? 206 : 200, headers: { "content-type": "application/pdf" } });
    }
    return autumn(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Test = ReturnType<typeof convexTest>;
const replied = (t: Test, threadId: Id<"assistantThreads">) => waitFor(async () => !(await t.run((ctx) => ctx.db.get("assistantThreads", threadId)))?.reply);

/** A chat on a model that reads PDFs, with reading files allowed in it, so a read runs without asking. */
async function chat(t: Test, free = 100_000, inputs = ["text", "image", "file"]) {
  const who = await people(t);
  await t.run((ctx) => seedCreditsForTest(ctx, { userId: who.ada, free }));
  const modelId = await t.run((ctx) =>
    ctx.db.insert("models", { modelId: "mock/model", name: "Mock", provider: "openrouter", inputPricePerMillion: 1, outputPricePerMillion: 2, costMarkup: 1, contextLength: 200_000, supportedParameters: ["tools"], inputModalities: inputs, isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 }),
  );
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Methods", modelId });
  await who.asAda.mutation(api.assistant.spending.setTool, { threadId, tool: "files", allowed: true });
  return { ...who, threadId };
}

type Prompt = Array<{ role: string; content: Array<{ type: string; output?: { type: string; value: unknown } }> }>;
/** The tool result a request read for the call with this ID. */
const resultIn = (prompt: Prompt) => prompt.filter((message) => message.role === "tool").flatMap((message) => message.content).find((part) => part.type === "tool-result")?.output;

describe("reading a paper's PDF", () => {
  it("gives the PDF's address once it answers with a PDF, and refuses a paper with none or an address that serves a page", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);

    expect(await asAda.action(api.research.papers.readPdf, { id: "W1" })).toMatchObject({ title: "Loot boxes and problem gambling", paperPdf: PDF });
    // Only its first bytes were read to check it, not the file.
    expect(pdfChecks).toEqual(["bytes=0-1023"]);
    await expect(asAda.action(api.research.papers.readPdf, { id: "W2" })).rejects.toThrow(/no open-access PDF/);
    await expect(asAda.action(api.research.papers.readPdf, { id: "W3" })).rejects.toThrow(/couldn't be opened/);
  });

  it("never fetches a private address, at first or after a redirect, and takes a signature split across chunks", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    WORKS.W4 = { id: "https://openalex.org/W4", display_name: "Internal", best_oa_location: { pdf_url: "http://127.0.0.1/paper.pdf" } };
    WORKS.W5 = { id: "https://openalex.org/W5", display_name: "Redirected", best_oa_location: { pdf_url: "https://example.org/moved.pdf" } };
    WORKS.W6 = { id: "https://openalex.org/W6", display_name: "Chunked", best_oa_location: { pdf_url: "https://example.org/chunked.pdf" } };
    const fetched: string[] = [];
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetched.push(url);
      if (url === "https://example.org/moved.pdf") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      if (url === "https://example.org/chunked.pdf") {
        const parts = ["%P", "DF-1.7\n", "1 0 obj"].map((part) => new TextEncoder().encode(part));
        return new Response(new ReadableStream({ pull: (controller) => (parts.length ? controller.enqueue(parts.shift()!) : controller.close()) }), { status: 200 });
      }
      return answer(input, init);
    });

    await expect(asAda.action(api.research.papers.readPdf, { id: "W4" })).rejects.toThrow(/couldn't be opened/);
    await expect(asAda.action(api.research.papers.readPdf, { id: "W5" })).rejects.toThrow(/couldn't be opened/);
    expect(fetched.some((url) => url.includes("127.0.0.1") || url.includes("169.254.169.254"))).toBe(false);
    expect(await asAda.action(api.research.papers.readPdf, { id: "W6" })).toMatchObject({ paperPdf: "https://example.org/chunked.pdf" });
  });

  it("reads nothing when the title it was asked about isn't the ID's paper", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    await expect(asAda.action(api.research.papers.readPdf, { id: "W1", title: "Video games and wellbeing" })).rejects.toThrow(/Loot boxes and problem gambling.{0,4} in OpenAlex/);
    expect(pdfChecks).toEqual([]);
    // A title without its subtitle is the same paper.
    expect(await asAda.action(api.research.papers.readPdf, { id: "W1", title: "Loot boxes" })).toMatchObject({ paperPdf: PDF });
  });

  it("refuses before asking, and before OpenAlex, when the chat's model can't read PDFs", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t, 100_000, ["text"]);
    await asAda.mutation(api.assistant.spending.setTool, { threadId, tool: "files", allowed: false });
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "pdf-1", name: "research_papers_readPdf", input: { id: "W1", title: "Loot boxes and problem gambling" } }))
      .mockImplementation(finishingDoStream(["It can't read PDFs."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
    await replied(t, threadId);
    const steps = await t.run((ctx) => ctx.db.query("assistantSteps").collect());
    expect(steps.filter((step) => step.status === "asking")).toEqual([]);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("api.openalex.org"))).toBe(false);
    expect(JSON.stringify(mockDoStream.mock.lastCall![0].prompt)).toContain("can't read PDFs");
  });

  it("asks first, and once allowed, the reply goes on with the PDF in view", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t);
    await asAda.mutation(api.assistant.spending.setTool, { threadId, tool: "files", allowed: false });
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "pdf-1", name: "research_papers_readPdf", input: { id: "W1", title: "Loot boxes and problem gambling" } }))
      .mockImplementation(finishingDoStream(["It reports a link (p. 5)."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
    await replied(t, threadId);
    const asking = await t.run((ctx) => ctx.db.query("assistantSteps").withIndex("by_thread_and_status", (q) => q.eq("threadId", threadId).eq("status", "asking")).collect());
    expect(asking).toMatchObject([{ path: "research/papers:readPdf" }]);
    expect(asking[0].credits).toBeGreaterThan(0);

    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: asking[0]._id, allow: true });
    await replied(t, threadId);
    expect(JSON.stringify(resultIn(mockDoStream.mock.lastCall![0].prompt as Prompt))).toContain(`"url":"${PDF}"`);
  });

  it("sends the model the PDF by its address in the reply that read it, and only a note in later replies", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t);
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "pdf-1", name: "research_papers_readPdf", input: { id: "W1" } }))
      .mockImplementationOnce(finishingDoStream(["It reports a link (p. 5)."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
    await replied(t, threadId);

    const read = resultIn(mockDoStream.mock.lastCall![0].prompt as Prompt);
    // The model gets the PDF by its address, and none of its bytes: "JVBERi0" is how "%PDF-" starts in base64.
    expect(read?.type).toBe("content");
    expect(JSON.stringify(read)).toContain(`"url":"${PDF}"`);
    expect(JSON.stringify(read)).not.toContain("JVBERi0");
    // The step keeps the address, which the reply's page citations open.
    const steps = await t.run((ctx) => ctx.db.query("assistantSteps").collect());
    expect(steps).toMatchObject([{ path: "research/papers:readPdf", status: "done", sources: [{ url: PDF }] }]);

    mockDoStream.mockImplementation(finishingDoStream(["As before."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "And its sample?" });
    await replied(t, threadId);
    const later = resultIn(mockDoStream.mock.lastCall![0].prompt as Prompt);
    expect(later?.type).toBe("text");
    expect(String(later?.value)).toMatch(/earlier reply/);
    expect(JSON.stringify(mockDoStream.mock.lastCall![0].prompt)).not.toContain('"type":"file"');
  });

  it("makes a request a provider refused for a PDF's address again, with the PDF downloaded here, and the reply goes on", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t);
    // Some publishers turn the provider's fetcher away and serve us: the provider refuses the request it can't fetch for.
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "pdf-1", name: "research_papers_readPdf", input: { id: "W1" } }))
      .mockImplementationOnce(async () => {
        throw new APICallError({ message: "Unable to download the file. Please verify the URL and try again.", url: "https://openrouter.ai", requestBodyValues: {}, statusCode: 400 });
      })
      .mockImplementation(finishingDoStream(["It reports a link (p. 5)."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
    await replied(t, threadId);

    expect(mockDoStream).toHaveBeenCalledTimes(3);
    const read = JSON.stringify(resultIn(mockDoStream.mock.lastCall![0].prompt as Prompt));
    expect(read).toContain("JVBERi0");
    expect(read).not.toContain(`"url":"${PDF}"`);
    const replies = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { numItems: 20, cursor: null } })).page.filter((item) => item.role === "assistant");
    expect(replies).toMatchObject([{ status: "done", text: "It reports a link (p. 5)." }]);
  });

  it("tells the model when the PDF can't be downloaded here either, and the reply goes on, whatever error the provider gave", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t);
    const answer = fetchMock.getMockImplementation()!;
    // The address answers the check for its first bytes, and then stops serving the file.
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => (String(input) === PDF && !new Headers(init?.headers).has("range") ? new Response("Forbidden", { status: 403 }) : answer(input, init)));
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "pdf-1", name: "research_papers_readPdf", input: { id: "W1" } }))
      .mockImplementationOnce(async () => {
        // A provider can report an address it couldn't fetch as a passing error.
        throw new APICallError({ message: "Provider returned error", url: "https://openrouter.ai", requestBodyValues: {}, statusCode: 503 });
      })
      .mockImplementation(finishingDoStream(["I couldn't open it. Could you attach the PDF?"]));
    try {
      await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
      await waitFor(() => mockDoStream.mock.calls.length === 2);
      await vi.advanceTimersByTimeAsync(2_000);
      await replied(t, threadId);
    } finally {
      vi.useRealTimers();
    }

    const read = resultIn(mockDoStream.mock.lastCall![0].prompt as Prompt);
    expect(read?.type).toBe("text");
    expect(String(read?.value)).toMatch(/couldn't be downloaded/);
    const replies = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { numItems: 20, cursor: null } })).page.filter((item) => item.role === "assistant");
    expect(replies).toMatchObject([{ status: "done" }]);
  });

  it("lets a summary written partway read the PDF the reply read, so what it says isn't lost", async () => {
    const t = convexTest(schema);
    // A request past the budget, at the mock's price, costs a great deal.
    const { asAda, threadId } = await chat(t, 100_000_000);
    // The request that reads the PDF is past the budget, so the reply is summarized before any request shows the model the PDF.
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "pdf-1", name: "research_papers_readPdf", input: { id: "W1" }, read: COMPACT_AT_TOKENS + 1 }))
      .mockImplementation(finishingDoStream(["It reports a link (p. 5)."]));
    mockDoGenerate.mockImplementation(async () => ({ content: [{ type: "text", text: "Decisions\nNone.\nNext step\nAnswer from the paper's p. 5." }], finishReason: "stop", usage: { inputTokens: { total: 60_000, noCache: 0, cacheRead: 60_000, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } }, warnings: [] }));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
    await replied(t, threadId);

    expect(mockDoGenerate).toHaveBeenCalled();
    expect(JSON.stringify(mockDoGenerate.mock.lastCall![0].prompt)).toContain(`"url":"${PDF}"`);
  });
});
