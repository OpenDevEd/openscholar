/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  createDeployedSetupFixture,
  essentialSetupSections,
} from "../../tests/helpers/evidence-library-setup-fixture";

async function createReadyLibrary(suffix: string) {
  const fixture = await createDeployedSetupFixture(suffix);
  await fixture.t.mutation(
    internal.evidenceLibraries.readinessSetup.completeReadinessSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
    },
  );
  return fixture;
}

async function activateChangedConfiguration(suffix: string) {
  const fixture = await createReadyLibrary(suffix);
  const sections = {
    ...essentialSetupSections,
    identity: {
      ...essentialSetupSections.identity,
      name: `Changed ${suffix}`,
    },
  };
  const saved = await fixture.admin.mutation(
    api.evidenceLibraries.mutations.saveEssentialConfiguration,
    {
      libraryId: fixture.created.libraryId,
      sections,
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
  return { activated, fixture, sections };
}

describe("Evidence Library configuration deployment", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  it("starts from the requested revision and existing ready runtime", async () => {
    const { activated, fixture, sections } =
      await activateChangedConfiguration("immutable-revision");
    await fixture.t.run(async (ctx) => {
      const draftIdentity = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query
            .eq("draftId", fixture.created.draftId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      if (!draftIdentity) throw new Error("Draft identity is missing");
      await ctx.db.patch(draftIdentity._id, {
        payload: { ...sections.identity, name: "Later draft change" },
      });
    });

    const prepared = await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .prepareConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 1,
      },
    );
    const state = await fixture.t.run(async (ctx) => ({
      library: await ctx.db.get(fixture.created.libraryId),
      operation: await ctx.db.get(activated.operationId),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));

    expect(activated).toMatchObject({ kind: "publish", status: "running" });
    expect(prepared).toMatchObject({
      applicationId: fixture.applicationId,
      revisionKey: activated.revisionKey,
      sections,
      targetBaseUrl: fixture.created.publicAddress,
    });
    expect(state.library?.activeRevisionId).toBe(fixture.activated.revisionId);
    expect(state.operation).toMatchObject({
      attemptCount: 1,
      revisionId: activated.revisionId,
      stage: "assembling",
      status: "running",
    });
    expect(
      state.scheduled.filter((scheduled) =>
        scheduled.name.includes("runConfigurationDeployment"),
      ),
    ).toHaveLength(1);
  });

  it("activates only after the saved deployment and readiness check", async () => {
    const { activated, fixture } =
      await activateChangedConfiguration("ready-success");
    const checkedAt = 42_000;
    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .saveConfigurationDeploymentReceipt,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 1,
        deploymentId: "deployment-config-success",
        runtimeCommit: "a".repeat(40),
        runtimeConfigSha256: "b".repeat(64),
        coolifyConfigHash: "c".repeat(64),
      },
    );
    expect(
      await fixture.t.run((ctx) => ctx.db.get(fixture.created.libraryId)),
    ).toMatchObject({ activeRevisionId: fixture.activated.revisionId });
    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .prepareConfigurationActivation,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 1,
      },
    );
    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .completeConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 1,
        checkedAt,
      },
    );

    const state = await fixture.t.run(async (ctx) => ({
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      library: await ctx.db.get(fixture.created.libraryId),
      operation: await ctx.db.get(activated.operationId),
    }));
    expect(state.operation).toMatchObject({
      status: "succeeded",
      stage: "completed",
      receipt: {
        revisionKey: activated.revisionKey,
        targetConfigSha256: "b".repeat(64),
        runtimeReceiptId: "deployment-config-success",
        runtimeCommit: "a".repeat(40),
        coolifyConfigHash: "c".repeat(64),
        activatedAt: checkedAt,
      },
    });
    expect(state.library?.activeRevisionId).toBe(activated.revisionId);
    expect(state.binding).toMatchObject({
      state: "ready",
      lastVerifiedAt: checkedAt,
    });
  });

  it("records a failed deployment, keeps the active revision, and retries the same operation", async () => {
    const { activated, fixture } =
      await activateChangedConfiguration("failed-retry");
    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .saveConfigurationDeploymentReceipt,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 1,
        deploymentId: "deployment-config-failed",
        runtimeCommit: "a".repeat(40),
        runtimeConfigSha256: "b".repeat(64),
        coolifyConfigHash: "c".repeat(64),
      },
    );
    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .failConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 1,
        error: {
          code: "COOLIFY_DEPLOYMENT_FAILED",
          message: "Coolify could not deploy the Evidence Library",
        },
      },
    );
    const failed = await fixture.t.run(async (ctx) => ({
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      library: await ctx.db.get(fixture.created.libraryId),
      operation: await ctx.db.get(activated.operationId),
    }));

    expect(failed.operation).toMatchObject({
      status: "failed",
      receipt: { runtimeReceiptId: "deployment-config-failed" },
    });
    expect(failed.library?.activeRevisionId).toBe(fixture.activated.revisionId);
    expect(failed.binding).toMatchObject({ state: "ready" });
    expect(failed.binding).not.toHaveProperty("error");

    const retried = await fixture.admin.mutation(
      api.evidenceLibraries.configurationDeployment
        .retryConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
      },
    );
    const afterRetry = await fixture.t.run(async (ctx) => ({
      library: await ctx.db.get(fixture.created.libraryId),
      operation: await ctx.db.get(activated.operationId),
    }));
    expect(retried).toEqual({
      operationId: activated.operationId,
      revisionId: activated.revisionId,
      status: "running",
    });
    expect(afterRetry.operation).toMatchObject({
      attemptCount: 2,
      revisionId: activated.revisionId,
      status: "running",
    });
    expect(afterRetry.library?.activeRevisionId).toBe(
      fixture.activated.revisionId,
    );

    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .saveConfigurationDeploymentReceipt,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 2,
        deploymentId: "deployment-config-retry",
        runtimeCommit: "a".repeat(40),
        runtimeConfigSha256: "b".repeat(64),
        coolifyConfigHash: "c".repeat(64),
        replacesDeploymentId: "deployment-config-failed",
      },
    );
    expect(
      await fixture.t.run((ctx) => ctx.db.get(activated.operationId)),
    ).toMatchObject({
      revisionId: activated.revisionId,
      receipt: { runtimeReceiptId: "deployment-config-retry" },
    });
  });

  it("does not retry an old failed operation after a newer revision starts", async () => {
    const { activated, fixture, sections } =
      await activateChangedConfiguration("stale-retry");
    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .failConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId: activated.operationId,
        attemptCount: 1,
        error: {
          code: "READINESS_UNAVAILABLE",
          message: "Evidence Library readiness could not be checked",
        },
      },
    );
    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveEssentialConfiguration,
      {
        libraryId: fixture.created.libraryId,
        sections: {
          ...sections,
          identity: { ...sections.identity, name: "Newer revision" },
        },
        expectedEditVersion: activated.editVersion,
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
      fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: activated.operationId,
        },
      ),
    ).rejects.toThrow(/newer.*revision/i);
  });
});
