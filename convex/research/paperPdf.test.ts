/// <reference types="vite/client" />
// Reading a paper's PDF: from the paper PDF store first (a chat pays once for a stored copy), else its own link
// (free) or OpenAlex's copy (paid), each kept in the store, and sent to the model as a link to the stored copy
// in the reply that read it, never in a later one.
import { APICallError } from "@ai-sdk/provider";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { people } from "../assistant/assistant.test-support";
import { callingDoStream, finishingDoStream, waitFor } from "../assistant/turn.test-support";
import { COMPACT_AT_TOKENS } from "../assistant/context";
import { paperKeys, paperPdf, type PdfOptions } from "../lib/paperPdfs";
import { MAX_PDF_BYTES } from "../../lib/files/limits";
import { PAPER_PDF_CREDITS as STORED_PDF_CREDITS } from "../../lib/pricing";
import { fakeStore, storeAnswer, storedAddress, stubPaperStore } from "../lib/paperPdfs.test-support";

const { mockDoStream, mockDoGenerate, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), mockDoGenerate: vi.fn(), fetchMock: vi.fn() }));
vi.mock("../ai/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  // PDF addresses go to OpenRouter as they are, as its provider declares, so the SDK doesn't download them.
  return { resolveOpenRouterModel: async () => ({ model: new MockLanguageModelV3({ modelId: "mock/model", doStream: mockDoStream, doGenerate: mockDoGenerate, supportedUrls: { "application/*": [/^https?:\/\/.+$/] } }), modelSlug: "mock/model", pricing: { input: 1_000, output: 2_000 } }) };
});

const PDF = "https://example.org/loot-boxes.pdf";
const PDF_BYTES = "%PDF-1.7\n%âãÏÓ\n1 0 obj";
/** OpenAlex's works: one with an open-access PDF, one with none and no copy, one whose link serves a page but that OpenAlex has a copy of. */
const WORKS: Record<string, object> = {
  W1: { id: "https://openalex.org/W1", display_name: "Loot boxes and problem gambling", best_oa_location: { pdf_url: PDF }, has_content: { pdf: true } },
  W2: { id: "https://openalex.org/W2", display_name: "A closed paper", best_oa_location: null, has_content: { pdf: false } },
  W3: { id: "https://openalex.org/W3", display_name: "A landing page", best_oa_location: { pdf_url: "https://example.org/landing" }, has_content: { pdf: true } },
  W7: { id: "https://openalex.org/W7", display_name: "Listed", doi: "https://doi.org/10.7/listed", locations: [{ pdf_url: PDF, landing_page_url: "https://example.org/landing" }] },
};
/** Extraction's way of getting a PDF: the file, charged with the paper (convex/extraction/workpoolActions.ts). */
const EXTRACTION: PdfOptions = { maxBytes: MAX_PDF_BYTES, bytes: true, charge: "report", allowHttp: false };
/** In report mode the store only runs its own mutations, which the test backend runs for it. */
const actionsOf = (t: ReturnType<typeof convexTest>) => ({ runMutation: (fn: Parameters<typeof t.mutation>[0], args: Record<string, unknown>) => t.mutation(fn, args as never) }) as unknown as ActionCtx;
/** Requests to the publisher's host and to OpenAlex's content API. */
let publisher: string[] = [];
let content: string[] = [];

