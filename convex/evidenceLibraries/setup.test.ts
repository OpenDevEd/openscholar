/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  createActivatedSetupFixture,
  reserveLibraryAddressByName,
} from "../../tests/helpers/evidence-library-setup-fixture";

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
const setupAddress = "https://climate-evidence-lib.libraries.example.test";

describe("Evidence Library setup draft", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", testPlatformDomain);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("reads a saved failure and retries the same setup operation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    const fixture = await createActivatedSetupFixture("saved_status_retry");
    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.failSetupOperation,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        expectedStage: "database",
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "The library database could not be reached.",
        },
      },
    );

    const failed = await fixture.admin.query(
      api.evidenceLibraries.queries.getSetupDraftSelection,
      { libraryId: fixture.created.libraryId },
    );
    expect(failed?.setupOperation).toMatchObject({
      _id: fixture.created.setupOperationId,
      attemptCount: 1,
      status: "failed",
      stage: "database",
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "The library database could not be reached.",
        stage: "database",
      },
    });

    await expect(
      fixture.admin.mutation(api.evidenceLibraries.mutations.retrySetup, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toEqual({
      operationId: fixture.created.setupOperationId,
      status: "running",
    });

    const refreshed = await fixture.admin.query(
      api.evidenceLibraries.queries.getSetupDraftSelection,
      { libraryId: fixture.created.libraryId },
    );
    const operations = await fixture.t.run((ctx) =>
      ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .take(2),
    );
    expect(refreshed?.setupOperation).toMatchObject({
      _id: fixture.created.setupOperationId,
      attemptCount: 2,
      status: "running",
      stage: "database",
    });
    expect(refreshed?.setupOperation).not.toHaveProperty("error");
    expect(operations).toHaveLength(1);
    expect(operations[0]?._id).toBe(fixture.created.setupOperationId);
  });

  it("creates one linked setup draft and refuses a second under the same name", async () => {
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

    const created = await reserveLibraryAddressByName(admin, setupArgs.name);
    const reopened = await admin.query(
      api.evidenceLibraries.queries.getSetupDraft,
      { libraryId: created.libraryId },
    );
    const refused = await admin.mutation(
      internal.evidenceLibraries.mutations.reserveAddress,
      {
        name: setupArgs.name,
        publicAddress: "https://climate-evidence-2-lib.libraries.example.test",
        slug: "climate-evidence-2",
      },
    );
    await expect(
      admin.mutation(api.evidenceLibraries.operations.queueOperation, {
        libraryId: created.libraryId,
        kind: "setup" as never,
        idempotencyKey: "another-setup-operation",
      }),
    ).rejects.toThrow(/ArgumentValidationError|Validator/);
    await expect(
      admin.mutation(internal.evidenceLibraries.operations.startOperation, {
        libraryId: created.libraryId,
        operationId: created.setupOperationId,
        stage: "assembling",
      }),
    ).rejects.toThrow(/fixed setup transitions/);
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

    expect(refused).toEqual({
      status: "name-taken",
      libraryId: created.libraryId,
    });
    expect(created).toMatchObject({
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
    expect(counts.sections).toHaveLength(2);
    expect(
      counts.sections.map((section) => section.sectionKey).sort(),
    ).toEqual(["identity", "localization"]);
    expect(
      counts.sections.find((section) => section.sectionKey === "identity"),
    ).toMatchObject({
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

  it("creates two named setup drafts for one organization and refuses a repeated name", async () => {
    const t = convexTest(schema, modules);
    await seedOrganization(t, {
      clerkOrganizationId: "org_multiple",
      clerkUserId: "user_multiple",
      role: "org:admin",
    });
    const admin = t.withIdentity({
      subject: "user_multiple",
      o: { id: "org_multiple", rol: "org:admin" },
    });

    const first = await reserveLibraryAddressByName(admin, "Climate Evidence");
    const second = await reserveLibraryAddressByName(
      admin,
      "Education Evidence",
    );
    const firstRepeated = await admin.mutation(
      internal.evidenceLibraries.mutations.reserveAddress,
      {
        name: "Climate Evidence",
        publicAddress: "https://climate-evidence-2-lib.libraries.example.test",
        slug: "climate-evidence-2",
      },
    );
    const state = await t.run(async (ctx) => ({
      drafts: await ctx.db.query("evidenceLibraryConfigDrafts").collect(),
      libraries: await ctx.db.query("evidenceLibraries").collect(),
      operations: await ctx.db
        .query("evidenceLibraryConfigOperations")
        .collect(),
      revisions: await ctx.db.query("evidenceLibraryConfigRevisions").collect(),
      runtimeBindings: await ctx.db
        .query("evidenceLibraryRuntimeBindings")
        .collect(),
      sections: await ctx.db.query("evidenceLibraryConfigSections").collect(),
    }));

    expect(firstRepeated).toEqual({
      status: "name-taken",
      libraryId: first.libraryId,
    });
    expect(second.libraryId).not.toBe(first.libraryId);
    expect(state.libraries.map((library) => library.name).sort()).toEqual([
      "Climate Evidence",
      "Education Evidence",
    ]);
    expect(state.drafts).toHaveLength(2);
    expect(state.operations).toHaveLength(2);
    expect(state.revisions).toHaveLength(2);
    expect(state.runtimeBindings).toHaveLength(2);
    expect(state.sections).toHaveLength(4);
    expect(new Set(state.libraries.map((library) => library.draftId))).toEqual(
      new Set([first.draftId, second.draftId]),
    );
    expect(
      new Set(state.libraries.map((library) => library.runtimeBindingId)),
    ).toEqual(new Set([first.runtimeBindingId, second.runtimeBindingId]));
  });

  it("returns no setup selection for invalid, deleted, or other-organization IDs", async () => {
    const t = convexTest(schema, modules);
    await seedOrganization(t, {
      clerkOrganizationId: "org_selection",
      clerkUserId: "user_selection",
      role: "org:admin",
    });
    await seedOrganization(t, {
      clerkOrganizationId: "org_selection_other",
      clerkUserId: "user_selection_other",
      role: "org:admin",
    });
    const admin = t.withIdentity({
      subject: "user_selection",
      o: { id: "org_selection", rol: "org:admin" },
    });
    const otherAdmin = t.withIdentity({
      subject: "user_selection_other",
      o: { id: "org_selection_other", rol: "org:admin" },
    });
    const own = await reserveLibraryAddressByName(admin, "Owned Selection");
    const deleted = await reserveLibraryAddressByName(
      admin,
      "Deleted Selection",
    );
    const other = await reserveLibraryAddressByName(
      otherAdmin,
      "Other Selection",
    );
    await t.run((ctx) => ctx.db.delete("evidenceLibraries", deleted.libraryId));

    await expect(
      admin.query(api.evidenceLibraries.queries.getSetupDraftSelection, {
        libraryId: own.libraryId,
      }),
    ).resolves.toMatchObject({ library: { _id: own.libraryId } });
    await expect(
      admin.query(api.evidenceLibraries.queries.getSetupDraftSelection, {
        libraryId: "not-a-convex-id",
      }),
    ).resolves.toBeNull();
    await expect(
      admin.query(api.evidenceLibraries.queries.getSetupDraftSelection, {
        libraryId: deleted.libraryId,
      }),
    ).resolves.toBeNull();
    await expect(
      admin.query(api.evidenceLibraries.queries.getSetupDraftSelection, {
        libraryId: other.libraryId,
      }),
    ).resolves.toBeNull();
  });

  it("offers the next numbered address when our database holds one", async () => {
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
    await seedOrganization(t, {
      clerkOrganizationId: "org_fourth",
      clerkUserId: "user_fourth",
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

    await reserveLibraryAddressByName(first, setupArgs.name);
    const secondCreated = await reserveLibraryAddressByName(
      second,
      setupArgs.name,
    );
    const thirdCreated = await reserveLibraryAddressByName(
      third,
      setupArgs.name,
    );
    const fourth = t.withIdentity({
      subject: "user_fourth",
      o: { id: "org_fourth", rol: "org:admin" },
    });
    const nextForFourth = await fourth.query(
      internal.evidenceLibraries.queries.readAddressCandidates,
      { name: setupArgs.name },
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

    expect(secondCreated).toMatchObject({
      name: setupArgs.name,
      publicAddress: "https://climate-evidence-2-lib.libraries.example.test",
      shortName: setupArgs.name,
      slug: "climate-evidence-2",
    });
    expect(thirdCreated).toMatchObject({
      publicAddress: "https://climate-evidence-3-lib.libraries.example.test",
      slug: "climate-evidence-3",
    });
    expect(
      nextForFourth.status === "candidates"
        ? nextForFourth.candidates.slice(0, 2)
        : nextForFourth,
    ).toEqual([
      {
        slug: "climate-evidence-4",
        publicAddress: "https://climate-evidence-4-lib.libraries.example.test",
      },
      {
        slug: "climate-evidence-5",
        publicAddress: "https://climate-evidence-5-lib.libraries.example.test",
      },
    ]);
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
      admin.query(internal.evidenceLibraries.queries.readAddressCandidates, {
        name: "a".repeat(101),
      }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
    expect(
      await t.run((ctx) => ctx.db.query("evidenceLibraries").collect()),
    ).toHaveLength(0);

    const created = await reserveLibraryAddressByName(admin, "a".repeat(100));
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
    const created = await reserveLibraryAddressByName(admin, setupArgs.name);
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
    const created = await reserveLibraryAddressByName(admin, setupArgs.name);
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
      member.mutation(internal.evidenceLibraries.mutations.reserveAddress, {
        name: setupArgs.name,
        publicAddress: setupAddress,
        slug: "climate-evidence",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      member.query(api.evidenceLibraries.queries.getSetupDraft, {
        libraryId: created.libraryId,
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      member.mutation(api.evidenceLibraries.mutations.retrySetup, {
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
