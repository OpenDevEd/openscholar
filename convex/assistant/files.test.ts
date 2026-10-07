/// <reference types="vite/client" />
// Files attached to assistant chats (#647): who an upload belongs to, what a message carries
// to the model, what expires, and what goes when a chat goes.
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { FILE_IDLE_MS } from "../../lib/assistant/files";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { people } from "./assistant.test-support";
import { MODEL_READS } from "./steps";
import { callingDoStream, finishingDoStream, waitFor } from "./turn.test-support";

const { mockDoStream, fetchMock } = vi.hoisted(() => ({ mockDoStream: vi.fn(), fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);

// The model every reply runs on, in place of OpenRouter.
vi.mock("../ai/provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async () => ({ model: new MockLanguageModelV3({ modelId: "mock/model", doStream: mockDoStream }), modelSlug: "mock/model", pricing: { input: 1_000, output: 2_000 } }),
  };
});

beforeEach(() => {
  mockDoStream.mockReset();
  mockDoStream.mockImplementation(finishingDoStream(["Seen"]));
  fetchMock.mockReset();
  fakeAutumn.reset();
  fetchMock.mockImplementation(fakeAutumnFetch());
});

type Test = ReturnType<typeof convexTest>;
type Person = Awaited<ReturnType<typeof people>>["asAda"];

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

/** A model the assistant can run on, taking `inputs`. */
const model = (t: Test, inputs: string[]) =>
  t.run(async (ctx) =>
    ctx.db.insert("models", {
      modelId: `mock/${inputs.join("-")}`,
      name: inputs.includes("image") ? "Sees Model" : "Text Model",
      provider: "openrouter",
      inputPricePerMillion: 1_000,
      outputPricePerMillion: 2_000,
      costMarkup: 1,
      contextLength: 200_000,
      supportedParameters: ["tools"],
      inputModalities: inputs,
      isServed: true,
      sortOrder: 0,
      syncedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

/** Starts an upload as the person's browser does: a token of its own, whose digest makes the file's row. */
async function start(as: Person, name = "figure.png") {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { fileId } = await as.mutation(api.assistant.files.startUpload, { name, digest: await digestOpaqueToken(token) });
  return { fileId, token };
}
const post = (t: Test, token: string, bytes: Uint8Array, type = "image/png") => t.fetch(`/assistant/upload?token=${token}`, { method: "POST", headers: { "Content-Type": type }, body: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
const storedFiles = (t: Test) => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);

/** Uploads an image as the person's browser does: the row first, then the bytes with the token. */
async function attach(t: Test, as: Person, bytes = PNG) {
  const { fileId, token } = await start(as);
  expect((await post(t, token, bytes)).status).toBe(200);
  const storageId = (await t.run((ctx) => ctx.db.get("assistantFiles", fileId)))!.storageId!;
  return { fileId, storageId };
}

async function chatOn(t: Test, inputs: string[]) {
  const who = await people(t);
  await t.run((ctx) => seedCreditsForTest(ctx, { userId: who.ada, free: 100_000 }));
  const modelId = await model(t, inputs);
  const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Figures", modelId });
  return { ...who, threadId };
}

const replied = (t: Test, threadId: Id<"assistantThreads">) => waitFor(async () => !(await t.run((ctx) => ctx.db.get("assistantThreads", threadId)))?.reply);
/** The parts of the last person's message the model was sent. */
const lastUserParts = () => {
  const prompt = mockDoStream.mock.lastCall![0].prompt as Array<{ role: string; content: Array<{ type: string; data?: unknown; text?: string }> }>;
  return prompt.filter((message) => message.role === "user").at(-1)!.content;
};

describe("attaching a file", () => {
  it("stores the bytes for the token's row, once, and nothing for a token that isn't one", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const { fileId, token } = await start(asAda);

    expect((await post(t, "not-a-token", PNG)).status).toBe(410);
    expect(await storedFiles(t)).toBe(0);
    expect((await post(t, token, PNG)).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ state: "pending", mediaType: "image/png", bytes: PNG.length });
    // The token can't be used again, so nothing else can be stored for the file.
    expect((await post(t, token, PNG)).status).toBe(410);
    expect(await storedFiles(t)).toBe(1);
  });

  it("refuses bytes that aren't an image, and the file with them", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const { fileId, token } = await start(asAda, "notes.txt");

    expect((await post(t, token, new TextEncoder().encode("hello"), "image/png")).status).toBe(400);
    expect(await storedFiles(t)).toBe(0);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toBeNull();
  });

  it("keeps nothing of a file removed while its bytes were on the way", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const { fileId, token } = await start(asAda);

    await asAda.mutation(api.assistant.files.remove, { fileId });
    expect((await post(t, token, PNG)).status).toBe(410);
    expect(await storedFiles(t)).toBe(0);

    // Removed after its token was taken and before its bytes were bound: the bytes stored for it go.
    const late = await start(asAda);
    await t.mutation(internal.assistant.files.redeem, { digest: await digestOpaqueToken(late.token) });
    await asAda.mutation(api.assistant.files.remove, { fileId: late.fileId });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: "image/png" })));
    expect(await t.mutation(internal.assistant.files.bind, { fileId: late.fileId, storageId, bytes: PNG.length, mediaType: "image/png" })).toBe(false);
    expect(await storedFiles(t)).toBe(0);
  });

  it("lets a file left unsent for an hour make room once the person has 20 waiting", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const t = convexTest(schema);
      const { asAda } = await people(t);
      const first = await start(asAda, "first.png");
      for (let i = 1; i < 20; i += 1) await start(asAda, `f${i}.png`);
      await expect(start(asAda, "one-more.png")).rejects.toThrow(/up to 20 files/);

      vi.advanceTimersByTime(61 * 60 * 1000);
      await start(asAda, "one-more.png");
      expect(await t.run((ctx) => ctx.db.get("assistantFiles", first.fileId))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows as many uploads an hour as the person's plan", async () => {
    const t = convexTest(schema);
    const { asAda, ada } = await people(t);
    await t.run(async (ctx) => {
      await seedCreditsForTest(ctx, { userId: ada, free: 10 });
      const account = await ctx.db.query("billingAccounts").withIndex("by_user", (q) => q.eq("userId", ada)).unique();
      await ctx.db.patch("billingAccounts", account!._id, { limits: { uploads_per_hour: 2 } });
    });
    await start(asAda, "a.png");
    await start(asAda, "b.png");
    await expect(start(asAda, "c.png")).rejects.toThrow(/2 files an hour/);
  });
});

