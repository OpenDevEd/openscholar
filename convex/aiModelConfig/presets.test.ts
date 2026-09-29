import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { setupAggregates } from "../extraction/aggregates.test-support";
import type { AiTask } from "../../lib/ai/tasks";

async function setup() {
  const t = convexTest(schema);
  setupAggregates(t);
  const model = (modelId: string, reasoningEfforts?: Array<"low" | "medium" | "high">) =>
    t.run((ctx) =>
      ctx.db.insert("models", {
        modelId, name: modelId, provider: modelId.split("/")[0]!, inputPricePerMillion: 1, outputPricePerMillion: 2,
        isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
        ...(reasoningEfforts && { reasoningEfforts, defaultEffort: reasoningEfforts[0] }),
      }),
    );
  const sonnet = await model("anthropic/sonnet", ["low", "medium", "high"]);
  const flash = await model("google/flash", ["low"]);
  const mine = await model("acme/mine");
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { clerkId: "clerk_user", email: "user@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 }),
  );
  await t.run((ctx) =>
    ctx.db.insert("users", { clerkId: "clerk_admin", email: "admin@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 }),
  );
  await t.mutation(internal.admins.mutations.grant, { email: "admin@test.local" });
  const user = t.withIdentity({ subject: "clerk_user" });
  const admin = t.withIdentity({ subject: "clerk_admin" });
  const runsOn = (task: AiTask) => t.query(internal.ai.serverModel.resolveForUser, { userId, task });
  return { t, sonnet, flash, mine, userId, user, admin, runsOn };
}

describe("presets", () => {
  it("runs each task on the user's preset pick with its effort, Balanced by default", async () => {
    const { admin, user, sonnet, flash, runsOn } = await setup();
    await expect(user.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet })).rejects.toThrow(/Admins only/);
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet, effort: "high" });
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "fast", task: "chat", modelId: flash });

    expect(await runsOn("chat")).toEqual({ modelId: sonnet, effort: "high" });
    await user.mutation(api.userAiConfig.mutations.choose, { choice: "fast" });
    expect(await runsOn("chat")).toEqual({ modelId: flash });
    // Fast has no screening pick, so screening falls back to Balanced's (none either).
    expect(await runsOn("screening")).toBeNull();
  });

  it("refuses an effort the model doesn't take", async () => {
    const { admin, flash } = await setup();
    await expect(
      admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "fast", task: "chat", modelId: flash, effort: "high" }),
    ).rejects.toThrow(/doesn't take high/);
  });
});

describe("custom", () => {
  it("starts as a copy of the user's preset, then keeps its own picks", async () => {
    const { admin, user, sonnet, mine, runsOn } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet, effort: "medium" });
    await user.mutation(api.userAiConfig.mutations.choose, { choice: "custom" });
    expect(await runsOn("chat")).toEqual({ modelId: sonnet, effort: "medium" });

    await user.mutation(api.userAiConfig.mutations.setCustom, { picks: [{ task: "extraction", modelId: mine }] });
    expect(await runsOn("extraction")).toEqual({ modelId: mine });
    const settings = await user.query(api.userAiConfig.queries.get, {});
    expect(settings?.choice).toBe("custom");
    expect(settings?.custom.find((c) => c.task === "extraction")?.model?._id).toBe(mine);
  });

  it("keeps every other task's pick on the first direct edit", async () => {
    const { admin, user, sonnet, flash, mine, runsOn } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "fast", task: "chat", modelId: flash });
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet });
    await user.mutation(api.userAiConfig.mutations.choose, { choice: "fast" });
    await user.mutation(api.userAiConfig.mutations.setCustom, { picks: [{ task: "extraction", modelId: mine }] });
    // Chat stays on Fast's pick rather than dropping to Balanced's.
    expect(await runsOn("chat")).toEqual({ modelId: flash });
  });

  it("runs a row saved before presets as it will after the migration", async () => {
    const { t, admin, flash, userId, runsOn } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "fast", task: "chat", modelId: flash });
    await t.run((ctx) => ctx.db.insert("userAiConfig", { userId, serverPreset: "fast", updatedAt: 1 }));
    expect(await runsOn("chat")).toEqual({ modelId: flash });
  });

  it("converts a row saved before presets before changing it", async () => {
    const { t, user, mine, userId, runsOn } = await setup();
    await t.run((ctx) => ctx.db.insert("userAiConfig", { userId, serverPreset: "custom", serverModelId: mine, updatedAt: 1 }));
    await user.mutation(api.userAiConfig.mutations.choose, { choice: "custom" });
    expect(await runsOn("translate")).toEqual({ modelId: mine });
    const cfg = await t.run((ctx) => ctx.db.query("userAiConfig").first());
    expect(cfg?.serverPreset).toBeUndefined();
  });

  it("falls back to Balanced's pick once an admin hides a Custom model", async () => {
    const { admin, user, sonnet, mine, runsOn } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet });
    await user.mutation(api.userAiConfig.mutations.setCustom, { picks: [{ task: "chat", modelId: mine }] });
    await admin.mutation(api.models.admin.setOffered, { modelId: mine, on: false });
    expect(await runsOn("chat")).toEqual({ modelId: sonnet });
  });
});

describe("migrating to preset maps", () => {
  afterEach(() => vi.useRealTimers());

  it("turns the old rows into preset maps and old choices into presets or Custom", async () => {
    const { t, mine, userId, runsOn } = await setup();
    await t.run(async (ctx) => {
      for (const [key, modelId] of [["preset.balanced", "anthropic/sonnet"], ["preset.fast", "google/flash"], ["task.extraction", "google/flash"], ["default.openai", "gpt-4o"]]) {
        await ctx.db.insert("aiModelConfig", { key: key!, modelId: modelId!, updatedAt: 1 });
      }
      await ctx.db.insert("userAiConfig", { userId, serverPreset: "custom", serverModelId: mine, updatedAt: 1 });
    });

    vi.useFakeTimers();
    await t.mutation(internal.migrations.presetMaps.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const keys = await t.run((ctx) => ctx.db.query("aiModelConfig").collect());
    expect(keys.map((row) => row.key)).not.toContain("preset.balanced");
    expect(keys.map((row) => row.key)).not.toContain("default.openai");
    expect(keys.find((row) => row.key === "preset.balanced.chat")?.modelId).toBe("anthropic/sonnet");
    expect(keys.find((row) => row.key === "preset.balanced.extraction")?.modelId).toBe("google/flash");
    expect(keys.find((row) => row.key === "preset.fast.screening")?.modelId).toBe("google/flash");

    // One model became Custom with that model on every task.
    expect(await runsOn("screening")).toEqual({ modelId: mine });
    const cfg = await t.run((ctx) => ctx.db.query("userAiConfig").first());
    expect(cfg).toMatchObject({ choice: "custom" });
    expect(cfg?.serverPreset).toBeUndefined();
  });
});
