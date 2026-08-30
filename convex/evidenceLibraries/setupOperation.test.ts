/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import {
  createActivatedSetupFixture,
  TEST_RUNTIME_IMAGE,
} from "../../tests/helpers/evidence-library-setup-fixture";

const runtimeCommit = "a".repeat(40);
const runtimeConfigSha256 = "b".repeat(64);
const coolifyConfigHash = "c".repeat(64);

async function claim(
  fixture: Awaited<ReturnType<typeof createActivatedSetupFixture>>,
  attemptToken = "attempt-1",
) {
  return await fixture.t.mutation(
    internal.evidenceLibraries.setupOperation.claimSetupOperation,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken,
    },
  );
}

async function record(
  fixture: Awaited<ReturnType<typeof createActivatedSetupFixture>>,
  receipt:
    | {
        step: "database";
        outcome: "created" | "matched" | "updated";
        databaseName: string;
        loginName: string;
      }
    | {
        step: "storage";
        outcome: "created" | "matched" | "updated";
        privateBucket: string;
        publicBucket: string;
      }
    | {
        step: "application";
        outcome: "created" | "matched" | "updated";
        applicationId: string;
        runtimeCommit: string;
        runtimeImage: string;
        runtimeConfigSha256: string;
        coolifyConfigHash: string;
      }
    | {
        step: "deployment";
        outcome: "created" | "matched";
        applicationId: string;
        deploymentId: string;
        runtimeCommit: string;
        runtimeImage: string;
        runtimeConfigSha256: string;
        coolifyConfigHash: string;
      }
    | {
        step: "health_check";
        outcome: "matched";
        applicationId: string;
        deploymentId: string;
        revisionKey: string;
      },
  attemptToken?: string,
  attemptCount?: number,
) {
  const operation = await fixture.t.run((ctx) =>
    ctx.db.get(fixture.created.setupOperationId),
  );
  const currentAttemptToken = attemptToken ?? operation?.setupAttemptToken;
  const currentAttemptCount = attemptCount ?? operation?.attemptCount;
  if (!currentAttemptToken || !currentAttemptCount) {
    throw new Error("Setup attempt is not active");
  }
  return await fixture.t.mutation(
    internal.evidenceLibraries.setupOperation.recordSetupStep,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: currentAttemptToken,
      attemptCount: currentAttemptCount,
      result: receipt,
    },
  );
}

