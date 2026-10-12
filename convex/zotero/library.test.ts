// The person's own Zotero library, as the assistant reads it and starts jobs from it (#328):
// through their connected account, with every key and group checked before Zotero is asked.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { encrypt } from "../lib/crypto";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { setupExtractionPaperWorkpool } from "../extraction/queue/workpool.test-support";
import { ensureWorkspace } from "../workspaces/create";
import { PDFDocument } from "@cantoo/pdf-lib";

const KEY = "0".repeat(64);
let requests: URL[] = [];
const item = (i: number) => ({ key: `ITEM000${i}`, data: { title: `Zotero paper ${i}`, abstractNote: "x".repeat(900), creators: [{ creatorType: "author", firstName: "Ada", lastName: "Okafor" }], date: "2021", DOI: `10.1/${i}`, itemType: "journalArticle", publicationTitle: "A journal" }, meta: { numChildren: 0 } });
let pdfBytes: Uint8Array;
const zotero = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push(url);
  const json = (body: unknown, total: number) => new Response(JSON.stringify(body), { status: 200, headers: { "Total-Results": String(total) } });
  // The first item has a PDF attached, the second none.
  if (url.pathname.endsWith("/items/ITEM0001/children")) return json([{ key: "ATTACH01", data: { itemType: "attachment", contentType: "application/pdf" }, links: { enclosure: { href: "https://api.zotero.org/users/15294942/items/ATTACH01/file" } } }], 1);
  if (url.pathname.endsWith("/items/ITEM0002/children")) return json([], 0);
  if (url.pathname.endsWith("/items/ATTACH01/file")) return new Response(pdfBytes.slice().buffer, { status: 200, headers: { "Content-Type": "application/pdf" } });
  if (/\/items\/ITEM000\d$/.test(url.pathname)) return json({ key: "ITEM0001", data: { title: "Zotero paper 1" } }, 1);
  if (url.pathname.endsWith("/groups")) return json([{ id: 4719820, data: { name: "Lab", type: "Private" }, meta: { numItems: 12 } }], 1);
  // Every level at once, more than one page of them.
  if (url.pathname.endsWith("/collections")) return json([{ key: "ABCD1234", data: { name: "Trials", parentCollection: false }, meta: { numItems: 3, numCollections: 1 } }, { key: "EFGH5678", data: { name: "Pilots", parentCollection: "ABCD1234" }, meta: { numItems: 1, numCollections: 0 } }], 150);
  const start = Number(url.searchParams.get("start") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const all = [1, 2, 3].map(item);
  return json(all.slice(start, start + limit), all.length);
});

beforeEach(() => {
  requests = [];
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  vi.stubGlobal("fetch", zotero);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { clerkId: "ada", email: "ada@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("zoteroConnections", { userId: id, zoteroUserId: "15294942", encryptedApiKey: encrypt("zotero-key", KEY), keyPrefix: "zot...", username: "ada", connectedAt: 1 });
    return id;
  });
  return { t, userId, ada: t.withIdentity({ subject: "ada" }) };
}