beforeEach(() => {
  mockDoStream.mockReset();
  mockDoGenerate.mockReset();
  fakeAutumn.reset();
  fakeStore.reset();
  publisher = [];
  content = [];
  stubPaperStore();
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  const autumn = fakeAutumnFetch();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const stored = await storeAnswer(input, init);
    if (stored) return stored;
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.openalex.org") {
      const work = WORKS[url.pathname.split("/").at(-1)!];
      return work ? new Response(JSON.stringify(work), { status: 200 }) : new Response("{}", { status: 404 });
    }
    if (url.hostname === "content.openalex.org") {
      content.push(url.href);
      // OpenAlex reports a download's cost in credits of $0.0001.
      return url.pathname === "/works/W3.pdf" ? new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf", "x-ratelimit-credits-used": "100" } }) : new Response("Not found", { status: 404 });
    }
    if (url.hostname === "example.org") {
      publisher.push(url.href);
      if (url.href !== PDF) return new Response("<!doctype html><title>Article</title>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } });
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
/** What each paper PDF charge came to, in the order they landed. */
const pdfCharges = (t: Test) => t.run(async (ctx) => (await ctx.db.query("billingUsage").collect()).filter((row) => row.description === "Paper PDF").map((row) => row.credits));
const keep = (key: string) => fakeStore.objects.set(key, new TextEncoder().encode(PDF_BYTES));
/** The key a copy fetched by a link is kept under. */
const byLink = async (url: string) => (await paperKeys({ url }))[0];

/** A chat on a model that reads PDFs, with reading files allowed in it, so a read runs without asking. */
async function chat(t: Test, free = 100_000, inputs = ["text", "image", "file"]) {
  const who = await people(t);
  await t.run((ctx) => seedCreditsForTest(ctx, { userId: who.ada, free }));
  const modelId = await t.run((ctx) =>
    ctx.db.insert("models", { modelId: "mock/model", name: "Mock", provider: "openrouter", inputPricePerMillion: 1, outputPricePerMillion: 2, costMarkup: 1, contextLength: 200_000, supportedParameters: ["tools"], inputModalities: inputs, isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 }),
  );
  const open = async (title: string) => {
    const threadId = await who.asAda.mutation(api.assistant.threads.create, { title, modelId });
    await who.asAda.mutation(api.assistant.spending.setTool, { threadId, tool: "files", allowed: true });
    return threadId;
  };
  return { ...who, threadId: await open("Methods"), open };
}

type Prompt = Array<{ role: string; content: Array<{ type: string; output?: { type: string; value: unknown } }> }>;
/** The tool result a request read for the call with this ID. */
const resultIn = (prompt: Prompt) => prompt.filter((message) => message.role === "tool").flatMap((message) => message.content).find((part) => part.type === "tool-result")?.output;

describe("the paper PDF store", () => {
  it("looks for a copy by OpenAlex ID, then by link, and never for a file from a person's Zotero library", async () => {
    const [byWork, byLink] = await paperKeys({ openalexId: "https://openalex.org/w12", url: PDF });
    expect(byWork).toBe("openalex/W12.pdf");
    expect(byLink).toMatch(/^url\/[0-9a-f]{64}\.pdf$/);
    // Extraction names papers from elsewhere by IDs of its own.
    expect(await paperKeys({ openalexId: "zotero:ABCD", doi: "10.1/x" })).toEqual([]);
    expect(await paperKeys({ openalexId: "W12", url: "zotero://select/users/1/items/ABCD" })).toEqual([]);
  });
});

describe("extraction's PDFs from the store", () => {
  const payer = (jobId: string) => ({ userId: "u" as Id<"users">, workspaceId: "w" as Id<"workspaces">, scope: `extraction:${jobId}`, kind: "extraction" as const });

  it("keeps a copy fetched by a link under that link, so no file a link led to stands in for the paper", async () => {
    const t = convexTest(schema);
    const listed = await paperPdf(actionsOf(t), payer("j1"), { openalexId: "W7", url: PDF }, EXTRACTION);
    expect(listed).toMatchObject({ key: await byLink(PDF), from: "link", credits: 0 });

    const other = "https://example.org/someone-elses.pdf";
    WORKS.W8 = { id: "https://openalex.org/W8", display_name: "Unlisted", locations: [{ pdf_url: PDF }] };
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => ((input instanceof Request ? input.url : String(input)) === other ? new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } }) : answer(input, init)));
    const unlisted = await paperPdf(actionsOf(t), payer("j1"), { openalexId: "W8", url: other }, EXTRACTION);
    expect(unlisted).toMatchObject({ from: "link" });
    expect("key" in unlisted && unlisted.key).toMatch(/^url\//);
    expect(fakeStore.kept.some((key) => key.startsWith("openalex/"))).toBe(false);
  });

  it("charges an extraction once for a stored copy, with the paper's own charge", async () => {
    const t = convexTest(schema);
    keep("openalex/W1.pdf");
    expect(await paperPdf(actionsOf(t), payer("j2"), { openalexId: "W1" }, EXTRACTION)).toMatchObject({ from: "stored", credits: STORED_PDF_CREDITS });
    expect(await paperPdf(actionsOf(t), payer("j2"), { openalexId: "W1" }, EXTRACTION)).toMatchObject({ from: "stored", credits: 0 });
    expect(await paperPdf(actionsOf(t), payer("j3"), { openalexId: "W1" }, EXTRACTION)).toMatchObject({ credits: STORED_PDF_CREDITS });
    // The paper's charge carries it: the store charges nothing itself.
    expect(await pdfCharges(t)).toEqual([]);
  });

  it("doesn't fetch a plain-HTTP link for extraction", async () => {
    const t = convexTest(schema);
    const got = await paperPdf(actionsOf(t), payer("j4"), { url: "http://example.org/loot-boxes.pdf" }, EXTRACTION);
    expect(got).toMatchObject({ error: expect.any(String) });
    expect(publisher).toEqual([]);
  });

  it("has a second read wait while the first pays, read for nothing once it has, and take over a payment that never finished", async () => {
    const t = convexTest(schema);
    const claim = () => t.mutation(internal.lib.paperPdfs.claim, { scope: "chat:x", key: "openalex/W1.pdf" });
    expect(await claim()).toBe("pay");
    expect(await claim()).toBe("wait");
    await t.mutation(internal.lib.paperPdfs.unclaim, { scope: "chat:x", key: "openalex/W1.pdf" });
    expect(await claim()).toBe("pay");
    await t.mutation(internal.lib.paperPdfs.had, { scope: "chat:x", key: "openalex/W1.pdf" });
    expect(await claim()).toBe("had");
    // A payment begun long ago and never finished is this read's.
    await t.run(async (ctx) => ctx.db.insert("paperPdfReads", { scope: "chat:y", key: "openalex/W1.pdf", had: false, at: Date.now() - 10 * 60_000 }));
    expect(await t.mutation(internal.lib.paperPdfs.claim, { scope: "chat:y", key: "openalex/W1.pdf" })).toBe("pay");
  });
});

