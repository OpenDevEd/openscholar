/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import {
  createActivatedSetupFixture,
  TEST_RUNTIME_IMAGE,
} from "../../tests/helpers/evidence-library-setup-fixture";

const APPLICATION_UUID = "app000000000000000000003";

async function createApplicationSetupFixture() {
  const fixture = await createActivatedSetupFixture("deployment");
  await fixture.t.mutation(
    internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      encryptedDatabaseUrl: "encrypted-database-url",
      outcome: "created",
      databaseName: "el_deployment",
      loginName: "el_deployment_user",
    },
  );
  await fixture.t.mutation(
    internal.evidenceLibraries.storageSetup.completeStorageSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      encryptedServiceRoleKey: "encrypted-storage-key",
      outcome: "created",
      privateBucket: "el-private-deployment",
      publicBucket: "el-public-deployment",
    },
  );
  const prepared = await fixture.t.mutation(
    internal.evidenceLibraries.applicationSetup.prepareApplicationSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      candidateEncryptedSearchKey: "encrypted-search",
      candidateEncryptedAuthenticationSecret: "encrypted-auth",
      candidateEncryptedMachineCredential: "encrypted-machine",
      candidateMachineCredentialDigest: "machine-digest",
      candidateMachineCredentialHint: "els_key...",
      candidateRuntimeCommit: "a".repeat(40),
      candidateRuntimeImage: TEST_RUNTIME_IMAGE,
    },
  );
  await fixture.t.mutation(
    internal.evidenceLibraries.applicationSetup.completeApplicationSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      outcome: "created",
      applicationId: APPLICATION_UUID,
      runtimeCommit: prepared.runtimeCommit,
      runtimeImage: prepared.runtimeImage,
      runtimeConfigSha256: "b".repeat(64),
      coolifyConfigHash: "c".repeat(64),
      searchHost: "http://meilisearch:7700",
      searchIndex: "evidence_library",
      storageUrl: "https://storage.example.test",
      storagePrivateBucket: prepared.storagePrivateBucket,
      storagePublicBucket: prepared.storagePublicBucket,
      storageMaxPdfBytes: 52_428_800,
      databaseCredentialId: prepared.databaseCredentialId,
      searchCredentialId: prepared.searchCredentialId,
      storageCredentialId: prepared.storageCredentialId,
      aiProviderKey: { present: false } as const,
    },
  );
  return { ...fixture, prepared };
}

describe("Evidence Library deployment setup", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("publishes maintenance before asking for the first deployment", async () => {
    const fixture = await createApplicationSetupFixture();
    vi.stubEnv("EL_COOLIFY_URL", "https://coolify.example.test");
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
    vi.stubEnv("EL_RUNTIME_VERIFIER_URL", "https://verifier.example.test");
    vi.stubEnv("EL_RUNTIME_VERIFIER_TOKEN", "verifier-token");
    const requests: Array<{ body: unknown; url: URL }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (request, init) => {
        const url = new URL(String(request));
        requests.push({
          body: init?.body ? JSON.parse(String(init.body)) : null,
          url,
        });
        if (url.origin === "https://verifier.example.test") {
          return Response.json({ status: "maintenance" });
        }
        return Response.json({ message: "unavailable" }, { status: 503 });
      }),
    );

    await expect(
      fixture.t.action(
        internal.evidenceLibraries.deploymentSetupActions.runDeploymentSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "failed" });
    expect(requests[0]).toMatchObject({
      body: {
        applicationUuid: APPLICATION_UUID,
        commit: "a".repeat(40),
        customOrigins: [],
        platformOrigins: [fixture.created.publicAddress],
        revision: fixture.activated.revisionKey,
        runtimeImage: TEST_RUNTIME_IMAGE,
      },
    });
    expect(requests[0]!.url.pathname).toBe("/v1/library-runtime/maintenance");
  });

  it("saves one deployment, polls without sleeping, and queues readiness", async () => {
    const fixture = await createApplicationSetupFixture();
    expect(
      await fixture.t.mutation(
        internal.evidenceLibraries.deploymentSetup.prepareDeploymentSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).toMatchObject({
      applicationId: APPLICATION_UUID,
      deploymentNotBefore: expect.any(Number),
      runtimeCommit: "a".repeat(40),
      runtimeImage: TEST_RUNTIME_IMAGE,
      runtimeConfigSha256: "b".repeat(64),
      coolifyConfigHash: "c".repeat(64),
      pollCount: 0,
    });

    await fixture.t.mutation(
      internal.evidenceLibraries.deploymentSetup.saveDeploymentSetupId,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        deploymentId: "deployment-1",
        outcome: "created",
      },
    );
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.deploymentSetup.saveDeploymentSetupId,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
          deploymentId: "deployment-2",
          outcome: "matched",
        },
      ),
    ).rejects.toThrow(/another deployment/);

    expect(
      await fixture.t.mutation(
        internal.evidenceLibraries.deploymentSetup.scheduleDeploymentPoll,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
          deploymentId: "deployment-1",
        },
      ),
    ).toEqual({ pollCount: 1, status: "running" });
    const polling = await fixture.t.run(async (ctx) => ({
      operation: await ctx.db.get(fixture.created.setupOperationId),
      scheduledFunctions: await ctx.db.system
        .query("_scheduled_functions")
        .collect(),
    }));
    expect(polling.operation).toMatchObject({
      setupDeploymentId: "deployment-1",
      setupDeploymentOutcome: "created",
      setupDeploymentPollCount: 1,
    });
    expect(
      polling.scheduledFunctions.filter((scheduled) =>
        scheduled.name.includes("runDeploymentSetup"),
      ).length,
    ).toBeGreaterThanOrEqual(2);

    expect(
      await fixture.t.mutation(
        internal.evidenceLibraries.deploymentSetup.completeDeploymentSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
          deploymentId: "deployment-1",
          coolifyConfigHash: "d".repeat(64),
        },
      ),
    ).toEqual({ nextStep: "health_check", status: "running" });
    const completed = await fixture.t.run(async (ctx) => ({
      operation: await ctx.db.get(fixture.created.setupOperationId),
      scheduledFunctions: await ctx.db.system
        .query("_scheduled_functions")
        .collect(),
    }));
    expect(completed.operation).toMatchObject({
      stage: "health_check",
      setupReceipts: {
        deployment: {
          applicationId: APPLICATION_UUID,
          deploymentId: "deployment-1",
          runtimeCommit: "a".repeat(40),
          runtimeConfigSha256: "b".repeat(64),
          coolifyConfigHash: "d".repeat(64),
        },
      },
    });
    expect(
      completed.scheduledFunctions.filter((scheduled) =>
        scheduled.name.includes("runReadinessSetup"),
      ),
    ).toHaveLength(1);
  });
});