describe("the person's Zotero library, read for the assistant", () => {
  it("reads their groups, collections and a page of items, and refuses a key or a group in the wrong form before asking Zotero", async () => {
    const { ada } = await setup();
    expect(await ada.action(api.zotero.library.groups, {})).toEqual({ groups: [{ id: "4719820", name: "Lab", type: "Private", items: 12 }] });
    // One page of Zotero's a read, never the whole tree.
    requests = [];
    expect(await ada.action(api.zotero.library.collections, {})).toEqual({ collections: [{ key: "ABCD1234", name: "Trials", items: 3, subcollections: 1 }, { key: "EFGH5678", name: "Pilots", parent: "ABCD1234", items: 1, subcollections: 0 }], next: 2 });
    expect(requests.map((url) => url.pathname)).toEqual(["/users/15294942/collections"]);
    const page = await ada.action(api.zotero.library.items, { collectionKey: "ABCD1234", limit: 2 });
    expect(page).toMatchObject({ next: 2, items: [{ key: "ITEM0001", title: "Zotero paper 1", authors: ["Ada Okafor"], year: 2021, doi: "10.1/1", venue: "A journal", type: "journalArticle", pdf: false }, { key: "ITEM0002" }] });
    expect(page.items[0].abstract).toHaveLength(601);
    requests = [];
    await expect(ada.action(api.zotero.library.items, { collectionKey: "abc/../../keys" })).rejects.toThrow(/eight capital letters and digits/);
    await expect(ada.action(api.zotero.library.collections, { groupId: "1/items" })).rejects.toThrow(/by its number/);
    expect(requests).toEqual([]);
  });

  it("starts an extraction on a range of a Zotero collection, each of its items a source", async () => {
    const { t, userId, ada } = await setup();
    setupExtractionPaperWorkpool(t);
    await t.run(async (ctx) => {
      for (const key of ["extraction.enabled", "extraction.start"]) await ctx.db.insert("featureFlags", { key, enabled: true, updatedAt: 1 });
      await seedCreditsForTest(ctx, { userId, free: 100_000 });
      await ctx.db.insert("models", { modelId: SERVER_MODEL_SLUG, name: "Server model", provider: "test", inputPricePerMillion: 0.1, outputPricePerMillion: 0.5, costMarkup: 1.3, isServed: true, sortOrder: 1, supportedParameters: ["structured_outputs"], syncedAt: 1, createdAt: 1, updatedAt: 1 });
    });
    const { jobId } = await ada.action(api.extraction.start.extract, { name: "Sample sizes", set: { kind: "zotero", collectionKey: "ABCD1234" }, first: 2, last: 3, questions: [{ question: "What was the sample size?", type: "number" }] });
    // One source for the range, read through the person's Zotero as the job is set up, one page of Zotero's a step.
    const sources = await t.run((ctx) => ctx.db.query("extractionJobSources").withIndex("by_job_and_position", (q) => q.eq("jobId", jobId)).collect());
    expect(sources).toMatchObject([{ source: "zotero", sourceRefId: "ABCD1234", libraryType: "user", collectionKey: "ABCD1234", zoteroSet: { first: 2, last: 3 } }]);
    requests = [];
    await t.action(internal.extraction.actions.setupExtractionQueueJob, { jobId, expectedEpoch: 0 });
    const papers = await t.run((ctx) => ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
    expect(papers.map((paper) => [paper.openalexId, paper.title]).sort()).toEqual([["zotero:user:ITEM0002", "Zotero paper 2"], ["zotero:user:ITEM0003", "Zotero paper 3"]]);
    // Only that collection's own items, from the second, two of them: never the whole library. In the order they were added, which an item edited while the job reads doesn't change.
    expect([...new Set(requests.map((url) => `${url.pathname}?start=${url.searchParams.get("start")}&limit=${url.searchParams.get("limit")}&sort=${url.searchParams.get("sort")}&direction=${url.searchParams.get("direction")}`))]).toEqual(["/users/15294942/collections/ABCD1234/items/top?start=1&limit=2&sort=dateAdded&direction=asc"]);
  });

  it("puts an item's PDF in the chat as one of its files, and says when an item has none", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    pdfBytes = await pdf.save();
    const { t, userId } = await setup();
    const { workspaceId, stepId, threadId } = await t.run(async (ctx) => {
      const workspaceId = await ensureWorkspace(ctx, { kind: "personal", userId });
      const threadId = await ctx.db.insert("assistantThreads", { workspaceId, createdBy: userId, title: "Chat", agentThreadId: "agent", lastMessageAt: 1, createdAt: 1, updatedAt: 1 });
      const stepId = await ctx.db.insert("assistantSteps", { threadId, workspaceId, order: 0, userId, toolCallId: "call", path: "zotero/library:pdf", input: "{}", status: "running", startedAt: 1 });
      return { workspaceId, stepId, threadId };
    });
    const put = await t.action(internal.zotero.library.pdfForAssistant, { userId, workspaceId, key: "ITEM0001", fromStep: stepId });
    expect(put).toMatchObject({ name: "Zotero paper 1.pdf", pages: 2 });
    // The chat's own file, which the assistant reads by pages as one the person attached.
    expect(await t.run((ctx) => ctx.db.get("assistantFiles", put.file))).toMatchObject({ threadId, userId, mediaType: "application/pdf", state: "sent", pages: 2, bytes: pdfBytes.length });
    await expect(t.action(internal.zotero.library.pdfForAssistant, { userId, workspaceId, key: "ITEM0002", fromStep: stepId })).rejects.toThrow(/no PDF attached/);
    // An item key in the wrong form is refused before Zotero is asked.
    requests = [];
    expect(await t.query(internal.assistant.asking.check, { userId, workspaceId, path: "zotero/library:pdf", input: JSON.stringify({ key: "../keys" }) })).toMatch(/eight capital letters/);
    expect(requests).toEqual([]);
  });
});
