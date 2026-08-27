/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  createReadySetupFixture,
  essentialSetupSections,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";

const RUNTIME_COMMIT = "a".repeat(40);
const NEWER_COMMIT = "b".repeat(40);

type Fixture = Awaited<ReturnType<typeof createReadySetupFixture>>;

// The ready fixture runs r2 (r1 is the empty creation revision). This
// publishes a changed identity as r3 and marks it complete, so the library
// has a previous version (r2) and a live version (r3).
async function publishSecondRevision(fixture: Fixture) {
  const saved = await fixture.admin.mutation(
    api.evidenceLibraries.mutations.saveDraftSections,
    {
      libraryId: fixture.created.libraryId,
      sections: toSectionRows({
        ...essentialSetupSections,
        identity: { ...essentialSetupSections.identity, name: "Second name" },
      }),
      expectedEditVersion: fixture.activated.editVersion,
    },
  );
  const activated = await fixture.admin.mutation(
    api.evidenceLibraries.mutations.activateConfiguration,
    {
      libraryId: fixture.created.libraryId,
      expectedEditVersion: saved.editVersion,
    },
  );
  await markSucceeded(fixture, activated.operationId, activated.revisionId);
  return activated;
}

async function markSucceeded(
  fixture: Fixture,
  operationId: Id<"evidenceLibraryConfigOperations">,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
) {
  await fixture.t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.patch(operationId, {
      status: "succeeded",
      stage: "completed",
      completedAt: now,
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(fixture.created.libraryId, {
      activeRevisionId: revisionId,
      activeDeploymentOperationId: operationId,
      updatedAt: now,
    });
  });
}

async function markFailed(
  fixture: Fixture,
  operationId: Id<"evidenceLibraryConfigOperations">,
) {
  await fixture.t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.patch(operationId, {
      status: "failed",
      error: {
        code: "TEST",
        message: "Deployment failed",
        stage: "publishing",
      },
      completedAt: now,
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
      updatedAt: now,
    });
  });
}

async function readSectionPayloads(
  fixture: Fixture,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
) {
  return await fixture.t.run(async (ctx) => {
    const rows = await ctx.db
      .query("evidenceLibraryConfigSections")
      .withIndex("by_revisionId_and_sectionKey", (query) =>
        query.eq("revisionId", revisionId),
      )
      .collect();
    return Object.fromEntries(rows.map((row) => [row.sectionKey, row.payload]));
  });
}

