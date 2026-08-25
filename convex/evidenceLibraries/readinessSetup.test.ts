/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { createDeployedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

describe("Evidence Library readiness completion", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_URL", "http://coolify:8080");
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
    vi.stubEnv("EL_RUNTIME_VERIFIER_URL", "https://verifier.example.test");
    vi.stubEnv("EL_RUNTIME_VERIFIER_TOKEN", "verifier-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
      coolifyConfigHash: "d".repeat(64),
      revisionKey: fixture.activated.revisionKey,
      targetBaseUrl: fixture.created.publicAddress,
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

  it("waits for services that become ready after Coolify finishes", async () => {
    const fixture = await createDeployedSetupFixture("readiness-delay");
    const applicationId = "app000000000000000000001";
    let verifierReady = false;
    await fixture.t.run(async (ctx) => {
      const operation = await ctx.db.get(fixture.created.setupOperationId);
      const binding = await ctx.db.get(fixture.created.runtimeBindingId);
      if (
        !operation?.setupReceipts?.application ||
        !operation.setupReceipts.deployment
      ) {
        throw new Error("Deployment receipts are missing");
      }
      if (!binding) throw new Error("Runtime binding is missing");
      await ctx.db.patch(operation._id, {
        setupReceipts: {
          ...operation.setupReceipts,
          application: {
            ...operation.setupReceipts.application,
            applicationId,
          },
          deployment: {
            ...operation.setupReceipts.deployment,
            applicationId,
          },
        },
      });
      await ctx.db.patch(binding._id, { targetRuntimeId: applicationId });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (request) => {
        const url = new URL(String(request));
        if (url.origin === "http://coolify:8080") {
          return new Response(
            JSON.stringify({
              deployment_uuid: fixture.deploymentId,
              commit: "a".repeat(40),
              configuration_hash: "d".repeat(64),
              status: "finished",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.origin === "https://verifier.example.test") {
          return new Response(
            verifierReady
              ? JSON.stringify({
                  applicationUuid: applicationId,
                  commit: "a".repeat(40),
                  ready: true,
                  services: [
                    "web",
                    "search-indexer",
                    "source-sync",
                    "source-writeback",
                    "publication-worker",
                    "meilisearch",
                  ],
                })
              : JSON.stringify({ ready: false }),
            {
              status: verifierReady ? 200 : 503,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.pathname === "/api/library-config/health") {
          return new Response(
            JSON.stringify({
              state: "active",
              active: { revision: fixture.activated.revisionKey },
              rejected: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("ready", { status: 200 });
      }),
    );
    const args = {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
    };

    await expect(
      fixture.t.action(
        internal.evidenceLibraries.readinessSetupActions.runReadinessSetup,
        args,
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });
    const waiting = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );
    expect(waiting).toMatchObject({
      status: "running",
      stage: "health_check",
      setupReadinessPollCount: 1,
    });

    verifierReady = true;
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.readinessSetupActions.runReadinessSetup,
        args,
      ),
    ).resolves.toEqual({ status: "succeeded" });
  });
});