describe("fixed Evidence Library setup operation", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("claims the activated revision once", async () => {
    const fixture = await createActivatedSetupFixture("claim");
    const claimed = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );

    expect(claimed).toMatchObject({
      attemptCount: 1,
      setupAttemptToken: fixture.attemptToken,
      revisionId: fixture.activated.revisionId,
      stage: "database",
    });
    const scheduledAfterClaim = await fixture.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduledAfterClaim.filter((scheduled) =>
        scheduled.name.includes("runDatabaseSetup"),
      ),
    ).toHaveLength(1);
    await expect(claim(fixture, "attempt-2")).rejects.toThrow(
      /already running/,
    );
    const renewed = await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.renewSetupLease,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: 1,
      },
    );
    expect(renewed.setupLeaseExpiresAt).toBeGreaterThan(Date.now());
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.created.setupOperationId, {
        setupLeaseExpiresAt: 0,
      }),
    );
    expect(await claim(fixture, "attempt-2")).toMatchObject({
      attemptCount: 2,
      attemptToken: "attempt-2",
    });
    await expect(
      record(
        fixture,
        {
          step: "database",
          outcome: "created",
          databaseName: "climate_library",
          loginName: "climate_library",
        },
        fixture.attemptToken,
        1,
      ),
    ).rejects.toThrow(/no longer active/);
  });

  it("records checked resources in the fixed order", async () => {
    const fixture = await createActivatedSetupFixture("order");

    await expect(
      record(fixture, {
        step: "storage",
        outcome: "created",
        privateBucket: "climate-private",
        publicBucket: "climate-public",
      }),
    ).rejects.toThrow(/database/);
    await expect(
      record(fixture, {
        step: "database",
        outcome: "created",
        databaseName: "   ",
        loginName: "climate_library",
      }),
    ).rejects.toThrow(/databaseName/);

    expect(
      await record(fixture, {
        step: "database",
        outcome: "created",
        databaseName: "climate_library",
        loginName: "climate_library",
      }),
    ).toEqual({ nextStep: "storage", status: "running" });
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.setupOperation.failSetupOperation,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: 1,
          expectedStage: "database",
          error: { code: "DATABASE_FAILED", message: "Late database error" },
        },
      ),
    ).rejects.toThrow(/running storage, not database/);
    expect(
      await fixture.t.run((ctx) =>
        ctx.db.get(
          "evidenceLibraryConfigOperations",
          fixture.created.setupOperationId,
        ),
      ),
    ).toMatchObject({
      setupReceipts: {
        database: {
          databaseName: "climate_library",
          loginName: "climate_library",
          outcome: "created",
          checkedAt: expect.any(Number),
        },
      },
      stage: "storage",
      status: "running",
    });
  });

  it("keeps receipts after failure and rechecks from the first step", async () => {
    const fixture = await createActivatedSetupFixture("retry");
    await record(fixture, {
      step: "database",
      outcome: "created",
      databaseName: "climate_library",
      loginName: "climate_library",
    });
    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.failSetupOperation,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: 1,
        expectedStage: "storage",
        error: { code: "BUCKET_FAILED", message: "Storage refused the bucket" },
      },
    );

    const failed = await fixture.t.run(async (ctx) => ({
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      operation: await ctx.db.get(
        "evidenceLibraryConfigOperations",
        fixture.created.setupOperationId,
      ),
    }));
    expect(failed).toMatchObject({
      binding: {
        error: {
          code: "BUCKET_FAILED",
          message: "Storage refused the bucket",
        },
        state: "failed",
      },
      operation: {
        error: {
          code: "BUCKET_FAILED",
          message: "Storage refused the bucket",
          stage: "storage",
        },
        stage: "storage",
        status: "failed",
      },
    });

    const retried = await claim(fixture, "attempt-2");
    expect(retried).toMatchObject({
      attemptCount: 2,
      step: "database",
      setupReceipts: {
        database: {
          databaseName: "climate_library",
          loginName: "climate_library",
          outcome: "created",
        },
      },
    });
    expect(
      await fixture.t.run((ctx) =>
        ctx.db.get(
          "evidenceLibraryConfigOperations",
          fixture.created.setupOperationId,
        ),
      ),
    ).toMatchObject({ stage: "database", status: "running" });
    expect(
      await record(
        fixture,
        {
          step: "database",
          outcome: "matched",
          databaseName: "climate_library",
          loginName: "climate_library",
        },
        "attempt-2",
        2,
      ),
    ).toEqual({ nextStep: "storage", status: "running" });
  });

  it("keeps the deployment cutoff when a retry finds the same application", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T10:00:00.000Z"));
    const fixture = await createActivatedSetupFixture("deployment-cutoff");
    const database = {
      step: "database" as const,
      outcome: "created" as const,
      databaseName: "climate_library",
      loginName: "climate_library",
    };
    const storage = {
      step: "storage" as const,
      outcome: "created" as const,
      privateBucket: "climate-private",
      publicBucket: "climate-public",
    };
    const application = {
      step: "application" as const,
      outcome: "created" as const,
      applicationId: "coolify-app-cutoff",
      runtimeCommit,
      runtimeImage: TEST_RUNTIME_IMAGE,
      runtimeConfigSha256,
      coolifyConfigHash,
    };
    await record(fixture, database);
    await record(fixture, storage);
    await record(fixture, application);
    const firstCutoff = await fixture.t.run(
      async (ctx) =>
        (await ctx.db.get(fixture.created.setupOperationId))
          ?.setupDeploymentNotBefore,
    );
    expect(firstCutoff).toBe(Date.now());

    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.failSetupOperation,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        expectedStage: "deployment",
        error: {
          code: "READINESS_FAILED",
          message: "The first deployment was not ready",
        },
      },
    );
    vi.advanceTimersByTime(60_000);
    await claim(fixture, "attempt-2");
    await record(fixture, { ...database, outcome: "matched" }, "attempt-2", 2);
    await record(fixture, { ...storage, outcome: "matched" }, "attempt-2", 2);
    await record(
      fixture,
      { ...application, outcome: "matched" },
      "attempt-2",
      2,
    );
    const retried = await fixture.t.run(async (ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );
    expect(retried?.setupDeploymentNotBefore).toBe(firstCutoff);
    expect(retried?.setupReceipts?.application?.checkedAt).toBe(Date.now());
  });

  it("activates only after readiness proves the requested revision", async () => {
    const fixture = await createActivatedSetupFixture("complete");
    const credentialIds = await fixture.t.run(async (ctx) => {
      const makeCredential = async (key: string) =>
        await ctx.db.insert("evidenceLibraryCredentials", {
          libraryId: fixture.created.libraryId,
          credentialKey: key,
          encryptedValue: `encrypted-${key}`,
          validationState: "valid",
          createdByClerkUserId: "user_complete",
          updatedByClerkUserId: "user_complete",
          createdAt: 1,
          updatedAt: 1,
        });
      const databaseCredentialId = await makeCredential("database");
      const searchCredentialId = await makeCredential("search");
      const storageCredentialId = await makeCredential("storage");
      await ctx.db.patch(fixture.created.runtimeBindingId, {
        targetRuntimeId: "coolify-app-1",
        runtimeCommit: "a".repeat(40),
        runtimeImage: TEST_RUNTIME_IMAGE,
        searchHost: "http://meilisearch:7700",
        searchIndex: "evidence",
        storageUrl: "https://storage.example.test",
        storagePrivateBucket: "climate-private",
        storagePublicBucket: "climate-public",
        storageMaxPdfBytes: 20_000_000,
        databaseCredentialId,
        searchCredentialId,
        storageCredentialId,
      });
      await ctx.db.patch(fixture.created.setupOperationId, {
        setupEncryptedDatabasePassword: "encrypted-database-password",
      });
      return { databaseCredentialId, searchCredentialId, storageCredentialId };
    });
    expect(Object.values(credentialIds)).toHaveLength(3);

    await record(fixture, {
      step: "database",
      outcome: "created",
      databaseName: "climate_library",
      loginName: "climate_library",
    });
    await record(fixture, {
      step: "storage",
      outcome: "created",
      privateBucket: "climate-private",
      publicBucket: "climate-public",
    });
    await record(fixture, {
      step: "application",
      outcome: "created",
      applicationId: "coolify-app-1",
      runtimeCommit,
      runtimeImage: TEST_RUNTIME_IMAGE,
      runtimeConfigSha256,
      coolifyConfigHash,
    });
    await record(fixture, {
      step: "deployment",
      outcome: "created",
      applicationId: "coolify-app-1",
      deploymentId: "coolify-deploy-1",
      runtimeCommit,
      runtimeImage: TEST_RUNTIME_IMAGE,
      runtimeConfigSha256,
      coolifyConfigHash,
    });
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.setupOperation.recordSetupStep,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: 1,
          result: {
            step: "health_check",
            outcome: "created",
            applicationId: "coolify-app-1",
            deploymentId: "coolify-deploy-1",
            revisionKey: fixture.activated.revisionKey,
          } as never,
        },
      ),
    ).rejects.toThrow();
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.created.runtimeBindingId, {
        storagePrivateBucket: "another-private-bucket",
      }),
    );
    await expect(
      record(fixture, {
        step: "health_check",
        outcome: "matched",
        applicationId: "coolify-app-1",
        deploymentId: "coolify-deploy-1",
        revisionKey: fixture.activated.revisionKey,
      }),
    ).rejects.toThrow(/storage buckets/);
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.created.runtimeBindingId, {
        storagePrivateBucket: "climate-private",
      }),
    );
    await expect(
      record(fixture, {
        step: "health_check",
        outcome: "matched",
        applicationId: "another-app",
        deploymentId: "coolify-deploy-1",
        revisionKey: fixture.activated.revisionKey,
      }),
    ).rejects.toThrow(/Coolify application/);
    await expect(
      record(fixture, {
        step: "health_check",
        outcome: "matched",
        applicationId: "coolify-app-1",
        deploymentId: "coolify-deploy-1",
        revisionKey: "wrong-revision",
      }),
    ).rejects.toThrow(/revision/);
    expect(
      await fixture.t.run((ctx) => ctx.db.get(fixture.created.libraryId)),
    ).toMatchObject({ state: "provisioning" });

    expect(
      await record(fixture, {
        step: "health_check",
        outcome: "matched",
        applicationId: "coolify-app-1",
        deploymentId: "coolify-deploy-1",
        revisionKey: fixture.activated.revisionKey,
      }),
    ).toEqual({ nextStep: null, status: "succeeded" });
    const completed = await fixture.t.run(async (ctx) => ({
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      library: await ctx.db.get(fixture.created.libraryId),
      operation: await ctx.db.get(
        "evidenceLibraryConfigOperations",
        fixture.created.setupOperationId,
      ),
    }));
    expect(completed.library).toMatchObject({
      activeRevisionId: fixture.activated.revisionId,
      state: "active",
    });
    expect(completed.binding).toMatchObject({
      state: "ready",
      lastVerifiedAt: expect.any(Number),
    });
    expect(completed.operation).toMatchObject({
      stage: "completed",
      status: "succeeded",
      receipt: {
        revisionKey: fixture.activated.revisionKey,
        runtimeReceiptId: "coolify-deploy-1",
      },
    });
    expect(completed.operation).not.toHaveProperty(
      "setupEncryptedDatabasePassword",
    );
  });
});
