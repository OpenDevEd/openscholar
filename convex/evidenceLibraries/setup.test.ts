/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedOrganization(
  t: ReturnType<typeof convexTest>,
  args: {
    clerkOrganizationId: string;
    clerkUserId: string;
    role: "org:admin" | "org:member";
  },
) {
  return await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: args.clerkOrganizationId,
      name: `Team ${args.clerkOrganizationId}`,
      slug: `team-${args.clerkOrganizationId}`,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: `membership_${args.clerkOrganizationId}_${args.clerkUserId}`,
      clerkUserId: args.clerkUserId,
      role: args.role,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return organizationId;
  });
}

const setupArgs = {
  name: "Climate Evidence",
  slug: "climate-evidence",
  publicAddress: "https://climate-evidence.example.org",
};

describe("Evidence Library setup draft", () => {
  it("creates, reopens, and retries one linked setup draft", async () => {
    const t = convexTest(schema);
    await seedOrganization(t, {
      clerkOrganizationId: "org_setup",
      clerkUserId: "user_setup_admin",
      role: "org:admin",
    });
    const admin = t.withIdentity({
      subject: "user_setup_admin",
      o: { id: "org_setup", rol: "org:admin" },
    });

    const created = await admin.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    const reopened = await admin.query(
      api.evidenceLibraries.queries.getSetupDraft,
      { libraryId: created.libraryId },
    );
    const retried = await admin.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    const counts = await t.run(async (ctx) => ({
      drafts: (await ctx.db.query("evidenceLibraryConfigDrafts").collect())
        .length,
      libraries: (await ctx.db.query("evidenceLibraries").collect()).length,
      operations: (
        await ctx.db.query("evidenceLibraryConfigOperations").collect()
      ).length,
      revisions: (
        await ctx.db.query("evidenceLibraryConfigRevisions").collect()
      ).length,
      runtimeBindings: (
        await ctx.db.query("evidenceLibraryRuntimeBindings").collect()
      ).length,
      sections: (await ctx.db.query("evidenceLibraryConfigSections").collect())
        .length,
    }));

    expect(retried).toEqual(created);
    expect(reopened).toMatchObject({
      draft: {
        _id: created.draftId,
        baseRevisionId: created.revisionId,
        editVersion: 0,
      },
      library: {
        _id: created.libraryId,
        draftId: created.draftId,
        latestRevisionId: created.revisionId,
        runtimeBindingId: created.runtimeBindingId,
        setupOperationId: created.setupOperationId,
        state: "provisioning",
      },
      publicAddress: setupArgs.publicAddress,
      revision: {
        _id: created.revisionId,
        revisionKey: "r1",
        revisionNumber: 1,
      },
      runtimeBinding: {
        _id: created.runtimeBindingId,
        state: "pending",
        targetBaseUrl: setupArgs.publicAddress,
      },
      setupOperation: {
        _id: created.setupOperationId,
        attemptCount: 0,
        kind: "setup",
        stage: "queued",
        status: "queued",
      },
    });
    expect(reopened.setupOperation).not.toHaveProperty("revisionId");
    expect(counts).toEqual({
      drafts: 1,
      libraries: 1,
      operations: 1,
      revisions: 1,
      runtimeBindings: 1,
      sections: 0,
    });
  });

  it("rejects a changed retry and an occupied public address", async () => {
    const t = convexTest(schema);
    await seedOrganization(t, {
      clerkOrganizationId: "org_first",
      clerkUserId: "user_first",
      role: "org:admin",
    });
    await seedOrganization(t, {
      clerkOrganizationId: "org_second",
      clerkUserId: "user_second",
      role: "org:admin",
    });
    const first = t.withIdentity({
      subject: "user_first",
      o: { id: "org_first", rol: "org:admin" },
    });
    const second = t.withIdentity({
      subject: "user_second",
      o: { id: "org_second", rol: "org:admin" },
    });

    await first.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    await expect(
      first.mutation(api.evidenceLibraries.mutations.createSetupDraft, {
        ...setupArgs,
        name: "A different library",
      }),
    ).rejects.toThrow(/CONFLICT/);
    await expect(
      second.mutation(api.evidenceLibraries.mutations.createSetupDraft, {
        ...setupArgs,
        slug: "another-library",
      }),
    ).rejects.toThrow(/CONFLICT.*public address/);
    const counts = await t.run(async (ctx) => ({
      drafts: (await ctx.db.query("evidenceLibraryConfigDrafts").collect())
        .length,
      libraries: (await ctx.db.query("evidenceLibraries").collect()).length,
      operations: (
        await ctx.db.query("evidenceLibraryConfigOperations").collect()
      ).length,
      revisions: (
        await ctx.db.query("evidenceLibraryConfigRevisions").collect()
      ).length,
      runtimeBindings: (
        await ctx.db.query("evidenceLibraryRuntimeBindings").collect()
      ).length,
    }));

    expect(counts).toEqual({
      drafts: 1,
      libraries: 1,
      operations: 1,
      revisions: 1,
      runtimeBindings: 1,
    });
  });

  it("allows only an active organization admin to create or reopen setup", async () => {
    const t = convexTest(schema);
    const organizationId = await seedOrganization(t, {
      clerkOrganizationId: "org_access",
      clerkUserId: "user_access_admin",
      role: "org:admin",
    });
    await t.run((ctx) =>
      ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "membership_access_member",
        clerkUserId: "user_access_member",
        role: "org:member",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await seedOrganization(t, {
      clerkOrganizationId: "org_other",
      clerkUserId: "user_access_admin",
      role: "org:admin",
    });
    const admin = t.withIdentity({
      subject: "user_access_admin",
      o: { id: "org_access", rol: "org:admin" },
    });
    const created = await admin.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    const member = t.withIdentity({
      subject: "user_access_member",
      o: { id: "org_access", rol: "org:member" },
    });
    const staleAdminClaim = t.withIdentity({
      subject: "user_access_member",
      o: { id: "org_access", rol: "org:admin" },
    });
    const wrongActiveOrganization = t.withIdentity({
      subject: "user_access_admin",
      o: { id: "org_other", rol: "org:admin" },
    });

    await expect(
      member.mutation(api.evidenceLibraries.mutations.createSetupDraft, {
        ...setupArgs,
        slug: "member-library",
        publicAddress: "https://member-library.example.org",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      member.query(api.evidenceLibraries.queries.getSetupDraft, {
        libraryId: created.libraryId,
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      staleAdminClaim.query(api.evidenceLibraries.queries.getSetupDraft, {
        libraryId: created.libraryId,
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      wrongActiveOrganization.query(
        api.evidenceLibraries.queries.getSetupDraft,
        { libraryId: created.libraryId },
      ),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