describe("Evidence Library versions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00Z"));
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("restores a previous version as a new revision with the same sections and publishes it", async () => {
    const fixture = await createReadySetupFixture("restore");
    const second = await publishSecondRevision(fixture);
    const firstRevisionId = fixture.activated.revisionId;
    vi.setSystemTime(Date.now() + 60_000);

    const restored = await fixture.admin.mutation(
      api.evidenceLibraries.versions.restoreRevision,
      { libraryId: fixture.created.libraryId, revisionId: firstRevisionId },
    );
    expect(restored).toMatchObject({
      revisionKey: "r4",
      revisionNumber: 4,
      status: "running",
    });
    expect(restored.revisionId).not.toBe(firstRevisionId);

    const state = await fixture.t.run(async (ctx) => ({
      revision: await ctx.db.get(restored.revisionId),
      operation: await ctx.db.get(restored.operationId),
      draft: await ctx.db.get(fixture.created.draftId),
      draftSections: await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query.eq("draftId", fixture.created.draftId),
        )
        .collect(),
      library: await ctx.db.get(fixture.created.libraryId),
    }));
    expect(state.revision).toMatchObject({
      rollbackOfRevisionId: firstRevisionId,
      basedOnRevisionId: second.revisionId,
    });
    expect(state.revision!.createdAt).toBeGreaterThan(
      (await fixture.t.run((ctx) => ctx.db.get(firstRevisionId)))!.createdAt,
    );
    expect(await readSectionPayloads(fixture, restored.revisionId)).toEqual(
      await readSectionPayloads(fixture, firstRevisionId),
    );
    expect(
      Object.fromEntries(
        state.draftSections.map((row) => [row.sectionKey, row.payload]),
      ),
    ).toEqual(await readSectionPayloads(fixture, firstRevisionId));
    expect(state.draft).toMatchObject({
      baseRevisionId: restored.revisionId,
      editVersion: restored.editVersion,
    });
    expect(state.operation).toMatchObject({
      kind: "publish",
      status: "running",
      revisionId: restored.revisionId,
    });
    expect(state.library?.activeRevisionId).toBe(second.revisionId);
    expect(state.library?.latestRevisionId).toBe(restored.revisionId);

    const versionsWhileDeploying = await fixture.admin.query(
      api.evidenceLibraries.versions.listVersions,
      { libraryId: fixture.created.libraryId },
    );
    expect(
      versionsWhileDeploying.map(({ revisionKey, status, kind }) => ({
        revisionKey,
        status,
        kind,
      })),
    ).toEqual([
      { revisionKey: "r4", status: "deploying", kind: "config" },
      { revisionKey: "r3", status: "live", kind: "config" },
      { revisionKey: "r2", status: "previous", kind: "config" },
    ]);
    expect(versionsWhileDeploying[0]?.changedSections).toEqual(["identity"]);

    await markSucceeded(fixture, restored.operationId, restored.revisionId);
    const versions = await fixture.admin.query(
      api.evidenceLibraries.versions.listVersions,
      { libraryId: fixture.created.libraryId },
    );
    expect(
      versions.map(({ revisionKey, status }) => [revisionKey, status]),
    ).toEqual([
      ["r4", "live"],
      ["r3", "previous"],
      ["r2", "previous"],
    ]);
  });

  it("refuses to restore while a publish is running or from another library", async () => {
    const fixture = await createReadySetupFixture("restore-refused");
    const foreignRevisionId = await fixture.t.run(async (ctx) => {
      const libraryId = await ctx.db.insert("evidenceLibraries", {
        organizationId: fixture.organizationId,
        name: "Other library",
        slug: "other-library",
        state: "active",
        createdByClerkUserId: fixture.clerkUserId,
        updatedByClerkUserId: fixture.clerkUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      const revision = await ctx.db.get(fixture.activated.revisionId);
      return await ctx.db.insert("evidenceLibraryConfigRevisions", {
        ...revision!,
        _id: undefined,
        _creationTime: undefined,
        libraryId,
      } as never);
    });
    await expect(
      fixture.admin.mutation(api.evidenceLibraries.versions.restoreRevision, {
        libraryId: fixture.created.libraryId,
        revisionId: foreignRevisionId,
      }),
    ).rejects.toThrow(/not found/);

    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: toSectionRows({
          ...essentialSetupSections,
          identity: { ...essentialSetupSections.identity, name: "Running" },
        }),
        expectedEditVersion: fixture.activated.editVersion,
      },
    );
    await fixture.admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      {
        libraryId: fixture.created.libraryId,
        expectedEditVersion: saved.editVersion,
      },
    );
    await expect(
      fixture.admin.mutation(api.evidenceLibraries.versions.restoreRevision, {
        libraryId: fixture.created.libraryId,
        revisionId: fixture.activated.revisionId,
      }),
    ).rejects.toThrow(/already running/);
  });

  it("lists failed publishes and software updates with who started them", async () => {
    const fixture = await createReadySetupFixture("versions-list");
    const second = await publishSecondRevision(fixture);
    await markFailed(fixture, second.operationId);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.libraryId, {
        activeRevisionId: fixture.activated.revisionId,
        activeDeploymentOperationId: fixture.created.setupOperationId,
      });
      await ctx.db.insert("users", {
        clerkId: fixture.clerkUserId,
        email: "owner@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceLibraryConfigOperations", {
        libraryId: fixture.created.libraryId,
        kind: "publish",
        idempotencyKey: `runtime-update:${RUNTIME_COMMIT}:${NEWER_COMMIT}`,
        runtimeUpdate: { from: RUNTIME_COMMIT, to: NEWER_COMMIT },
        revisionId: fixture.activated.revisionId,
        status: "queued",
        stage: "queued",
        attemptCount: 0,
        requestedByClerkUserId: "user_someone_else",
        createdAt: Date.now() + 1,
        updatedAt: Date.now() + 1,
      });
    });

    const versions = await fixture.admin.query(
      api.evidenceLibraries.versions.listVersions,
      { libraryId: fixture.created.libraryId },
    );
    expect(
      versions.map(({ revisionKey, status, kind, by, changedSections }) => ({
        revisionKey,
        status,
        kind,
        by,
        changedSections,
      })),
    ).toEqual([
      {
        revisionKey: "r2",
        status: "deploying",
        kind: "runtime",
        by: "user_someone_else",
        changedSections: [],
      },
      {
        revisionKey: "r3",
        status: "failed",
        kind: "config",
        by: "Ada Lovelace",
        changedSections: ["identity"],
      },
      {
        revisionKey: "r2",
        status: "live",
        kind: "config",
        by: "Ada Lovelace",
        changedSections: ["footer", "identity", "localization", "theme"],
      },
    ]);
  });
});

