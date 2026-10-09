import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { usableFor, type AiTask } from "../../lib/ai/tasks";
import type { Id } from "../_generated/dataModel";
import { ensureWorkspace } from "../workspaces/create";
import { assistantPick, chatModel } from "../assistant/threads";

async function setup() {
  const t = convexTest(schema);
  const model = (modelId: string, reasoningEfforts?: Array<"low" | "medium" | "high">, supportedParameters = ["structured_outputs"]) =>
    t.run((ctx) =>
      ctx.db.insert("models", {
        modelId, name: modelId, provider: modelId.split("/")[0]!, inputPricePerMillion: 1, outputPricePerMillion: 2,
        isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1, supportedParameters,
        ...(reasoningEfforts && { reasoningEfforts, defaultEffort: reasoningEfforts[0] }),
      }),
    );
  const sonnet = await model("anthropic/sonnet", ["low", "medium", "high"]);
  const flash = await model("google/flash", ["low"]);
  const mine = await model("acme/mine");
  // JSON mode without schemas isn't enough for the tasks that parse an answer.
  const chatOnly = await model("acme/chat-only", undefined, ["response_format", "tools"]);
  const { userId, own } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {clerkId: "clerk_user", email: "user@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 });
    return { userId, own: await ensureWorkspace(ctx, { kind: "personal", userId }) };
  });
  await t.run((ctx) =>
    ctx.db.insert("users", {clerkId: "clerk_admin", email: "admin@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 }),
  );
  await t.mutation(internal.admins.mutations.grant, { email: "admin@test.local" });
  const user = t.withIdentity({ subject: "clerk_user" });
  const admin = t.withIdentity({ subject: "clerk_admin" });
  const runsOn = (task: AiTask, workspaceId: Id<"workspaces"> = own) => t.query(internal.ai.serverModel.resolveForUser, { userId, workspaceId, task });
  return { t, sonnet, flash, mine, chatOnly, userId, user, admin, runsOn };
}

describe("presets", () => {
  it("runs each task on the user's preset pick with its effort, Balanced by default", async () => {
    const { admin, user, sonnet, flash, runsOn } = await setup();
    await expect(user.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet })).rejects.toThrow(/Admins only/);
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet, effort: "high" });
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "fast", task: "chat", modelId: flash });

    expect(await runsOn("chat")).toEqual({ modelId: sonnet, effort: "high" });
    // What the settings map reads: each preset's pick per task, and nothing where none is set.
    const picks = await user.query(api.aiModelConfig.queries.presetPicks, {});
    const chat = (preset: "cheap" | "fast" | "balanced") => picks[preset].find((pick) => pick.task === "chat");
    expect(chat("balanced")).toMatchObject({ model: { _id: sonnet, modelId: "anthropic/sonnet" }, effort: "high" });
    expect(chat("fast")).toMatchObject({ model: { _id: flash }, effort: null });
    expect(chat("cheap")).toEqual({ task: "chat", model: null, effort: null });
    await user.mutation(api.userAiConfig.mutations.choose, { choice: "fast" });
    expect(await runsOn("chat")).toEqual({ modelId: flash });
    // Fast has no screening pick, so screening falls back to Balanced's (none either).
    expect(await runsOn("screening")).toBeNull();
  });

  it("runs an organization's work on the preset its admins pick, not on a member's own settings (#651)", async () => {
    const { t, admin, user, sonnet, flash, mine, runsOn, userId } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet });
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "fast", task: "chat", modelId: flash });
    const lab = await t.run(async (ctx) => {
      const stamp = { clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 };
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, state: "active", ...stamp });
      for (const [clerkUserId, role] of [["clerk_user", "org:member"], ["clerk_admin", "org:admin"]] as const) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role, state: "active", ...stamp });
      return await ensureWorkspace(ctx, { kind: "organization", organizationId });
    });
    // The member runs on Fast in their own workspace, and on the organization's Balanced in it.
    await user.mutation(api.userAiConfig.mutations.choose, { choice: "fast" });
    expect(await runsOn("chat")).toEqual({ modelId: flash });
    expect(await runsOn("chat", lab)).toEqual({ modelId: sonnet });
    // Only its admins change it.
    await expect(user.mutation(api.organizations.manage.setAiPreset, { workspaceId: lab, preset: "cheap" })).rejects.toThrow(/Only an admin/);
    expect((await admin.mutation(api.organizations.manage.setAiPreset, { workspaceId: lab, preset: "fast" })).undo).toEqual({ path: "organizations/manage:setAiPreset", args: { preset: "balanced" } });
    expect(await runsOn("chat", lab)).toEqual({ modelId: flash });
    // A chat there that kept a model of its own runs on what the organization's preset gives chats all the same.
    const { kept, preset } = await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("assistantThreads", { workspaceId: lab, createdBy: userId, title: "Chat", agentThreadId: "agent_1", lastMessageAt: 1, modelId: mine, createdAt: 1, updatedAt: 1 });
      return { kept: (await chatModel(ctx, (await ctx.db.get("assistantThreads", threadId))!, userId)).modelId, preset: (await assistantPick(ctx, { userId, workspaceId: lab }))?.modelId ?? null };
    });
    expect(kept).not.toBe(mine);
    expect(kept).toBe(preset);
  });

  it("puts Jev only on screening tasks, since it can't write text", async () => {
    const { t, admin, user } = await setup();
    const jev = await t.run((ctx) =>
      ctx.db.insert("models", {
        modelId: "typesafe/jev-1.13", name: "TypeSafe: Jev 1.13", provider: "typesafe", inputPricePerMillion: 0.042, outputPricePerMillion: 0,
        isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
      }),
    );
    await expect(admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: jev })).rejects.toThrow(/only answers screening/);
    await expect(user.mutation(api.userAiConfig.mutations.setCustom, { picks: [{ task: "extraction", modelId: jev }] })).rejects.toThrow(/only answers screening/);
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "screenAll", modelId: jev });
  });

  it("offers a model without structured output only for chat, and skips a stored pick that needs it", async () => {
    const { t, admin, user, chatOnly, runsOn } = await setup();
    await expect(admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "extraction", modelId: chatOnly })).rejects.toThrow(/structured answers/);
    await expect(user.mutation(api.userAiConfig.mutations.setCustom, { picks: [{ task: "translate", modelId: chatOnly }] })).rejects.toThrow(/structured answers/);
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: chatOnly });
    // What a picker for these tasks offers.
    const offered = async (tasks: AiTask[]) =>
      (await t.query(api.models.queries.listCatalogOptions, {})).filter((m) => tasks.every((task) => usableFor(m, task))).map((m) => m._id);
    expect(await offered(["chat"])).toContain(chatOnly);
    expect(await offered(["chat", "extraction"])).not.toContain(chatOnly);
    // A pick saved before the rule no longer runs.
    await t.run((ctx) => ctx.db.insert("aiModelConfig", { key: "preset.balanced.extraction", modelId: "acme/chat-only", updatedAt: 1 }));
    expect(await runsOn("extraction")).toBeNull();
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

  it("falls back to Balanced's pick once an admin hides a Custom model", async () => {
    const { admin, user, sonnet, mine, runsOn } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setPresetPick, { preset: "balanced", task: "chat", modelId: sonnet });
    await user.mutation(api.userAiConfig.mutations.setCustom, { picks: [{ task: "chat", modelId: mine }] });
    await admin.mutation(api.models.admin.setOffered, { modelId: mine, on: false });
    expect(await runsOn("chat")).toEqual({ modelId: sonnet });
  });
});
