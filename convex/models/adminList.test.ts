// The admin model list, read a page at a time on the server (#424): its provider, search and
// offered filters, the count and provider chips its page shows, and who may read it.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

async function setup() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (const clerkId of ["clerk_admin", "clerk_member"]) {
      await ctx.db.insert("users", { libraryItemCount: 0, clerkId, email: `${clerkId}@test.local`, state: "active" as const, createdAt: 1, updatedAt: 1 });
    }
    // Five providers: openai 3, anthropic 2, google 2, qwen 2, and acme 1, which falls under "other".
    const catalog = ["openai/gpt-a", "anthropic/sonnet", "google/flash", "openai/gpt-b", "qwen/turbo", "acme/mini", "anthropic/haiku", "google/pro", "qwen/max", "openai/gpt-c"];
    for (const [i, modelId] of catalog.entries()) {
      await ctx.db.insert("models", {
        modelId, name: `${modelId.split("/")[0]}: Model ${i}`, provider: modelId.split("/")[0]!, inputPricePerMillion: 1, outputPricePerMillion: 2,
        isServed: false, costMarkup: 1, sortOrder: i, syncedAt: 1, createdAt: 1, updatedAt: 1, ...(modelId === "openai/gpt-b" ? { hidden: true } : {}),
      });
    }
    await ctx.db.insert("models", { modelId: "openai/retired", name: "openai: Retired", provider: "openai", inputPricePerMillion: 1, outputPricePerMillion: 2, isServed: false, costMarkup: 1, sortOrder: 99, syncedAt: 1, createdAt: 1, updatedAt: 1, retiredAt: 5 });
  });
  await t.mutation(internal.admins.mutations.grant, { email: "clerk_admin@test.local" });
  return { t, admin: t.withIdentity({ subject: "clerk_admin" }), member: t.withIdentity({ subject: "clerk_member" }) };
}

const all = { search: "", show: "all" as const };

describe("admin model list", () => {
  it("steps through the catalog in its order, leaving retired models out, with the view's count and the largest providers", async () => {
    const { admin } = await setup();
    const first = await admin.query(api.models.admin.listModels, { ...all, paginationOpts: { cursor: null, numItems: 4 } });
    expect(first.page.map((m) => m.modelId)).toEqual(["openai/gpt-a", "anthropic/sonnet", "google/flash", "openai/gpt-b"]);
    expect(first.page.map((m) => m.on)).toEqual([true, true, true, false]);
    const second = await admin.query(api.models.admin.listModels, { ...all, paginationOpts: { cursor: first.continueCursor, numItems: 4 } });
    expect(second.page.map((m) => m.modelId)).toEqual(["qwen/turbo", "acme/mini", "anthropic/haiku", "google/pro"]);

    const summary = await admin.query(api.models.admin.summary, all);
    expect(summary.total).toBe(10);
    expect(summary.providers.map((p) => p.provider)).toEqual(["openai", "anthropic", "google", "qwen"]);
    expect(summary.providers[0].sampleModelId).toBe("openai/gpt-a");
  });

  it("keeps one provider's models, the other providers', a search's matches, and the offered or hidden ones, counting each view", async () => {
    const { admin } = await setup();
    const view = async (filters: { provider?: string; search?: string; show?: "all" | "on" | "off" }) => {
      const args = { ...all, ...filters };
      const page = await admin.query(api.models.admin.listModels, { ...args, paginationOpts: { cursor: null, numItems: 20 } });
      return { ids: page.page.map((m) => m.modelId), total: (await admin.query(api.models.admin.summary, args)).total };
    };
    expect(await view({ provider: "openai" })).toEqual({ ids: ["openai/gpt-a", "openai/gpt-b", "openai/gpt-c"], total: 3 });
    expect(await view({ provider: "other" })).toEqual({ ids: ["acme/mini"], total: 1 });
    expect(await view({ search: " GPT-" })).toEqual({ ids: ["openai/gpt-a", "openai/gpt-b", "openai/gpt-c"], total: 3 });
    expect(await view({ search: "model 7" })).toEqual({ ids: ["google/pro"], total: 1 });
    expect(await view({ show: "off" })).toEqual({ ids: ["openai/gpt-b"], total: 1 });
    expect(await view({ provider: "openai", show: "on" })).toEqual({ ids: ["openai/gpt-a", "openai/gpt-c"], total: 2 });
    expect(await view({ search: "no such model" })).toEqual({ ids: [], total: 0 });
  });

  it("is for admins only", async () => {
    const { member } = await setup();
    await expect(member.query(api.models.admin.listModels, { ...all, paginationOpts: { cursor: null, numItems: 4 } })).rejects.toThrow(/Admins only/);
    await expect(member.query(api.models.admin.summary, all)).rejects.toThrow(/Admins only/);
  });
});
