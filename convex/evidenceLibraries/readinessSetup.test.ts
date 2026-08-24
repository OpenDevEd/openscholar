/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { createDeployedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

describe("Evidence Library readiness completion", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  it("activates the frozen revision only after deployment readiness passes", async () => {
    const fixture = await createDeployedSetupFixture("readiness");
    expect(
      await fixture.t.mutation(
        internal.evidenceLibraries.readinessSetup.prepareReadinessSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).toEqual({
      applicationId: fixture.applicationId,
      deploymentId: fixture.deploymentId,
      runtimeCommit: "a".repeat(40),
      runtimeConfigSha256: "b".repeat(64),
      coolifyConfigHash: "c".repeat(64),
      revisionKey: fixture.activated.revisionKey,
      targetBaseUrl: fixture.created.publicAddress,
      defaultLocale: "en-GB",
    });

    expect(
      await fixture.t.mutation(
        internal.evidenceLibraries.readinessSetup.completeReadinessSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).toEqual({ status: "succeeded" });
    const saved = await fixture.t.run(async (ctx) => ({
      library: await ctx.db.get(fixture.created.libraryId),
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      operation: await ctx.db.get(fixture.created.setupOperationId),
    }));
    expect(saved.library).toMatchObject({
      state: "active",
      activeRevisionId: fixture.activated.revisionId,
    });
    expect(saved.binding).toMatchObject({
      state: "ready",
      targetRuntimeId: fixture.applicationId,
    });
    expect(saved.operation).toMatchObject({
      status: "succeeded",
      stage: "completed",
      receipt: {
        revisionKey: fixture.activated.revisionKey,
        runtimeReceiptId: fixture.deploymentId,
      },
    });
    expect(saved.operation).not.toHaveProperty("setupRuntimeCommit");
    expect(saved.operation).not.toHaveProperty("setupDeploymentId");
    expect(saved.operation).not.toHaveProperty(
      "setupEncryptedDatabasePassword",
    );
  });
});