describe("sending files", () => {
  it("sends an image to the model as its bytes, and an expired one as a note", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image"]);
    const { fileId, storageId } = await attach(t, asAda);

    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What does this show?", files: [fileId] });
    await replied(t, threadId);
    const image = lastUserParts().find((part) => part.type === "file");
    expect(image?.data).toBeInstanceOf(Uint8Array);
    expect((image!.data as Uint8Array).length).toBe(PNG.length);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ state: "sent", threadId });

    // Unread for 30 days, it loses its bytes; the next reply is told it expired, and the chat shows it without a picture.
    await t.run((ctx) => ctx.db.patch("assistantFiles", fileId, { usedAt: Date.now() - FILE_IDLE_MS - 1 }));
    await t.mutation(internal.assistant.files.expire, {});
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);

    await asAda.mutation(api.assistant.replies.send, { threadId, text: "And again?" });
    await replied(t, threadId);
    const earlier = (mockDoStream.mock.lastCall![0].prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>).filter((message) => message.role === "user")[0]!.content;
    expect(earlier.some((part) => part.type === "file")).toBe(false);
    expect(earlier.some((part) => part.type === "text" && /expired/.test(part.text ?? ""))).toBe(true);
    const { page } = await asAda.query(api.assistant.replies.messages, { threadId, paginationOpts: { cursor: null, numItems: 20 } });
    expect(page.find((item) => item.role === "user" && "files" in item && item.files)).toMatchObject({ files: [{ id: fileId, url: null }] });
  });

  it("tells a model that takes no images about the ones already in the chat, instead of sending them", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image"]);
    const { fileId } = await attach(t, asAda);
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What does this show?", files: [fileId] });
    await replied(t, threadId);

    await asAda.mutation(api.assistant.threads.setModel, { threadId, modelId: await model(t, ["text"]) });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "And now?" });
    await replied(t, threadId);
    const earlier = (mockDoStream.mock.lastCall![0].prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>).filter((message) => message.role === "user")[0]!.content;
    expect(earlier.some((part) => part.type === "file")).toBe(false);
    expect(earlier.some((part) => part.type === "text" && /can't see images/.test(part.text ?? ""))).toBe(true);
  });

  it("refuses files in a chat whose model reads no images", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text"]);
    const { fileId } = await attach(t, asAda);

    await expect(asAda.mutation(api.assistant.replies.send, { threadId, text: "Look", files: [fileId] })).rejects.toThrow(/can't read images/);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ state: "pending" });
  });

  it("deletes a chat's files with the chat", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image"]);
    const { fileId, storageId } = await attach(t, asAda);
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Keep this", files: [fileId] });
    await replied(t, threadId);

    await asAda.mutation(api.assistant.threads.remove, { threadId });
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);
  });
});

