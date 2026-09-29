import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { setupAggregates } from "../extraction/aggregates.test-support";

async function setup() {
  const t = convexTest(schema);
  setupAggregates(t);
  const model = (modelId: string) =>
    t.run((ctx) =>
      ctx.db.insert("models", {
        modelId, name: modelId, provider: modelId.split("/")[0]!, inputPricePerMillion: 1, outputPricePerMillion: 2,
        isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
      }),
    );
  const balanced = await model("acme/balanced");
  const cheap = await model("acme/cheap");
  const mine = await model("acme/mine");
  await t.run((ctx) => ctx.db.insert("aiModelConfig", { key: "preset.balanced", modelId: "acme/balanced", updatedAt: 1 }));
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { clerkId: "clerk_user", email: "user@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 }),
  );
  await t.run((ctx) =>
    ctx.db.insert("users", { clerkId: "clerk_admin", email: "admin@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 }),
  );
  await t.mutation(internal.admins.mutations.grant, { email: "admin@test.local" });
  const runsOn = (task: "chat" | "extraction" | "screening") => t.query(internal.ai.serverModel.resolveForUser, { userId, task });
  return {
    t, balanced, cheap, mine, runsOn,
    user: t.withIdentity({ subject: "clerk_user" }),
    admin: t.withIdentity({ subject: "clerk_admin" }),
  };
}

describe("task routing", () => {
  it("runs each task on the admin's pick for it under Recommended, else the balanced model", async () => {
    const { admin, user, balanced, cheap, runsOn } = await setup();
    await expect(user.mutation(api.aiModelConfig.admin.setTaskModel, { task: "extraction", modelId: cheap })).rejects.toThrow(/Admins only/);
    await admin.mutation(api.aiModelConfig.admin.setTaskModel, { task: "extraction", modelId: cheap });

    expect(await runsOn("extraction")).toBe(cheap);
    expect(await runsOn("chat")).toBe(balanced);
  });

  it("runs every task on one model, and falls back to Recommended once an admin hides it", async () => {
    const { t, admin, user, mine, cheap, runsOn } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setTaskModel, { task: "extraction", modelId: cheap });
    await user.mutation(api.userAiConfig.mutations.setCustomModel, { serverModelId: mine });
    expect(await runsOn("chat")).toBe(mine);
    expect(await runsOn("extraction")).toBe(mine);

    await admin.mutation(api.models.admin.setOffered, { modelId: mine, on: false });
    expect(await runsOn("extraction")).toBe(cheap);
    // The settings map shows Recommended, since that's what runs.
    expect((await user.query(api.userAiConfig.queries.get, {}))?.model).toBeNull();
    // A job stamped with it before the admin hid it can't run it either.
    expect(await t.query(internal.models.queries.getById, { modelId: mine })).toBeNull();
    // Hidden models can't be routed to either.
    await expect(admin.mutation(api.aiModelConfig.admin.setTaskModel, { task: "chat", modelId: mine })).rejects.toThrow();
  });

  it("starts One model on Recommended's chat model when the user never picked one", async () => {
    const { admin, user, cheap, runsOn } = await setup();
    await admin.mutation(api.aiModelConfig.admin.setTaskModel, { task: "chat", modelId: cheap });
    await user.mutation(api.userAiConfig.mutations.setPreset, { serverPreset: "custom" });
    expect(await runsOn("screening")).toBe(cheap);
    expect((await user.query(api.userAiConfig.queries.get, {}))?.model?._id).toBe(cheap);
  });

  it("finds the browser key's model from the id the provider's own API takes", async () => {
    const { t } = await setup();
    // The OpenRouter-only `:free` variant shares the native id but isn't what the key calls.
    for (const [modelId, price] of [["anthropic/claude-sonnet-4.6:free", 0], ["anthropic/claude-sonnet-4.6", 3]] as const) {
      await t.run((ctx) =>
        ctx.db.insert("models", {
          modelId, name: modelId, provider: "anthropic",
          inputPricePerMillion: price, outputPricePerMillion: 15, isServed: true, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
        }),
      );
    }
    const row = await t.query(api.models.queries.getCatalogOption, { modelId: "claude-sonnet-4-6", provider: "anthropic" });
    expect(row?.modelId).toBe("anthropic/claude-sonnet-4.6");
  });
});