describe("reading a paper's PDF", () => {
  it("keeps a PDF fetched by its own link in the store, for nothing, and refuses a paper with no PDF and no copy", async () => {
    const t = convexTest(schema);
    const { asAda } = await chat(t);

    expect(await asAda.action(api.research.papers.readPdf, { id: "W1" })).toMatchObject({ title: "Loot boxes and problem gambling", paperPdf: PDF, stored: await byLink(PDF) });
    expect(fakeStore.kept).toEqual([await byLink(PDF)]);
    expect(await pdfCharges(t)).toEqual([]);
    await expect(asAda.action(api.research.papers.readPdf, { id: "W2" })).rejects.toThrow(/attach its PDF/);
    // OpenAlex said it has no copy, so none was bought.
    expect(content).toEqual([]);
  });

  it("buys OpenAlex's copy when the paper's own link fails, charging what OpenAlex reports, and serves it from the store after", async () => {
    const t = convexTest(schema);
    const { asAda } = await chat(t);

    expect(await asAda.action(api.research.papers.readPdf, { id: "W3" })).toMatchObject({ stored: "openalex/W3.pdf" });
    expect(content).toEqual(["https://content.openalex.org/works/W3.pdf?api_key=platform-key"]);
    expect(fakeStore.kept).toEqual(["openalex/W3.pdf"]);
    // 100 OpenAlex credits are $0.01, which a stored copy costs too.
    expect(await pdfCharges(t)).toEqual([STORED_PDF_CREDITS]);

    // A read outside a chat pays each time, and the copy comes from the store. It leaves no record behind.
    await asAda.action(api.research.papers.readPdf, { id: "W3" });
    expect(content).toHaveLength(1);
    expect(await pdfCharges(t)).toEqual([STORED_PDF_CREDITS, STORED_PDF_CREDITS]);
    expect(await t.run((ctx) => ctx.db.query("paperPdfReads").collect())).toEqual([]);
  });

  it("has a chat pay once for a stored copy, however often it reads it, and another chat pay again", async () => {
    const t = convexTest(schema);
    // A reply holds what its request may cost, at the mock's high price, beside what the read charges.
    keep("openalex/W1.pdf");
    const { asAda, threadId, open } = await chat(t, 100_000_000);
    const read = async (thread: Id<"assistantThreads">) => {
      mockDoStream.mockImplementationOnce(callingDoStream({ id: `pdf-${mockDoStream.mock.calls.length}`, name: "research_papers_readPdf", input: { id: "W1" } })).mockImplementationOnce(finishingDoStream(["It reports a link (p. 5)."]));
      await asAda.mutation(api.assistant.replies.send, { threadId: thread, text: "What are this paper's methods?" });
      await replied(t, thread);
    };

    await read(threadId);
    await read(threadId);
    expect(await pdfCharges(t)).toEqual([STORED_PDF_CREDITS]);
    await read(await open("Another"));
    expect(await pdfCharges(t)).toEqual([STORED_PDF_CREDITS, STORED_PDF_CREDITS]);
    // Every read came from the store.
    expect(publisher).toEqual([]);

    // A deleted chat's record of what it paid for goes with it.
    const reads = () => t.run(async (ctx) => (await ctx.db.query("paperPdfReads").collect()).map((row) => row.scope));
    expect(await reads()).toContain(`chat:${threadId}`);
    await asAda.mutation(api.assistant.threads.remove, { threadId });
    await waitFor(async () => !(await reads()).includes(`chat:${threadId}`));
    expect(await reads()).toHaveLength(1);
  });

  it("has a chat that fetched a paper by its link read it from the store after for nothing", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t, 100_000_000);
    for (const id of ["pdf-1", "pdf-2"]) {
      mockDoStream.mockImplementationOnce(callingDoStream({ id, name: "research_papers_readPdf", input: { id: "W1" } })).mockImplementationOnce(finishingDoStream(["It reports a link (p. 5)."]));
      await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
      await replied(t, threadId);
    }
    // The first read fetched it by its link, and the second found it in the store.
    expect(publisher).toEqual([PDF]);
    expect(await pdfCharges(t)).toEqual([]);
  });

  it("never fetches a private address, at first or after a redirect, and takes a signature split across chunks", async () => {
    const t = convexTest(schema);
    const { asAda } = await chat(t);
    WORKS.W4 = { id: "https://openalex.org/W4", display_name: "Internal", best_oa_location: { pdf_url: "http://127.0.0.1/paper.pdf" }, has_content: { pdf: false } };
    WORKS.W5 = { id: "https://openalex.org/W5", display_name: "Redirected", best_oa_location: { pdf_url: "https://example.org/moved.pdf" }, has_content: { pdf: false } };
    WORKS.W6 = { id: "https://openalex.org/W6", display_name: "Chunked", best_oa_location: { pdf_url: "https://example.org/chunked.pdf" } };
    const fetched: string[] = [];
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      if (url === "https://example.org/moved.pdf") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      if (url === "https://example.org/chunked.pdf") {
        const parts = ["%P", "DF-1.7\n", "1 0 obj"].map((part) => new TextEncoder().encode(part));
        return new Response(new ReadableStream({ pull: (controller) => (parts.length ? controller.enqueue(parts.shift()!) : controller.close()) }), { status: 200, headers: { "content-type": "application/pdf" } });
      }
      return answer(input, init);
    });

    await expect(asAda.action(api.research.papers.readPdf, { id: "W4" })).rejects.toThrow(/attach its PDF/);
    await expect(asAda.action(api.research.papers.readPdf, { id: "W5" })).rejects.toThrow(/attach its PDF/);
    expect(fetched.some((url) => url.includes("127.0.0.1") || url.includes("169.254.169.254"))).toBe(false);
    expect(await asAda.action(api.research.papers.readPdf, { id: "W6" })).toMatchObject({ paperPdf: "https://example.org/chunked.pdf", stored: await byLink("https://example.org/chunked.pdf") });
  });

  it("reads nothing when the title it was asked about isn't the ID's paper", async () => {
    const t = convexTest(schema);
    const { asAda } = await chat(t);
    await expect(asAda.action(api.research.papers.readPdf, { id: "W1", title: "Video games and wellbeing" })).rejects.toThrow(/Loot boxes and problem gambling.{0,4} in OpenAlex/);
    expect(publisher).toEqual([]);
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

  it("asks first, with what a stored copy may cost, and once allowed, the reply goes on with the PDF in view", async () => {
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
    expect(asking[0].credits).toBeGreaterThan(STORED_PDF_CREDITS);

    await asAda.mutation(api.assistant.replies.answer, { threadId, stepId: asking[0]._id, allow: true });
    await replied(t, threadId);
    expect(JSON.stringify(resultIn(mockDoStream.mock.lastCall![0].prompt as Prompt))).toContain(`"url":"${storedAddress(await byLink(PDF))}?`);
  });

  it("sends the model a link to the stored copy in the reply that read it, and only a note in later replies", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t);
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "pdf-1", name: "research_papers_readPdf", input: { id: "W1" } }))
      .mockImplementationOnce(finishingDoStream(["It reports a link (p. 5)."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What are this paper's methods?" });
    await replied(t, threadId);

    const read = JSON.stringify(resultIn(mockDoStream.mock.lastCall![0].prompt as Prompt));
    // A signed link to the copy, and none of its bytes: "JVBERi0" is how "%PDF-" starts in base64.
    expect(read).toContain(`"url":"${storedAddress(await byLink(PDF))}?`);
    expect(read).toContain("X-Amz-Signature");
    expect(read).not.toContain("JVBERi0");
    // The model reads the address it cites, not where the copy is kept.
    expect(read).not.toContain('\\"stored\\"');
    // The step keeps the paper's own address, which the reply's page citations open.
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

  it("sends the stored file itself when the provider refuses the request with its link, and the reply goes on", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chat(t);
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
    expect(read).not.toContain(storedAddress(await byLink(PDF)));
    const replies = (await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { numItems: 20, cursor: null } })).page.filter((item) => item.role === "assistant");
    expect(replies).toMatchObject([{ status: "done", text: "It reports a link (p. 5)." }]);
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
    expect(JSON.stringify(mockDoGenerate.mock.lastCall![0].prompt)).toContain(`"url":"${storedAddress(await byLink(PDF))}?`);
  });
});
