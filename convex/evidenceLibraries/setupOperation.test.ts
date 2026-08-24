/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");

const essentialSections = {
  identity: {
    name: "Climate Evidence",
    shortName: "Climate",
    baseUrl: "https://climate-evidence-lib.libraries.example.test",
    assets: {
      logoDark: "https://assets.example.test/logo.svg",
      favicon: "https://assets.example.test/favicon.ico",
    },
  },
  theme: { colors: { accent: "#005A9C", tertiary: "#F2A900" } },
  localization: { locales: ["en-GB"], defaultLocale: "en-GB" },
};

async function createActivatedSetup(suffix: string) {
  const t = convexTest(schema, modules);
  const clerkOrganizationId = `org_${suffix}`;
  const clerkUserId = `user_${suffix}`;
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId,
      name: `Team ${suffix}`,
      slug: `team-${suffix}`,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: `orgmem_${suffix}`,
      clerkUserId,
      role: "org:admin",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const admin = t.withIdentity({
    subject: clerkUserId,
    o: { id: clerkOrganizationId, rol: "org:admin" },
  });
  const created = await admin.mutation(
    api.evidenceLibraries.mutations.createSetupDraft,
    { name: essentialSections.identity.name },
  );
  const saved = await admin.mutation(
    api.evidenceLibraries.mutations.saveEssentialConfiguration,
    {
      libraryId: created.libraryId,
      sections: essentialSections,
      expectedEditVersion: 0,
    },
  );
  const activated = await admin.mutation(
    api.evidenceLibraries.mutations.activateConfiguration,
    {
      libraryId: created.libraryId,
      expectedEditVersion: saved.editVersion,
    },
  );
  return { activated, admin, created, t };
}

async function claim(
  fixture: Awaited<ReturnType<typeof createActivatedSetup>>,
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
  fixture: Awaited<ReturnType<typeof createActivatedSetup>>,
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
      }
    | {
        step: "deployment";
        outcome: "created" | "matched";
        applicationId: string;
        deploymentId: string;
      }
    | {
        step: "health_check";
        outcome: "matched";
        applicationId: string;
        deploymentId: string;
        revisionKey: string;
      },
  attemptToken = "attempt-1",
  attemptCount = 1,
) {
  return await fixture.t.mutation(
    internal.evidenceLibraries.setupOperation.recordSetupStep,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken,
      attemptCount,
      result: receipt,
    },
  );
}

describe("fixed Evidence Library setup operation", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("claims the activated revision once and rejects generic setup transitions", async () => {
    const fixture = await createActivatedSetup("claim");
    const claimed = await claim(fixture);

    expect(claimed).toMatchObject({
      attemptCount: 1,
      attemptToken: "attempt-1",
      revisionId: fixture.activated.revisionId,
      revisionKey: fixture.activated.revisionKey,
      step: "database",
    });
    await expect(claim(fixture, "attempt-2")).rejects.toThrow(
      /already running/,
    );
    const renewed = await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.renewSetupLease,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "attempt-1",
        attemptCount: 1,
      },
    );
    expect(renewed.setupLeaseExpiresAt).toBeGreaterThan(Date.now());
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.created.setupOperationId, {
        setupLeaseExpiresAt: 0,
      }),
    );
    expect(await claim(fixture, "attempt-1")).toMatchObject({
      attemptCount: 2,
      attemptToken: "attempt-1",
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
        "attempt-1",
      ),
    ).rejects.toThrow(/no longer active/);
    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.startOperation,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          stage: "validating",
        },
      ),
    ).rejects.toThrow(/fixed setup/);
  });

  it("records checked resources in the fixed order", async () => {
    const fixture = await createActivatedSetup("order");
    await claim(fixture);

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
          attemptToken: "attempt-1",
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
    const fixture = await createActivatedSetup("retry");
    await claim(fixture);
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
        attemptToken: "attempt-1",
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

  it("activates only after readiness proves the requested revision", async () => {
    const fixture = await createActivatedSetup("complete");
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
        searchHost: "http://meilisearch:7700",
        searchIndex: "evidence",
        storageUrl: "https://storage.example.test",
        storageDocumentsBucket: "climate-private",
        storageImagesBucket: "climate-public",
        storageMaxPdfBytes: 20_000_000,
        databaseCredentialId,
        searchCredentialId,
        storageCredentialId,
      });
      return { databaseCredentialId, searchCredentialId, storageCredentialId };
    });
    expect(Object.values(credentialIds)).toHaveLength(3);

    await claim(fixture);
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
    });
    await record(fixture, {
      step: "deployment",
      outcome: "created",
      applicationId: "coolify-app-1",
      deploymentId: "coolify-deploy-1",
    });
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.setupOperation.recordSetupStep,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: "attempt-1",
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
        storageDocumentsBucket: "another-private-bucket",
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
        storageDocumentsBucket: "climate-private",
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
  });
});
