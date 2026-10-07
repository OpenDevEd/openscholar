/// <reference types="vite/client" />
// Reading a paper's open-access PDF: by the address OpenAlex gives, checked to serve a PDF,
// and sent to the model by that address in the reply that read it, never in a later one.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { people } from "../assistant/assistant.test-support";
import { callingDoStream, finishingDoStream, waitFor } from "../assistant/turn.test-support";

const { mockDoStream, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), fetchMock: vi.fn() }));
vi.mock("../ai/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  // PDF addresses go to OpenRouter as they are, as its provider declares, so the SDK doesn't download them.
  return { resolveOpenRouterModel: async () => ({ model: new MockLanguageModelV3({ modelId: "mock/model", doStream: mockDoStream, supportedUrls: { "application/*": [/^https?:\/\/.+$/] } }), modelSlug: "mock/model", pricing: { input: 1_000, output: 2_000 } }) };
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
      return new Response(url.href === PDF ? "%PDF-1.7\n%âãÏÓ\n1 0 obj" : "<!doctype html><title>Article</title>", { status: url.href === PDF ? 206 : 200 });
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
async function chat(t: Test) {
  const who = await people(t);
  await t.run((ctx) => seedCreditsForTest(ctx, { userId: who.ada, free: 100_000 }));
  const modelId = await t.run((ctx) =>
    ctx.db.insert("models", { modelId: "mock/model", name: "Mock", provider: "openrouter", inputPricePerMillion: 1, outputPricePerMillion: 2, costMarkup: 1, contextLength: 200_000, supportedParameters: ["tools"], inputModalities: ["text", "image", "file"], isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 }),
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
});
