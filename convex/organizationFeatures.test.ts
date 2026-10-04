/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { seedFeatureUser, seedOrganizationFeatures } from "./organizationFeatures.test-support";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { MEMBERSHIP_REVOKE_BATCH } from "./webhooks/projections";

const modules = import.meta.glob("/convex/**/*.ts");
const denied = { authors: false, extraction: false, evidenceLibraries: false };

describe("organization feature access", () => {
  test("unions every active membership without using active organization claims", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "member",
        email: "member@example.org",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await seedOrganizationFeatures(ctx, ["member"], { authors: true });
      await seedOrganizationFeatures(ctx, ["member"], {
        evidenceLibraries: true,
        extraction: true,
      });
    });
    for (const identity of [
      { subject: "member" },
      { subject: "member", o: { id: "unrelated", rol: "org:member" } },
    ]) {
      expect(
        await t.withIdentity(identity).query(api.organizationFeatures.get, {}),
      ).toEqual({ authors: true, evidenceLibraries: true, extraction: true });
    }
  });

  test("revocation, disabled features and deleted organizations immediately remove grants", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "member",
        email: "member@example.org",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return seedOrganizationFeatures(ctx, ["member"], {
        authors: true,
        evidenceLibraries: true,
        extraction: true,
      });
    });
    const user = t.withIdentity({ subject: "member" });
    await t.run((ctx) =>
      ctx.db.patch("organizations", id, { authorsEnabled: false }),
    );
    expect(await user.query(api.organizationFeatures.get, {})).toEqual({
      authors: false,
      extraction: true,
      evidenceLibraries: true,
    });
    await t.run((ctx) =>
      ctx.db.patch("organizations", id, { state: "deleted" }),
    );
    expect(await user.query(api.organizationFeatures.get, {})).toEqual(denied);
    await t.run(async (ctx) => {
      await ctx.db.patch("organizations", id, { state: "active" });
      const membership = await ctx.db.query("organizationMemberships").first();
      await ctx.db.patch("organizationMemberships", membership!._id, {
        state: "revoked",
      });
    });
    expect(await user.query(api.organizationFeatures.get, {})).toEqual(denied);
    await expect(
      user.mutation(api.authors.profiles.create, { name: "Someone" }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  test("does not expose another user's features to anonymous or unaffiliated accounts", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const clerkId of ["member", "outsider"])
        await ctx.db.insert("users", {libraryItemCount: 0, 
          clerkId,
          email: `${clerkId}@example.org`,
          state: "active",
          createdAt: 1,
          updatedAt: 1,
        });
      await seedOrganizationFeatures(ctx, ["member"], { authors: true });
    });
    expect(await t.query(api.organizationFeatures.get, {})).toEqual(denied);
    const outsider = t.withIdentity({
      subject: "outsider",
      o: { id: "forged", rol: "org:admin" },
    });
    expect(await outsider.query(api.organizationFeatures.get, {})).toEqual(
      denied,
    );
    await expect(
      outsider.query(api.authors.profiles.list, {
        search: "",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});

test("the creation picker and authorization use the same eligible organizations", async () => {
  const t = convexTest(schema, modules);
  const [first, second, memberOnly, disabled, foreign] = await t.run(
    async (ctx) => {
      await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "owner",
        email: "owner@example.org",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const ids = [];
      for (const name of [
        "Alpha",
        "Beta",
        "Member only",
        "Disabled",
        "Foreign",
      ]) {
        const id = await seedOrganizationFeatures(
          ctx,
          name === "Foreign" ? ["someone-else"] : ["owner"],
          { evidenceLibraries: name !== "Disabled" },
        );
        await ctx.db.patch("organizations", id, { name });
        const membership = await ctx.db
          .query("organizationMemberships")
          .withIndex("by_organizationId_and_state", (q) =>
            q.eq("organizationId", id).eq("state", "active"),
          )
          .unique();
        await ctx.db.patch("organizationMemberships", membership!._id, {
          role: name === "Member only" ? "org:member" : "org:admin",
        });
        ids.push(id);
      }
      return ids;
    },
  );
  const owner = t.withIdentity({
    subject: "owner",
    o: { id: "unrelated", rol: "org:member" },
  });
  expect(
    ((await owner.query(api.organizationFeatures.listLibraryOrganizations, {})).page).map(
      (org) => org.id,
    ),
  ).toEqual([first, second]);
  const { requireLibraryOrganization } = await import("./organizationFeatures");
  const { createEvidenceLibrarySetup } =
    await import("./evidenceLibraries/mutations");
  const created = await owner.run((ctx) =>
    createEvidenceLibrarySetup(ctx, {
      organizationId: second!,
      name: "Chosen library",
      slug: "chosen-library",
      publicAddress: "https://chosen.example.org",
    }),
  );
  expect(
    await t.run((ctx) => ctx.db.get("evidenceLibraries", created.libraryId)),
  ).toMatchObject({ organizationId: second });
  for (const id of [memberOnly, disabled, foreign])
    await expect(
      owner.run((ctx) => requireLibraryOrganization(ctx, id!)),
    ).rejects.toThrow(/FORBIDDEN/);
  await t.run((ctx) =>
    ctx.db.patch("organizations", second!, { evidenceLibrariesEnabled: false }),
  );
  expect(
    ((await owner.query(api.organizationFeatures.listLibraryOrganizations, {})).page).map(
      (org) => org.id,
    ),
  ).toEqual([first]);
  await expect(
    owner.run((ctx) => requireLibraryOrganization(ctx, second!)),
  ).rejects.toThrow(/FORBIDDEN/);
});

test("refuses to read a person in more organizations than one read takes, not a partial list (#427)", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedFeatureUser(ctx, "joiner");
    for (let i = 0; i < MAX_ORGANIZATIONS_PER_PERSON; i += 1) await seedOrganizationFeatures(ctx, ["joiner"], { authors: true });
  });
  const joiner = t.withIdentity({ subject: "joiner" });
  expect(await joiner.query(api.organizationFeatures.get, {})).toMatchObject({ authors: true });
  await t.run((ctx) => seedOrganizationFeatures(ctx, ["joiner"], { authors: true }));
  await expect(joiner.query(api.organizationFeatures.get, {})).rejects.toThrow(/more than 200 organizations/);
});