describe("Evidence Library address move", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_URL", "http://coolify:8080");
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /**
   * Coolify serves only this library, and every other numbered address
   * answers our proxy's free signal.
   */
  function stubAddressChecks(currentAddress: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (request) => {
        const url = new URL(String(request));
        if (url.origin === "http://coolify:8080") {
          return new Response(
            JSON.stringify([{ fqdn: currentAddress }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.hostname === new URL(currentAddress).hostname) {
          return new Response("served", { status: 200 });
        }
        return new Response("no available server", { status: 503 });
      }),
    );
  }

  /** The publish operation the move queued. */
  async function readMoveOperation(fixture: Fixture) {
    return await fixture.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .order("desc")
        .take(5);
      return rows.find((row) => row.addressMove) ?? null;
    });
  }

  it("plans a move to the next free address without writing it yet", async () => {
    const fixture = await createReadySetupFixture("address-live-move");
    const movedTo = "https://climate-evidence-2-lib.libraries.example.test";
    stubAddressChecks(fixture.created.publicAddress);

    const moved = await fixture.admin.action(
      api.evidenceLibraries.addressActions.moveLibraryAddress,
      { libraryId: fixture.created.libraryId },
    );
    expect(moved).toMatchObject({
      movedFrom: fixture.created.publicAddress,
      movedTo,
      status: "moving",
    });
    const movedOperation = await readMoveOperation(fixture);

    const state = await fixture.t.run(async (ctx) => {
      const binding = await ctx.db.get(fixture.created.runtimeBindingId);
      const operation = movedOperation;
      const identity = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query
            .eq("revisionId", fixture.activated.revisionId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      const draftIdentity = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query
            .eq("draftId", fixture.created.draftId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      return { binding, draftIdentity, identity, operation };
    });
    // The library keeps its address until Coolify serves the new one.
    expect(state.binding).toMatchObject({
      targetBaseUrl: fixture.created.publicAddress,
    });
    expect(state.identity?.payload).toMatchObject({
      baseUrl: fixture.created.publicAddress,
    });
    expect(state.draftIdentity?.payload).toMatchObject({
      baseUrl: fixture.created.publicAddress,
    });
    expect(state.operation).toMatchObject({
      kind: "publish",
      status: "running",
      addressMove: {
        from: fixture.created.publicAddress,
        to: movedTo,
        applied: false,
      },
    });
  });

  it("refuses a second move while the first one is still running", async () => {
    const fixture = await createReadySetupFixture("address-live-busy");
    stubAddressChecks(fixture.created.publicAddress);
    await fixture.admin.action(
      api.evidenceLibraries.addressActions.moveLibraryAddress,
      { libraryId: fixture.created.libraryId },
    );
    await expect(
      fixture.admin.action(
        api.evidenceLibraries.addressActions.moveLibraryAddress,
        { libraryId: fixture.created.libraryId },
      ),
    ).rejects.toThrow(/already running/);
  });

  it("keeps the numbering going when the next address is taken", async () => {
    const fixture = await createReadySetupFixture("address-live-taken");
    stubAddressChecks(fixture.created.publicAddress);
    await fixture.t.run(async (ctx) => {
      const other = await ctx.db.insert("evidenceLibraries", {
        organizationId: fixture.organizationId,
        name: "Other library",
        slug: "other-library",
        state: "active",
        createdByClerkUserId: fixture.clerkUserId,
        updatedByClerkUserId: fixture.clerkUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceLibraryRuntimeBindings", {
        libraryId: other,
        targetBaseUrl: "https://climate-evidence-2-lib.libraries.example.test",
        state: "pending",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      fixture.admin.action(
        api.evidenceLibraries.addressActions.moveLibraryAddress,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toMatchObject({
      movedTo: "https://climate-evidence-3-lib.libraries.example.test",
    });
  });
});