/** A PDF of `pages` pages, each saying which it is. */
async function pdfOf(pages: number) {
  const { PDFDocument, StandardFonts } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i += 1) doc.addPage().drawText(`Page ${i}`, { x: 50, y: 700, font, size: 24 });
  return await doc.save();
}
/** Posts a PDF's bytes to the upload route as the browser does, in `parts` pieces, and returns the last answer. */
async function postPdf(t: Test, token: string, bytes: Uint8Array, parts = 1) {
  const size = Math.ceil(bytes.length / parts);
  let answer: Response | undefined;
  for (let part = 0; part < parts; part += 1) {
    const body = new Blob([bytes.slice(part * size, (part + 1) * size) as Uint8Array<ArrayBuffer>]);
    answer = await t.fetch(`/assistant/upload?token=${token}&part=${part}${part === parts - 1 ? "&last=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body });
    if (!answer.ok) return answer;
  }
  return answer!;
}

/** Starts a PDF's upload as the browser does: a token of its own, whose digest makes the file's row. */
async function startPdf(as: Person, bytes: Uint8Array) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { fileId } = await as.mutation(api.assistant.files.startUpload, { name: "trial.pdf", digest: await digestOpaqueToken(token), pdfBytes: bytes.length });
  return { fileId, token };
}

/** Attaches a PDF as the browser does: its row, then its bytes, in parts, to the upload route. */
async function attachPdf(t: Test, as: Person, bytes: Uint8Array) {
  const { fileId, token } = await startPdf(as, bytes);
  const answer = await postPdf(t, token, bytes);
  expect(answer.status).toBe(200);
  return { fileId, ...((await answer.json()) as { pages: number }) };
}

describe("PDFs and text files (#648)", () => {
  it("joins a PDF sent in parts, counts its pages, and keeps none of the parts", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const bytes = await pdfOf(3);
    const { fileId, token } = await startPdf(asAda, bytes);
    const answer = await postPdf(t, token, bytes, 3);
    expect(await answer.json()).toEqual({ fileId, pages: 3 });
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ pages: 3, bytes: bytes.length, mediaType: "application/pdf", storageId: expect.any(String) });
    expect(await storedFiles(t)).toBe(1);
    // The token is spent with the last part.
    expect((await postPdf(t, token, bytes)).status).toBe(410);
  });

  it("deletes the parts of a PDF removed while it uploads, and of one that doesn't open", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const bytes = await pdfOf(2);
    const { fileId, token } = await startPdf(asAda, bytes);
    const half = Math.ceil(bytes.length / 2);
    const first = await t.fetch(`/assistant/upload?token=${token}&part=0`, { method: "POST", body: new Blob([bytes.slice(0, half) as Uint8Array<ArrayBuffer>]) });
    expect(first.status).toBe(200);
    expect(await storedFiles(t)).toBe(1);
    await asAda.mutation(api.assistant.files.remove, { fileId });
    expect(await storedFiles(t)).toBe(0);
    const second = await t.fetch(`/assistant/upload?token=${token}&part=1&last=1`, { method: "POST", body: new Blob([bytes.slice(half) as Uint8Array<ArrayBuffer>]) });
    expect(second.status).toBe(410);

    const junk = new TextEncoder().encode("not a pdf");
    const broken = await startPdf(asAda, junk);
    const refused = await postPdf(t, broken.token, junk);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: expect.stringMatching(/can't be opened/) });
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", broken.fileId))).toBeNull();
    expect(await storedFiles(t)).toBe(0);
  });

  it("takes a PDF's parts only in order", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const bytes = await pdfOf(2);
    const { token } = await startPdf(asAda, bytes);
    const skipped = await t.fetch(`/assistant/upload?token=${token}&part=1`, { method: "POST", body: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
    expect(skipped.status).toBe(410);
    expect(await storedFiles(t)).toBe(0);
  });

  it("reads the pages asked for into a PDF of their own, kept with the chat", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image", "file"]);
    const { fileId } = await attachPdf(t, asAda, await pdfOf(5));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Read this", files: [fileId] });
    await replied(t, threadId);
    // Unused long enough to expire: the read keeps it, and its pages' citations with it.
    await t.run((ctx) => ctx.db.patch("assistantFiles", fileId, { usedAt: Date.now() - FILE_IDLE_MS - 1 }));

    const read = await asAda.action(api.assistant.files.read, { file: fileId, range: "2-4" });
    await t.mutation(internal.assistant.files.expire, {});
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toMatchObject({ state: "sent", storageId: expect.any(String) });
    // A reply that cites it finds it by the ID the citation names, without the message that carried it; anything else isn't found.
    const cited = await asAda.query(api.assistant.files.cited, { threadId, fileIds: [fileId, read.pdfPages!, "not-an-id"] });
    expect(cited).toEqual([{ id: fileId, name: "trial.pdf", url: expect.any(String) }]);
    expect(read).toMatchObject({ file: fileId, pages: "2-4", of: 5 });
    // The same pages read again are the ones already cut, not another copy.
    expect((await asAda.action(api.assistant.files.read, { file: fileId, range: "2-4" })).pdfPages).toBe(read.pdfPages);
    const part = await t.run((ctx) => ctx.db.get("assistantFiles", read.pdfPages!));
    expect(part).toMatchObject({ parentId: fileId, range: "2-4", threadId, state: "sent" });
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const bytes = new Uint8Array(await t.run(async (ctx) => await (await ctx.storage.get(part!.storageId!))!.arrayBuffer()));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    // A range outside the PDF is refused with how many pages it has.
    await expect(asAda.action(api.assistant.files.read, { file: fileId, range: "6-8" })).rejects.toThrow(/has 5 pages/);
  });

  it("reads a text file by lines, as many whole lines as fit, and says where it stopped", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text"]);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { fileId } = await asAda.mutation(api.assistant.files.startUpload, { name: "rows.csv", digest: await digestOpaqueToken(token), text: "text/csv" });
    // Tabs and quotes take more room in the result the model is sent than in the file; the last line is longer than a read.
    const rows = ["id\tquote", ...Array.from({ length: 2_000 }, (_, i) => `${i + 1}\t"${"\t".repeat(10)}"`), "x".repeat(40_000)].join("\n");
    const response = await t.fetch(`/assistant/upload?token=${token}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: rows });
    expect(await response.json()).toMatchObject({ fileId, lines: 2_002 });
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "Look at this", files: [fileId] });
    await replied(t, threadId);

    const read = await asAda.action(api.assistant.files.read, { file: fileId, range: "1-2001" });
    const last = Number(read.lines!.split("-")[1]);
    expect(read.text!.split("\n")).toHaveLength(last);
    expect(read.text!.split("\n")[0]).toBe("id\tquote");
    expect(last).toBeLessThan(2_001);
    // Every line it says it read reaches the model whole.
    expect(JSON.stringify(read).length).toBeLessThanOrEqual(MODEL_READS);

    const long = await asAda.action(api.assistant.files.read, { file: fileId, range: "2002" });
    expect(long).toMatchObject({ lines: "2002" });
    expect(long.text).toMatch(/longer than one read returns/);
    expect(JSON.stringify(long).length).toBeLessThanOrEqual(MODEL_READS);
  });

  it("refuses bytes that aren't text for a text file", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { fileId } = await asAda.mutation(api.assistant.files.startUpload, { name: "notes.txt", digest: await digestOpaqueToken(token), text: "text/plain" });
    expect((await post(t, token, new Uint8Array([0xff, 0xfe, 0x00, 0x41]), "text/plain")).status).toBe(400);
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", fileId))).toBeNull();
  });

  it("sends the pages a read cut to the model as the PDF itself, on the reply's next request", async () => {
    const t = convexTest(schema);
    const { asAda, threadId } = await chatOn(t, ["text", "image", "file"]);
    const { fileId } = await attachPdf(t, asAda, await pdfOf(4));
    // Reading files runs without asking in this chat, so the call goes straight through.
    await asAda.mutation(api.assistant.spending.setTool, { threadId, tool: "files", allowed: true });
    mockDoStream
      .mockImplementationOnce(callingDoStream({ id: "read-1", name: "assistant_files_read", input: { file: fileId, range: "1-2" } }))
      .mockImplementation(finishingDoStream(["It says page 1."]));
    await asAda.mutation(api.assistant.replies.send, { threadId, text: "What does it say?", files: [fileId] });
    await replied(t, threadId);

    const prompt = mockDoStream.mock.lastCall![0].prompt as Array<{ role: string; content: Array<{ type: string; output?: { type: string; value: Array<{ type: string; mediaType?: string }> } }> }>;
    const result = prompt.filter((message) => message.role === "tool").flatMap((message) => message.content).find((part) => part.type === "tool-result");
    expect(result?.output?.type).toBe("content");
    expect(result!.output!.value.some((item) => item.mediaType === "application/pdf")).toBe(true);
  });
});
