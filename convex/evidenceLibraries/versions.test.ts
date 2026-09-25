import { seedFeatureUser } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  createReadySetupFixture,
  essentialSetupSections,
  TEST_RUNTIME_IMAGE,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";

const RUNTIME_COMMIT = "a".repeat(40);
const NEWER_COMMIT = "b".repeat(40);
const NEWER_RUNTIME_IMAGE = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"f".repeat(64)}`;

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

  it("migrates a historical version into a current restore candidate without rewriting history", async () => {
    const fixture = await createReadySetupFixture("restore-v2-candidate");
    const second = await publishSecondRevision(fixture);
    const historicalRevisionId = fixture.activated.revisionId;
    const historicalBefore = await fixture.t.run((ctx) =>
      ctx.db.get(historicalRevisionId),
    );

    await fixture.t.run(async (ctx) => {
      const identity = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query
            .eq("revisionId", historicalRevisionId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      if (
        !identity ||
        identity.payload === null ||
        typeof identity.payload !== "object"
      ) {
        throw new Error("Historical identity section is missing");
      }
      const { assets: _assets, ...legacyIdentity } = identity.payload as Record<
        string,
        unknown
      >;
      await ctx.db.patch(historicalRevisionId, {
        ownerConfigurationVersion: 1,
      });
      await ctx.db.patch(identity._id, {
        payload: legacyIdentity,
        payloadByteLength: new TextEncoder().encode(
          JSON.stringify(legacyIdentity),
        ).byteLength,
      });
    });

    const restored = await fixture.admin.mutation(
      api.evidenceLibraries.versions.restoreRevision,
      {
        libraryId: fixture.created.libraryId,
        revisionId: historicalRevisionId,
      },
    );
    const state = await fixture.t.run(async (ctx) => {
      const historical = await ctx.db.get(historicalRevisionId);
      const candidate = await ctx.db.get(restored.revisionId);
      const candidateIdentity = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query
            .eq("revisionId", restored.revisionId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      const library = await ctx.db.get(fixture.created.libraryId);
      return { candidate, candidateIdentity, historical, library };
    });

    expect(state.historical?.ownerConfigurationVersion).toBe(1);
    expect(state.historical?.revisionKey).toBe(historicalBefore?.revisionKey);
    expect(state.historical?.revisionNumber).toBe(
      historicalBefore?.revisionNumber,
    );
    expect(state.historical?.createdAt).toBe(historicalBefore?.createdAt);
    expect(state.candidate).toMatchObject({
      basedOnRevisionId: second.revisionId,
      rollbackOfRevisionId: historicalRevisionId,
      ownerConfigurationVersion: 6,
    });
    expect(state.candidateIdentity?.payload).toMatchObject({ assets: {} });
    expect(state.library?.activeRevisionId).toBe(second.revisionId);
    expect(state.library?.latestRevisionId).toBe(restored.revisionId);
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

  it("creates one current runtime candidate for an old active revision and reuses it", async () => {
    const fixture = await createReadySetupFixture("runtime-v2-candidate");
    const activeRevisionId = fixture.activated.revisionId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(activeRevisionId, {
        ownerConfigurationVersion: 1,
      });
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: NEWER_COMMIT,
        latestImage: NEWER_RUNTIME_IMAGE,
        changes: [{ sha: NEWER_COMMIT, message: "feat: newer runtime" }],
        checkedAt: Date.now(),
      });
    });

    const started = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    const firstState = await fixture.t.run(async (ctx) => ({
      active: await ctx.db.get(activeRevisionId),
      candidate: await ctx.db.get(started.revisionId),
      library: await ctx.db.get(fixture.created.libraryId),
      operations: await ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .collect(),
    }));
    expect(started.revisionId).not.toBe(activeRevisionId);
    expect(firstState.active?.ownerConfigurationVersion).toBe(1);
    expect(firstState.candidate).toMatchObject({
      basedOnRevisionId: activeRevisionId,
      ownerConfigurationVersion: 6,
    });
    expect(firstState.library?.activeRevisionId).toBe(activeRevisionId);
    expect(firstState.library?.latestRevisionId).toBe(started.revisionId);
    expect(
      firstState.operations.filter((operation) => operation.runtimeUpdate),
    ).toHaveLength(1);
    expect(
      firstState.operations.find((operation) => operation.runtimeUpdate)
        ?.idempotencyKey,
    ).toContain(`${activeRevisionId}:v6:${RUNTIME_COMMIT}:${NEWER_COMMIT}`);

    await markFailed(fixture, started.operationId);
    const repeated = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    expect(repeated.revisionId).toBe(started.revisionId);
    const repeatedState = await fixture.t.run(async (ctx) =>
      (
        await ctx.db
          .query("evidenceLibraryConfigOperations")
          .withIndex("by_libraryId_and_createdAt", (query) =>
            query.eq("libraryId", fixture.created.libraryId),
          )
          .collect()
      ).filter((operation) => operation.runtimeUpdate),
    );
    expect(repeatedState).toHaveLength(1);
    expect(repeatedState[0]?.revisionId).toBe(started.revisionId);
  });

  it("queues only the previous release pair saved on the runtime binding", async () => {
    const fixture = await createReadySetupFixture("runtime-rollback");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.runtimeBindingId, {
        previousRuntime: {
          commit: NEWER_COMMIT,
          image: NEWER_RUNTIME_IMAGE,
        },
      });
    });

    const started = await fixture.t.mutation(
      internal.evidenceLibraries.versions.startRuntimeRollback,
      { libraryId: fixture.created.libraryId },
    );
    expect(started).toMatchObject({
      status: "running",
      from: RUNTIME_COMMIT,
      to: NEWER_COMMIT,
    });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(started.operationId)),
    ).resolves.toMatchObject({
      kind: "publish",
      requestedByClerkUserId: "integration-owner",
      runtimeUpdate: {
        from: RUNTIME_COMMIT,
        fromImage: TEST_RUNTIME_IMAGE,
        to: NEWER_COMMIT,
        toImage: NEWER_RUNTIME_IMAGE,
      },
    });
  });

  it("reissues a stale restore operation with its candidate after a newer command", async () => {
    const fixture = await createReadySetupFixture("restore-reissue");
    const sourceRevisionId = fixture.activated.revisionId;
    const first = await fixture.admin.mutation(
      api.evidenceLibraries.versions.restoreRevision,
      {
        libraryId: fixture.created.libraryId,
        revisionId: sourceRevisionId,
      },
    );
    const candidate = await fixture.t.run((ctx) =>
      ctx.db.get(first.revisionId),
    );
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(first.operationId),
    );
    if (!candidate || !operation) {
      throw new Error("The restore candidate is missing");
    }

    const newerCommand = await fixture.t.run(async (ctx) => {
      await ctx.db.patch(operation._id, {
        status: "failed",
        stage: "publishing",
        error: {
          code: "COOLIFY_DEPLOYMENT_FAILED",
          message: "Coolify could not deploy the Evidence Library",
          stage: "publishing",
        },
        receipt: {
          revisionKey: candidate.revisionKey,
          targetConfigSha256: "1".repeat(64),
          runtimeReceiptId: "deployment-restore",
          runtimeCommit: RUNTIME_COMMIT,
          runtimeImage: TEST_RUNTIME_IMAGE,
          coolifyConfigHash: "2".repeat(32),
        },
        configurationDeploymentTarget: {
          applicationId: "restore-application",
          aiProviderKey: { present: false },
          openAlexApiKey: { present: false },
          runtimeBindingId: fixture.created.runtimeBindingId,
          targetBaseUrl: fixture.created.publicAddress,
          customDomains: [],
          revisionKey: candidate.revisionKey,
          defaultLocale: "en-GB",
          runtimeCommit: RUNTIME_COMMIT,
          runtimeImage: TEST_RUNTIME_IMAGE,
          encryptedRuntimeConfig: "encrypted-runtime-config",
          runtimeConfigSha256: "1".repeat(64),
          savedAt: Date.now(),
        },
        completedAt: Date.now(),
        configurationAttemptToken: undefined,
        configurationLeaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
      const domainId = await ctx.db.insert("evidenceLibraryDomains", {
        libraryId: fixture.created.libraryId,
        host: "newer-restore-command.example.org",
        verificationToken: "domain-token",
        verificationHost: "example.org",
        role: "redirect",
        state: "added",
        generation: 0,
        createdByClerkUserId: fixture.clerkUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("evidenceLibraryConfigOperations", {
        libraryId: fixture.created.libraryId,
        kind: "publish",
        idempotencyKey: "newer-restore-domain-command",
        domainChange: {
          domainId,
          host: "newer-restore-command.example.org",
          reason: "attach",
          token: "domain-token",
        },
        revisionId: sourceRevisionId,
        status: "succeeded",
        stage: "completed",
        attemptCount: 1,
        requestedByClerkUserId: fixture.clerkUserId,
        createdAt: operation.createdAt + 1,
        updatedAt: operation.updatedAt + 1,
      });
    });
    vi.setSystemTime(Date.now() + 1_000);

    const repeated = await fixture.admin.mutation(
      api.evidenceLibraries.versions.restoreRevision,
      {
        libraryId: fixture.created.libraryId,
        revisionId: sourceRevisionId,
      },
    );
    expect(repeated).toMatchObject({
      operationId: first.operationId,
      revisionId: first.revisionId,
      status: "running",
    });
    const reissued = await fixture.t.run((ctx) =>
      ctx.db.get(first.operationId),
    );
    expect(reissued).toMatchObject({
      status: "running",
      attemptCount: 2,
    });
    expect(reissued!.createdAt).toBeGreaterThan(
      (await fixture.t.run((ctx) => ctx.db.get(newerCommand)))!.createdAt,
    );
    expect(reissued).not.toHaveProperty("configurationDeploymentTarget");
    expect(reissued).not.toHaveProperty("receipt");
    expect(reissued?.revisionId).toBe(candidate._id);
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.libraryId)),
    ).resolves.toMatchObject({ activeRevisionId: sourceRevisionId });
  });

  it("migrates an old active source before creating a domain candidate", async () => {
    const fixture = await createReadySetupFixture("domain-v2-candidate");
    const activeRevisionId = fixture.activated.revisionId;
    const domainId = await fixture.t.run(async (ctx) => {
      await ctx.db.patch(activeRevisionId, {
        ownerConfigurationVersion: 1,
      });
      return await ctx.db.insert("evidenceLibraryDomains", {
        libraryId: fixture.created.libraryId,
        host: "climate.example.org",
        verificationToken: "domain-token",
        verificationHost: "example.org",
        generation: 0,
        role: "redirect",
        state: "active",
        attachedAt: Date.now(),
        createdByClerkUserId: fixture.clerkUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const started = await fixture.admin.mutation(
      api.evidenceLibraries.versions.setDomainPrimary,
      {
        libraryId: fixture.created.libraryId,
        domainId,
        primary: true,
      },
    );
    const state = await fixture.t.run(async (ctx) => {
      const active = await ctx.db.get(activeRevisionId);
      const candidate = await ctx.db.get(started.revisionId);
      const candidateIdentity = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query
            .eq("revisionId", started.revisionId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      const library = await ctx.db.get(fixture.created.libraryId);
      const operation = await ctx.db.get(started.operationId);
      return { active, candidate, candidateIdentity, library, operation };
    });

    expect(state.active?.ownerConfigurationVersion).toBe(1);
    expect(state.candidate).toMatchObject({
      basedOnRevisionId: activeRevisionId,
      ownerConfigurationVersion: 6,
    });
    expect(state.candidateIdentity?.payload).toMatchObject({
      baseUrl: "https://climate.example.org",
    });
    expect(state.library?.activeRevisionId).toBe(activeRevisionId);
    expect(state.library?.latestRevisionId).toBe(started.revisionId);
    expect(state.operation?.domainChange).toMatchObject({
      reason: "canonical",
      host: "climate.example.org",
      address: "https://climate.example.org",
    });
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
      await ctx.db.patch("users", await seedFeatureUser(ctx, fixture.clerkUserId), {
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
        runtimeUpdate: {
          from: RUNTIME_COMMIT,
          to: NEWER_COMMIT,
          fromImage: TEST_RUNTIME_IMAGE,
          toImage: NEWER_RUNTIME_IMAGE,
        },
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
          return new Response(JSON.stringify([{ fqdn: currentAddress }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
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
    expect(movedOperation?.revisionId).toBeDefined();

    const state = await fixture.t.run(async (ctx) => {
      const binding = await ctx.db.get(fixture.created.runtimeBindingId);
      const candidate = movedOperation?.revisionId
        ? await ctx.db.get(movedOperation.revisionId)
        : null;
      const operation = movedOperation;
      const candidateIdentity = movedOperation?.revisionId
        ? await ctx.db
            .query("evidenceLibraryConfigSections")
            .withIndex("by_revisionId_and_sectionKey", (query) =>
              query
                .eq("revisionId", movedOperation.revisionId!)
                .eq("sectionKey", "identity"),
            )
            .unique()
        : null;
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
      const library = await ctx.db.get(fixture.created.libraryId);
      return {
        binding,
        candidate,
        candidateIdentity,
        draftIdentity,
        identity,
        library,
        operation,
      };
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
    expect(state.candidate).toMatchObject({
      basedOnRevisionId: fixture.activated.revisionId,
      ownerConfigurationVersion: 6,
    });
    expect(state.candidateIdentity?.payload).toMatchObject({
      baseUrl: movedTo,
    });
    expect(state.library?.activeRevisionId).toBe(fixture.activated.revisionId);
    expect(state.library?.latestRevisionId).toBe(state.candidate?._id);
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

  it("keeps a primary custom domain in the candidate while moving the platform address", async () => {
    const fixture = await createReadySetupFixture("address-live-primary");
    const canonicalBaseUrl = "https://library.example.org";
    const movedTo = "https://climate-evidence-2-lib.libraries.example.test";
    stubAddressChecks(fixture.created.publicAddress);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.runtimeBindingId, {
        canonicalBaseUrl,
      });
      for (const [kind, id] of [
        ["draft", fixture.created.draftId],
        ["revision", fixture.activated.revisionId],
      ] as const) {
        const identity = await ctx.db
          .query("evidenceLibraryConfigSections")
          .withIndex(
            kind === "draft"
              ? "by_draftId_and_sectionKey"
              : "by_revisionId_and_sectionKey",
            (query) =>
              kind === "draft"
                ? query.eq("draftId", id).eq("sectionKey", "identity")
                : query.eq("revisionId", id).eq("sectionKey", "identity"),
          )
          .unique();
        if (!identity || typeof identity.payload !== "object") {
          throw new Error("Identity fixture is missing");
        }
        const payload = { ...identity.payload, baseUrl: canonicalBaseUrl };
        await ctx.db.patch(identity._id, {
          payload,
          payloadByteLength: new TextEncoder().encode(JSON.stringify(payload))
            .byteLength,
        });
      }
    });

    const moved = await fixture.admin.action(
      api.evidenceLibraries.addressActions.moveLibraryAddress,
      { libraryId: fixture.created.libraryId },
    );
    if (moved.status !== "moving") throw new Error("Address move was refused");
    const operation = await readMoveOperation(fixture);
    if (!operation?.revisionId || !operation.configurationAttemptToken) {
      throw new Error("Address move did not start");
    }
    const prepared = await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .prepareConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId: operation._id,
        attemptToken: operation.configurationAttemptToken,
        attemptCount: operation.attemptCount,
      },
    );
    if (prepared.state !== "new") throw new Error("Target was already saved");
    const identity = prepared.sections.find(
      (row) => row.sectionKey === "identity",
    );

    expect(moved.movedTo).toBe(movedTo);
    expect(prepared.targetBaseUrl).toBe(movedTo);
    expect(identity?.payload).toMatchObject({ baseUrl: canonicalBaseUrl });
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
