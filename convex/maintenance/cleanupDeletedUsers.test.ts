/// <reference types="vite/client" />
// The cleanup behind the privacy policy's "about 30 days".
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
const modules = import.meta.glob("/convex/**/*.ts");

const DAY = 24 * 60 * 60 * 1000;
const newTest = () => convexTest(schema, modules);
type Test = ReturnType<typeof newTest>;

const addDeleted = (t: Test, name: string, deletedDaysAgo: number) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: name,
      email: `${name}@example.org`,
      state: "deleted",
      createdAt: 1,
      updatedAt: Date.now() - deletedDaysAgo * DAY,
    }),
  );

describe("cleaning up deleted accounts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("removes those past 30 days, whatever newer deletions come first, and then stops", async () => {
    const t = newTest();
    // Created first, so an index on state alone returns all of these ahead of the old ones.
    for (let i = 0; i < 60; i++) await addDeleted(t, `recent${i}`, 5);
    await addDeleted(t, "old1", 40);
    await addDeleted(t, "old2", 90);

    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    const pendingBeforeLastRun = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});

    const left = await t.run((ctx) => ctx.db.query("users").take(100));
    expect(left.filter((user) => user.clerkId.startsWith("old"))).toEqual([]);
    expect(left).toHaveLength(60);
    const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(pending.length).toBe(pendingBeforeLastRun.length);
  });

  // A deleted person, and another deleted after them, with a community in the first one's own workspace.
  const withCommunity = async (t: Test) => {
    const holder = await addDeleted(t, "holder", 90);
    await addDeleted(t, "behind", 40);
    return await t.run(async (ctx) => {
      // Made with the account, as signing up makes it.
      const workspaceId = (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", holder)).unique())!._id;
      const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId, name: "Kept", slug: "kept", state: "active", createdByClerkUserId: "holder", updatedByClerkUserId: "holder", createdAt: 1, updatedAt: 1 } as never);
      return { holder, workspaceId, libraryId };
    });
  };
  const users = (t: Test) => t.run((ctx) => ctx.db.query("users").take(10)).then((rows) => rows.map((user) => user.clerkId));
  const teardownOf = (t: Test, libraryId: Id<"evidenceLibraries">) =>
    t.run((ctx) => ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_idempotencyKey", (q) => q.eq("libraryId", libraryId).eq("idempotencyKey", `development-teardown:${libraryId}`)).unique());

  it("deletes the communities in a deleted person's own workspace, then the workspace and the person", async () => {
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "true");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
    const t = newTest();
    const { holder, workspaceId, libraryId } = await withCommunity(t);

    // The community's teardown starts, as its owner's deletion would, and the accounts behind wait for nothing.
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    expect(await users(t)).toEqual(["holder"]);
    expect(await teardownOf(t, libraryId)).toMatchObject({ kind: "teardown", status: "queued" });
    expect((await t.run((ctx) => ctx.db.get("evidenceLibraries", libraryId)))?.state).toBe("disabled");
    expect((await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).map((job) => job.name)).toContain("evidenceLibraries/teardownActions:runDevelopmentTeardown");

    // A deletion that stopped is started again the next time round.
    const due = () => t.run((ctx) => ctx.db.patch("users", holder, { updatedAt: Date.now() - 31 * DAY }));
    const teardownId = (await teardownOf(t, libraryId))!._id;
    await t.run((ctx) => ctx.db.patch("evidenceLibraryConfigOperations", teardownId, { status: "failed", error: { code: "COOLIFY", message: "Coolify didn't answer", stage: "coolify" } }));
    await due();
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    expect(await teardownOf(t, libraryId)).toMatchObject({ status: "queued" });
    expect(await users(t)).toEqual(["holder"]);

    // Once the teardown has deleted the community, the workspace and the person go.
    await t.run((ctx) => ctx.db.delete("evidenceLibraries", libraryId));
    await due();
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    expect(await users(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get("workspaces", workspaceId))).toBeNull();
  });

  it("keeps a person with a community in their own workspace where communities can't be deleted, and cleans up the accounts behind them meanwhile", async () => {
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "false");
    const t = newTest();
    const { workspaceId, libraryId } = await withCommunity(t);

    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});

    expect(await users(t)).toEqual(["holder"]);
    expect(await t.run((ctx) => ctx.db.get("workspaces", workspaceId))).not.toBeNull();
    expect(await teardownOf(t, libraryId)).toBeNull();
  });
});
