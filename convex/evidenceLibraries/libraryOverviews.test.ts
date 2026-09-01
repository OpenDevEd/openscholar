/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  createActivatedSetupFixture,
  createDraftSetupFixture,
  createReadySetupFixture,
  reserveLibraryAddressByName,
} from "../../tests/helpers/evidence-library-setup-fixture";

describe("library overviews", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "true");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the library that already holds a wanted name", async () => {
    const fixture = await createActivatedSetupFixture("overview_preview");

    await expect(
      fixture.admin.query(
        internal.evidenceLibraries.queries.readAddressCandidates,
        { name: "Climate Evidence" },
      ),
    ).resolves.toEqual({
      status: "name-taken",
      libraryId: fixture.created.libraryId,
    });
    await expect(
      fixture.admin.query(
        internal.evidenceLibraries.queries.readAddressCandidates,
        { name: "   " },
      ),
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("reports each library's status, address and accent colour", async () => {
    const fixture = await createActivatedSetupFixture("overview_status");
    const libraryId = fixture.created.libraryId;

    const settingUp = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(settingUp).toEqual([
      {
        _id: libraryId,
        name: "Climate Evidence",
        publicAddress: "https://climate-evidence-lib.libraries.example.test",
        status: "setting_up",
        setupStage: "database",
        teardownStage: null,
        operation: { stage: "database" },
        lastActivatedAt: null,
        accentColor: "#005A9C",
        faviconUrl: "https://assets.example.test/favicon.ico",
      },
    ]);

    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.failSetupOperation,
      {
        libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        expectedStage: "database",
        error: { code: "DATABASE_UNAVAILABLE", message: "No database." },
      },
    );
    const failed = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(failed[0]).toMatchObject({ status: "setup_failed", setupStage: "database" });

    await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      { libraryId, confirmationName: "Climate Evidence" },
    );
    const deleting = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(deleting[0]).toMatchObject({
      status: "deleting",
      setupStage: null,
      teardownStage: "coolify",
    });
  });

  it("lists a fresh draft as a draft with no address facts beyond its own", async () => {
    const fixture = await createActivatedSetupFixture("overview_draft");
    const draft = await reserveLibraryAddressByName(
      fixture.admin,
      "Second Library",
    );
    const overviews = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(overviews.find((row) => row._id === draft.libraryId)).toEqual({
      _id: draft.libraryId,
      name: "Second Library",
      publicAddress: "https://second-library-lib.libraries.example.test",
      status: "draft",
      setupStage: null,
      teardownStage: null,
      operation: null,
      lastActivatedAt: null,
      accentColor: null,
      faviconUrl: null,
    });
  });

  it("reports the build currently running for an active library", async () => {
    const fixture = await createReadySetupFixture("overview_build");
    const runtimeUpdate = {
      from: "a".repeat(40),
      to: "b".repeat(40),
      fromImage: "runtime:old",
      toImage: "runtime:new",
    };
    await fixture.t.run(async (ctx) => {
      const library = await ctx.db.get(fixture.created.libraryId);
      if (!library?.activeRevisionId) throw new Error("active revision missing");
      await ctx.db.insert("evidenceLibraryConfigOperations", {
        libraryId: library._id,
        kind: "publish",
        idempotencyKey: "overview:running-build",
        revisionId: library.activeRevisionId,
        runtimeUpdate,
        status: "running",
        stage: "publishing",
        attemptCount: 1,
        requestedByClerkUserId: fixture.clerkUserId,
        createdAt: Date.now() + 1_000,
        updatedAt: Date.now() + 1_000,
      });
    });

    const overviews = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );

    expect(overviews[0]).toMatchObject({
      status: "active",
      operation: { stage: "publishing", runtimeUpdate },
    });
  });

  it("keeps a deleting library listable after its draft is removed", async () => {
    const fixture = await createDraftSetupFixture("overview_teardown_draft");
    const requested = await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        confirmationName: "Climate Evidence",
      },
    );
    const claim = await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        operationId: requested.operationId,
      },
    );
    if (!claim.claimed) throw new Error("teardown was not claimed");

    let reachedDraftDeletion = false;
    for (let batch = 0; batch < 20; batch += 1) {
      await fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
          attemptToken: claim.attemptToken,
        },
      );
      const state = await fixture.t.run(async (ctx) => ({
        draft: await ctx.db.get(fixture.created.draftId),
        library: await ctx.db.get(fixture.created.libraryId),
      }));
      if (!state.draft && state.library) {
        reachedDraftDeletion = true;
        break;
      }
    }
    expect(reachedDraftDeletion).toBe(true);

    const overviews = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(overviews).toEqual([
      expect.objectContaining({
        _id: fixture.created.libraryId,
        status: "deleting",
      }),
    ]);
  });

  it("tells the pages whether Evidence Libraries are switched on", async () => {
    const fixture = await createDraftSetupFixture("overview_switch");

    await expect(
      fixture.admin.query(
        api.evidenceLibraries.queries.getEvidenceLibrariesAccess,
        {},
      ),
    ).resolves.toEqual({ enabled: true });

    // The real switch is Clerk public metadata via the webhook; the test flips
    // the projected row directly.
    await fixture.t.run(async (ctx) => {
      const organization = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", fixture.clerkOrganizationId),
        )
        .unique();
      if (!organization) throw new Error("organization row missing");
      await ctx.db.patch("organizations", organization._id, {
        evidenceLibrariesEnabled: false,
      });
    });

    await expect(
      fixture.admin.query(
        api.evidenceLibraries.queries.getEvidenceLibrariesAccess,
        {},
      ),
    ).resolves.toEqual({ enabled: false });
  });

  it("answers 'off' when the token role no longer matches the stored role", async () => {
    const fixture = await createDraftSetupFixture("overview_switch_role");
    // The stored membership is an admin; the token claims plain membership.
    const drifted = fixture.t.withIdentity({
      subject: fixture.clerkUserId,
      o: { id: fixture.clerkOrganizationId, rol: "org:member" },
    });

    await expect(
      drifted.query(
        api.evidenceLibraries.queries.getEvidenceLibrariesAccess,
        {},
      ),
    ).resolves.toEqual({ enabled: false });
  });

  it("answers 'off' instead of throwing when nobody is signed in", async () => {
    const fixture = await createDraftSetupFixture("overview_switch_anon");

    await expect(
      fixture.t.query(
        api.evidenceLibraries.queries.getEvidenceLibrariesAccess,
        {},
      ),
    ).resolves.toEqual({ enabled: false });
  });
  it("says which part of a deletion stopped, for each part", async () => {
    const fixture = await createActivatedSetupFixture("overview_teardown");
    const libraryId = fixture.created.libraryId;

    // Every stage the deletion can stop in, and the words the page uses.
    for (const failedStep of [
      "runtime",
      "files",
      "database",
      "records",
    ] as const) {
      await fixture.t.run(async (ctx) => {
        await ctx.db.patch(libraryId, { state: "disabled" });
        const existing = await ctx.db
          .query("evidenceLibraryConfigOperations")
          .withIndex("by_libraryId_and_createdAt", (query) =>
            query.eq("libraryId", libraryId),
          )
          .order("desc")
          .collect();
        for (const operation of existing) {
          if (operation.kind === "teardown") await ctx.db.delete(operation._id);
        }
        await ctx.db.insert("evidenceLibraryConfigOperations", {
          libraryId,
          kind: "teardown",
          idempotencyKey: `teardown:${failedStep}`,
          status: "failed",
          stage: "coolify",
          attemptCount: 5,
          error: {
            code: "RUNTIME_UNAVAILABLE",
            message: "The runtime service returned 503",
            stage: "coolify",
          },
          teardownFailedStep: failedStep,
          requestedByClerkUserId: "someone",
          // Clearly the newest, so it is the one the page reads.
          createdAt: Date.now() + 1_000,
          updatedAt: Date.now() + 1_000,
        });
      });

      const overviews = await fixture.admin.query(
        api.evidenceLibraries.queries.listLibraryOverviews,
        {},
      );
      const row = overviews.find((library) => library._id === libraryId);
      expect(row?.status).toBe("deleting");
      // What is stored reaches the page, and nothing else does.
      expect(row?.teardownFailedStep).toBe(failedStep);
    }
  });

  it("says nothing about a deletion that is still going", async () => {
    const fixture = await createActivatedSetupFixture("overview_teardown_ok");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(libraryId, { state: "disabled" });
      await ctx.db.insert("evidenceLibraryConfigOperations", {
        libraryId,
        kind: "teardown",
        idempotencyKey: "teardown:running",
        status: "running",
        stage: "storage",
        attemptCount: 1,
        requestedByClerkUserId: "someone",
        // Clearly the newest, so it is the one the page reads.
        createdAt: Date.now() + 1_000,
        updatedAt: Date.now() + 1_000,
      });
    });

    const overviews = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    const row = overviews.find((library) => library._id === libraryId);
    expect(row?.teardownStage).toBe("storage");
    expect(row?.teardownFailedStep).toBeUndefined();
  });

});
