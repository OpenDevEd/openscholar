/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");

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
};

const testPlatformDomain = "libraries.example.test";
const setupAddress =
  "https://climate-evidence-lib.libraries.example.test";

describe("Evidence Library setup draft", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", testPlatformDomain);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates, reopens, and retries one linked setup draft", async () => {
    const t = convexTest(schema, modules);
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
    const reopenedFromNewSession = await t
      .withIdentity({
        subject: "user_setup_admin",
        o: { id: "org_setup", rol: "org:admin" },
      })
      .query(api.evidenceLibraries.queries.getCurrentSetupDraft, {});
    const retried = await admin.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    await expect(
      admin.mutation(api.evidenceLibraries.operations.queueOperation, {
        libraryId: created.libraryId,
        kind: "setup" as never,
        idempotencyKey: "another-setup-operation",
      }),
    ).rejects.toThrow(/ArgumentValidationError|Validator/);
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
      sections: await ctx.db.query("evidenceLibraryConfigSections").collect(),
    }));

    expect(retried).toEqual(created);
    expect(created).toMatchObject({
      name: setupArgs.name,
      publicAddress: setupAddress,
      shortName: setupArgs.name,
      slug: "climate-evidence",
    });
    expect(reopenedFromNewSession).toMatchObject({
      draftId: created.draftId,
      libraryId: created.libraryId,
      name: setupArgs.name,
      publicAddress: setupAddress,
      shortName: setupArgs.name,
      slug: "climate-evidence",
    });
    expect(reopened).toMatchObject({
      draft: {
        _id: created.draftId,
        baseRevisionId: created.revisionId,
        editVersion: 0,
      },
      identity: {
        name: setupArgs.name,
        publicAddress: setupAddress,
        shortName: setupArgs.name,
        slug: "climate-evidence",
      },
      library: {
        _id: created.libraryId,
        draftId: created.draftId,
        latestRevisionId: created.revisionId,
        runtimeBindingId: created.runtimeBindingId,
        setupOperationId: created.setupOperationId,
        state: "provisioning",
      },
      publicAddress: setupAddress,
      revision: {
        _id: created.revisionId,
        revisionKey: "r1",
        revisionNumber: 1,
      },
      runtimeBinding: {
        _id: created.runtimeBindingId,
        state: "pending",
        targetBaseUrl: setupAddress,
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
    expect(counts).toMatchObject({
      drafts: 1,
      libraries: 1,
      operations: 1,
      revisions: 1,
      runtimeBindings: 1,
    });
    expect(counts.sections).toHaveLength(1);
    expect(counts.sections[0]).toMatchObject({
      draftId: created.draftId,
      kind: "draft",
      libraryId: created.libraryId,
      payload: {
        baseUrl: setupAddress,
        name: setupArgs.name,
        shortName: setupArgs.name,
      },
      sectionKey: "identity",
    });
  });

  it("rejects a changed retry and resolves a platform-address collision", async () => {
    const t = convexTest(schema, modules);
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
    await seedOrganization(t, {
      clerkOrganizationId: "org_third",
      clerkUserId: "user_third",
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
    const third = t.withIdentity({
      subject: "user_third",
      o: { id: "org_third", rol: "org:admin" },
    });

    await first.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    await expect(
      first.mutation(api.evidenceLibraries.mutations.createSetupDraft, {
        name: "A different library",
      }),
    ).rejects.toThrow(/CONFLICT/);
    const preview = await second.query(
      api.evidenceLibraries.queries.previewSetupDraftName,
      setupArgs,
    );
    const secondCreated = await second.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    const thirdCreated = await third.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    const secondRetriedAfterAnotherCollision = await second.mutation(
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
    }));

    expect(preview).toEqual({
      name: setupArgs.name,
      publicAddress:
        "https://climate-evidence-2-lib.libraries.example.test",
      shortName: setupArgs.name,
      slug: "climate-evidence-2",
    });
    expect(secondCreated).toMatchObject({
      publicAddress: preview.publicAddress,
      slug: preview.slug,
    });
    expect(thirdCreated).toMatchObject({
      publicAddress:
        "https://climate-evidence-3-lib.libraries.example.test",
      slug: "climate-evidence-3",
    });
    expect(secondRetriedAfterAnotherCollision).toEqual(secondCreated);
    expect(counts).toEqual({
      drafts: 3,
      libraries: 3,
      operations: 3,
      revisions: 3,
      runtimeBindings: 3,
    });
  });

  it("enforces the runtime identity name and short-name limits", async () => {
    const t = convexTest(schema, modules);
    await seedOrganization(t, {
      clerkOrganizationId: "org_limits",
      clerkUserId: "user_limits",
      role: "org:admin",
    });
    const admin = t.withIdentity({
      subject: "user_limits",
      o: { id: "org_limits", rol: "org:admin" },
    });

    await expect(
      admin.mutation(api.evidenceLibraries.mutations.createSetupDraft, {
        name: "a".repeat(101),
      }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
    expect(
      await t.run((ctx) => ctx.db.query("evidenceLibraries").collect()),
    ).toHaveLength(0);

    const created = await admin.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      { name: "a".repeat(100) },
    );
    expect(created.name).toHaveLength(100);
    expect(created.shortName).toHaveLength(40);
  });

  it("rejects partial pending and ready bindings and requires failed errors", async () => {
    const t = convexTest(schema, modules);
    await seedOrganization(t, {
      clerkOrganizationId: "org_binding_states",
      clerkUserId: "user_binding_states",
      role: "org:admin",
    });
    const admin = t.withIdentity({
      subject: "user_binding_states",
      o: { id: "org_binding_states", rol: "org:admin" },
    });
    const created = await admin.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      setupArgs,
    );
    const incompleteReadyBinding = {
      libraryId: created.libraryId,
      targetBaseUrl: "https://incomplete-ready.example.org",
      state: "ready",
      createdAt: 1,
      updatedAt: 1,
    };
    const partialPendingBinding = {
      libraryId: created.libraryId,
      targetRuntimeId: "runtime_without_services",
      targetBaseUrl: "https://partial-pending.example.org",
      state: "pending",
      createdAt: 1,
      updatedAt: 1,
    };
    const failedBindingWithoutError = {
      libraryId: created.libraryId,
      targetBaseUrl: "https://failed-without-error.example.org",
      state: "failed",
      createdAt: 1,
      updatedAt: 1,
    };

    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "evidenceLibraryRuntimeBindings",
          partialPendingBinding as never,
        ),
      ),
    ).rejects.toThrow(/Validator error/);
    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "evidenceLibraryRuntimeBindings",
          incompleteReadyBinding as never,
        ),
      ),
    ).rejects.toThrow(/Validator error/);
    await expect(
      t.run((ctx) =>
        ctx.db.insert(
          "evidenceLibraryRuntimeBindings",
          failedBindingWithoutError as never,
        ),
      ),
    ).rejects.toThrow(/Validator error/);

    await t.run((ctx) =>
      ctx.db.replace(
        "evidenceLibraryRuntimeBindings",
        created.runtimeBindingId,
        {
          ...failedBindingWithoutError,
          state: "failed",
          error: {
            code: "runtime-unavailable",
            message: "The runtime could not be reached",
          },
        } as never,
      ),
    );
    expect(
      await t.run((ctx) =>
        ctx.db.get("evidenceLibraryRuntimeBindings", created.runtimeBindingId),
      ),
    ).toMatchObject({
      state: "failed",
      error: {
        code: "runtime-unavailable",
        message: "The runtime could not be reached",
      },
    });
  });

  it("allows only an active organization admin to create or reopen setup", async () => {
    const t = convexTest(schema, modules);
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
      member.mutation(
        api.evidenceLibraries.mutations.createSetupDraft,
        setupArgs,
      ),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      member.query(
        api.evidenceLibraries.queries.previewSetupDraftName,
        setupArgs,
      ),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      member.query(api.evidenceLibraries.queries.getCurrentSetupDraft, {}),
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
