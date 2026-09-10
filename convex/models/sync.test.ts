/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { transformModel } from "./sync";

const RAW_BASE = {
  id: "anthropic/claude-sonnet-4.5",
  name: "Claude Sonnet 4.5",
  pricing: {
    prompt: "0.000003",
    completion: "0.000015",
  },
} as const;

describe("transformModel — webSearchPrice unit", () => {
  it("treats pricing.web_search as dollars per call (not per token)", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { ...RAW_BASE.pricing, web_search: "0.01" },
    });
    expect(out).not.toBeNull();
    expect(out!.webSearchPrice).toBe(0.01);
  });

  it("preserves the exact $/call value for native search-preview models", () => {
    const out = transformModel({
      ...RAW_BASE,
      id: "openai/gpt-4o-mini-search-preview",
      pricing: { ...RAW_BASE.pricing, web_search: "0.0275" },
    });
    expect(out!.webSearchPrice).toBe(0.0275);
  });

  it("maps a $0 web_search to 0 (free, e.g., Firecrawl pass-through)", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { ...RAW_BASE.pricing, web_search: "0" },
    });
    expect(out!.webSearchPrice).toBe(0);
  });

  it("returns undefined when pricing.web_search is missing", () => {
    const out = transformModel({ ...RAW_BASE });
    expect(out!.webSearchPrice).toBeUndefined();
  });

  it("returns undefined for the meta-model '-1' sentinel", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { ...RAW_BASE.pricing, web_search: "-1" },
    });
    expect(out!.webSearchPrice).toBeUndefined();
  });
});

describe("transformModel — token pricing unchanged", () => {
  it("still multiplies prompt/completion by 1M (per-token → per-million)", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { prompt: "0.000003", completion: "0.000015" },
    });
    expect(out!.inputPricePerMillion).toBe(3);
    expect(out!.outputPricePerMillion).toBe(15);
  });
});

const modules = import.meta.glob("/convex/**/*.ts");
afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter catalog refresh", () => {
  it("refreshes once, retires missing models without deleting their ids, and restores returning models", async () => {
    const t = convexTest(schema, modules);
    const oldId = await t.run(async ctx => ctx.db.insert("models", {
      modelId: "openai/old", name: "Old model", provider: "openai",
      inputPricePerMillion: 1, outputPricePerMillion: 2,
      isServed: true, costMarkup: 1.8, sortOrder: 2, category: "curated",
      syncedAt: 1, createdAt: 1, updatedAt: 1,
    }));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [RAW_BASE]})));
    vi.stubGlobal("fetch", fetch);
    expect(await t.action(internal.models.sync.syncFromOpenRouter, {})).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await t.query(api.models.queries.listCatalogOptions, {})).map(m => m.modelId)).toEqual([RAW_BASE.id]);
    const old = await t.run(ctx => ctx.db.get(oldId));
    expect(old).toMatchObject({modelId: "openai/old", retiredAt: expect.any(Number), costMarkup: 1.8, isServed: true});
    expect(await t.query(internal.models.queries.getById, {modelId: oldId})).toBeNull();
    expect(await t.query(internal.models.queries.listServed, {})).toEqual([]);
    expect(await t.query(internal.models.queries.getServedByModelId, {modelId: "openai/old"})).toBeNull();
    expect(await t.query(api.models.queries.listCatalogOptions, {provider: "openai"})).toEqual([]);
    expect((await t.query(api.models.queries.paginateCatalogOptions, {paginationOpts: {cursor: null, numItems: 10}})).page.map(m => m.modelId)).toEqual([RAW_BASE.id]);
    expect((await t.query(api.chat.model.listChatModels, {})).map(m => m.modelId)).toEqual([RAW_BASE.id]);
    expect(await t.query(internal.models.queries.resolveEvidenceLibrarySelection, {modelIds: ["openai/old"]})).toEqual({catalogReady: true, allowedModelIds: []});
    expect(await t.query(internal.models.queries.getPricing, {modelId: "openai/old"})).toEqual({input: 1, output: 2});
    expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);

    fetch.mockResolvedValue(new Response(JSON.stringify({data: [{...RAW_BASE, id: "openai/old", name: "Returned model"}]})));
    await t.action(internal.models.sync.syncFromOpenRouter, {});
    expect(await t.run(ctx => ctx.db.get(oldId))).toMatchObject({name: "Returned model", costMarkup: 1.8, sortOrder: 2, category: "curated", isServed: true});
    expect((await t.run(ctx => ctx.db.get(oldId)))?.retiredAt).toBeUndefined();
    expect((await t.query(internal.models.queries.listServed, {})).map(m => m._id)).toEqual([oldId]);
  });

  it.each([
    ["HTTP failure", () => new Response("unavailable", {status: 503})],
    ["empty catalog", () => new Response(JSON.stringify({data: []}))],
    ["malformed model", () => new Response(JSON.stringify({data: [RAW_BASE, {id: "broken"}]}))],
    ["duplicate ids", () => new Response(JSON.stringify({data: [RAW_BASE, RAW_BASE]}))],
    ["oversized catalog", () => new Response(JSON.stringify({data: Array.from({length: 2001}, (_, i) => ({...RAW_BASE, id: `provider/model-${i}`}))}))],
    ["oversized response", () => new Response("x".repeat(4 * 1024 * 1024 + 1))],
  ])("stops after %s without changing data or queuing another run", async (_label, response) => {
    const t = convexTest(schema, modules);
    await t.run(ctx => ctx.db.insert("models", {
      modelId: "openai/existing", name: "Existing model", provider: "openai",
      inputPricePerMillion: 1, outputPricePerMillion: 2,
      isServed: true, costMarkup: 1.3, sortOrder: 1,
      syncedAt: 1, createdAt: 1, updatedAt: 1,
    }));
    const before = await t.query(api.models.queries.list, {});
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    await expect(t.action(internal.models.sync.syncFromOpenRouter, {})).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await t.query(api.models.queries.list, {})).toEqual(before);
    expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  it("passes a timeout signal and stops on an aborted request", async () => {
    const t = convexTest(schema, modules);
    const fetch = vi.fn((_url: string, options?: RequestInit) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(new DOMException("Request timed out", "TimeoutError"));
    });
    vi.stubGlobal("fetch", fetch);
    await expect(t.action(internal.models.sync.syncFromOpenRouter, {})).rejects.toThrow("timed out");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });
});


describe("catalog retirement guard", () => {
  it("rejects a suspiciously shrunken catalog atomically", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 50; i++) await ctx.db.insert("models", {
        modelId: `provider/model-${i}`, name: `Model ${i}`, provider: "provider",
        inputPricePerMillion: 1, outputPricePerMillion: 2, isServed: true,
        costMarkup: 1.3, sortOrder: i, createdAt: 1, updatedAt: 1, syncedAt: 1,
      });
    });
    const before = await t.query(api.models.queries.list, {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [RAW_BASE]}))));
    await expect(t.action(internal.models.sync.syncFromOpenRouter, {})).rejects.toThrow("unexpectedly shrank");
    expect(await t.query(api.models.queries.list, {})).toEqual(before);
    expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });
});


it("cancels a stream of empty chunks after a finite number of reads", async () => {
  const t = convexTest(schema, modules);
  let reads = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array()); },
    cancel,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  await expect(t.action(internal.models.sync.syncFromOpenRouter, {})).rejects.toThrow("chunk limit");
  expect(reads).toBeLessThanOrEqual(8193);
  expect(cancel).toHaveBeenCalledOnce();
  expect(await t.query(api.models.queries.list, {})).toEqual([]);
});