test("a sweep of a deleted organization's memberships stops once the organization is active again (#427)", async () => {
  const t = convexTest(schema, modules);
  const organization = await t.run(async (ctx) =>
    (await ctx.db.get("organizations", await seedOrganizationFeatures(ctx, Array.from({ length: MEMBERSHIP_REVOKE_BATCH + 1 }, (_, i) => `member_${i}`), { authors: true })))!);
  const event = { instanceId: "ins_test", payloadSha256: "a".repeat(64), entityId: organization.clerkOrganizationId };
  const { _id, clerkOrganizationId, name, slug, evidenceLibrariesEnabled, clerkCreatedAt, clerkUpdatedAt } = organization;
  const snapshot = { clerkOrganizationId, name, slug, evidenceLibrariesEnabled, authorsEnabled: true, extractionEnabled: false, clerkCreatedAt, clerkUpdatedAt: clerkUpdatedAt + 1 };
  vi.useFakeTimers();
  await t.mutation(internal.webhooks.projections.applyOrganizationEvent, { ...event, eventId: "msg_gone", eventType: "organization.deleted", occurredAt: 100, action: "delete" });
  // A newer organization event arrives before the second batch runs.
  await t.mutation(internal.webhooks.projections.applyOrganizationEvent, { ...event, eventId: "msg_back", eventType: "organization.updated", occurredAt: 200, action: "upsert", organization: snapshot });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  const left = await t.run((ctx) => ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", _id).eq("state", "active")).take(2));
  expect(left).toHaveLength(1);
});

test("a deleted organization's memberships are revoked, however many it has (#427)", async () => {
  const t = convexTest(schema, modules);
  const members = ["joiner", ...Array.from({ length: MEMBERSHIP_REVOKE_BATCH }, (_, i) => `member_${i}`)];
  const { gone, kept } = await t.run(async (ctx) => {
    const gone = (await ctx.db.get("organizations", await seedOrganizationFeatures(ctx, members, { authors: true })))!;
    return { gone, kept: await seedOrganizationFeatures(ctx, ["joiner"], { authors: true }) };
  });
  vi.useFakeTimers();
  await t.mutation(internal.webhooks.projections.applyOrganizationEvent, {
    eventId: "msg_gone", eventType: "organization.deleted", instanceId: "ins_test", occurredAt: Date.now(), payloadSha256: "a".repeat(64),
    action: "delete", entityId: gone.clerkOrganizationId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  const active = await t.run((ctx) => ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", "joiner").eq("state", "active")).take(3));
  expect(active.map((membership) => membership.organizationId)).toEqual([kept]);
  expect(await t.run((ctx) => ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", gone._id).eq("state", "active")).first())).toBeNull();
});
