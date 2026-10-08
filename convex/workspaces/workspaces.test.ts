// Every account and every organization has exactly one workspace (#650): made with it, or
// by the backfill for those from before, however often the backfill runs.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { createUserWithDefaults } from "../lib/userCreation";
import { applyOrganizationProjection } from "../webhooks/projections";
import { installFakeAutumn } from "../billing/billing.test-support";

const organization = (clerkOrganizationId: string, clerkUpdatedAt: number) => ({
  clerkOrganizationId,
  name: "Learning Lab",
  slug: clerkOrganizationId,
  evidenceLibrariesEnabled: false,
  authorsEnabled: false,
  extractionEnabled: false,
  clerkCreatedAt: 1,
  clerkUpdatedAt,
});

const event = (eventId: string, occurredAt: number) => ({
  eventId,
  eventType: "organization.updated",
  instanceId: "ins_test",
  occurredAt,
  payloadSha256: eventId.padEnd(64, "a"),
  processedAt: occurredAt * 1_000,
});

/** A backend, and the workspaces of an account or an organization in it: at most two, so a duplicate shows. */
function setup() {
  const t = convexTest(schema);
  const workspacesOf = (owner: { userId: Id<"users"> } | { organizationId: Id<"organizations"> }) =>
    t.run((ctx) =>
      "userId" in owner
        ? ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", owner.userId)).take(2)
        : ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", owner.organizationId)).take(2),
    );
  return { t, workspacesOf };
}

describe("workspaces", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAutumn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives a new account its personal workspace and a new organization its own, once", async () => {
    const { t, workspacesOf } = setup();
    const userId = await t.run((ctx) => createUserWithDefaults(ctx, { clerkId: "user_new", email: "new@example.org" }));
    // The organization's creation, then a later change to it.
    for (const [id, at] of [["msg_created", 100], ["msg_renamed", 200]] as const) {
      await t.run((ctx) => applyOrganizationProjection(ctx, { ...event(id, at), action: "upsert", entityId: "org_new", organization: organization("org_new", at) }));
    }
    const organizationId = await t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerkOrganizationId", (q) => q.eq("clerkOrganizationId", "org_new")).unique())!._id);

    expect(await workspacesOf({ userId })).toMatchObject([{ kind: "personal", userId }]);
    expect(await workspacesOf({ organizationId })).toMatchObject([{ kind: "organization", organizationId }]);
  });

  it("gives every account and organization from before one workspace, deleted ones too, however often it runs", async () => {
    const { t, workspacesOf } = setup();
    const already = await t.run((ctx) => createUserWithDefaults(ctx, { clerkId: "user_new", email: "new@example.org" }));
    const before = await t.run(async (ctx) => ({
      users: await Promise.all(
        (["active", "deleted"] as const).map((state) => ctx.db.insert("users", { clerkId: `user_${state}`, email: `${state}@example.org`, state, createdAt: 1, updatedAt: 1 })),
      ),
      organizations: await Promise.all(
        (["active", "deleted"] as const).map((state) => ctx.db.insert("organizations", { ...organization(`org_${state}`, 1), state, createdAt: 1, updatedAt: 1 })),
      ),
    }));

    expect(await t.action(internal.migrations.workspaces.verify, {})).toBe(4);
    for (let runs = 0; runs < 2; runs++) {
      await t.mutation(internal.migrations.workspaces.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await t.action(internal.migrations.workspaces.verify, {})).toBe(0);

    for (const userId of [already, ...before.users]) expect(await workspacesOf({ userId })).toMatchObject([{ kind: "personal", userId }]);
    for (const organizationId of before.organizations) expect(await workspacesOf({ organizationId })).toMatchObject([{ kind: "organization", organizationId }]);
  });
});
