/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import {
  createDeployedSetupFixture,
  TEST_RUNTIME_IMAGE,
} from "../../tests/helpers/evidence-library-setup-fixture";
import { AI_PROVIDER_CREDENTIAL_KEY } from "../../lib/evidence-libraries/configuration/ai";

describe("Evidence Library readiness completion", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_URL", "http://coolify:8080");
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
    vi.stubEnv("EL_RUNTIME_VERIFIER_URL", "https://verifier.example.test");
    vi.stubEnv("EL_RUNTIME_VERIFIER_TOKEN", "verifier-token");
    vi.stubEnv("EL_OPENSCHOLAR_URL", "https://openscholar.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses to finish a setup whose AI key was replaced along the way", async () => {
    const fixture = await createDeployedSetupFixture("readiness-ai-key");
    const libraryId = fixture.created.libraryId;
    const args = {
      libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
    };
    await fixture.t.mutation(
      internal.evidenceLibraries.readinessSetup.prepareReadinessSetup,
      args,
    );
    // The owner replaces the key while the new library is being made live.
    await fixture.t.run(async (ctx) => {
      const row = await ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", libraryId)
            .eq("credentialKey", AI_PROVIDER_CREDENTIAL_KEY),
        )
        .unique();
      if (row) {
        await ctx.db.patch(row._id, { encryptedValue: "replaced-ciphertext" });
        return;
      }
      await ctx.db.insert("evidenceLibraryCredentials", {
        libraryId,
        credentialKey: AI_PROVIDER_CREDENTIAL_KEY,
        pathPattern: "/ai/providers/*/apiKey",
        instanceKey: "openrouter",
        encryptedValue: "ciphertext",
        validationState: "untested",
        createdByClerkUserId: "user_readiness_ai_key",
        updatedByClerkUserId: "user_readiness_ai_key",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.readinessSetup.completeReadinessSetup,
        args,
      ),
    ).rejects.toThrow(/changed while the library was publishing/);
    expect(
      await fixture.t.run((ctx) => ctx.db.get(libraryId)),
    ).not.toMatchObject({ state: "active" });
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
      runtimeImage: TEST_RUNTIME_IMAGE,
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
      runtimeCommit: fixture.prepared.runtimeCommit,
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
                  runtimeImage: TEST_RUNTIME_IMAGE,
                  ready: true,
                  services: [
                    "web",
                    "search-indexer",
                    "source-sync",
                    "source-writeback",
                    "publication-worker",
                    "meilisearch",
                    "redis",
                  ].map((service) => ({ service })),
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
        if (url.pathname === "/admin") {
          // A live library sends a signed-out visitor of its admin area to
          // OpenScholar, and readiness checks exactly that.
          return new Response(null, {
            status: 307,
            headers: {
              location: `https://openscholar.example.test/evidence-libraries/${fixture.created.libraryId}/admin?return=%2Fadmin`,
            },
          });
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

describe("Evidence Library address recovery during setup", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_URL", "http://coolify:8080");
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
    vi.stubEnv("EL_RUNTIME_VERIFIER_URL", "https://verifier.example.test");
    vi.stubEnv("EL_RUNTIME_VERIFIER_TOKEN", "verifier-token");
    vi.stubEnv("EL_OPENSCHOLAR_URL", "https://openscholar.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** A deployed library whose public address answers as some other website. */
  async function createHijackedAddressFixture(suffix: string) {
    const fixture = await createDeployedSetupFixture(suffix);
    const applicationId = "app000000000000000000009";
    await fixture.t.run(async (ctx) => {
      const operation = await ctx.db.get(fixture.created.setupOperationId);
      const binding = await ctx.db.get(fixture.created.runtimeBindingId);
      if (
        !operation?.setupReceipts?.application ||
        !operation.setupReceipts.deployment ||
        !binding
      ) {
        throw new Error("Deployment receipts are missing");
      }
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
          // Coolify serves nothing else, so only the host answers decide.
          if (
            url.pathname === "/api/v1/applications" ||
            url.pathname === "/api/v1/services"
          ) {
            return new Response("[]", {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
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
        // Every numbered address is free: the proxy has no server there.
        if (
          url.origin !== "https://verifier.example.test" &&
          url.hostname !== new URL(fixture.created.publicAddress).hostname
        ) {
          return new Response("no available server", { status: 503 });
        }
        if (url.origin === "https://verifier.example.test") {
          return new Response(
            JSON.stringify({
              applicationUuid: applicationId,
              commit: "a".repeat(40),
              runtimeImage: TEST_RUNTIME_IMAGE,
              ready: true,
              services: [
                "web",
                "search-indexer",
                "source-sync",
                "source-writeback",
                "publication-worker",
                "meilisearch",
                "redis",
              ].map((service) => ({ service })),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        // The address is served by a different website.
        return new Response("<!doctype html><title>Other site</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }),
    );
    return {
      ...fixture,
      args: {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
      },
    };
  }

  it("moves the library to the next free address and starts Coolify again", async () => {
    const fixture = await createHijackedAddressFixture("address-move");
    const movedTo = "https://climate-evidence-2-lib.libraries.example.test";

    await expect(
      fixture.t.action(
        internal.evidenceLibraries.readinessSetupActions.runReadinessSetup,
        fixture.args,
      ),
    ).resolves.toEqual({ movedTo, status: "moving" });

    const saved = await fixture.t.run(async (ctx) => {
      const operation = await ctx.db.get(fixture.created.setupOperationId);
      const binding = await ctx.db.get(fixture.created.runtimeBindingId);
      const revisionIdentity = await ctx.db
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
      return { binding, draftIdentity, operation, revisionIdentity };
    });
    expect(saved.binding).toMatchObject({ targetBaseUrl: movedTo });
    expect(saved.operation).toMatchObject({
      stage: "application",
      status: "running",
      addressMove: {
        from: fixture.created.publicAddress,
        to: movedTo,
        count: 1,
      },
    });
    expect(saved.revisionIdentity?.payload).toMatchObject({ baseUrl: movedTo });
    expect(saved.draftIdentity?.payload).toMatchObject({ baseUrl: movedTo });
  });

  it("keeps the name and only numbers the address", async () => {
    const fixture = await createHijackedAddressFixture("address-name");
    await fixture.t.action(
      internal.evidenceLibraries.readinessSetupActions.runReadinessSetup,
      fixture.args,
    );
    const identity = await fixture.t.run(async (ctx) => {
      const section = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query
            .eq("draftId", fixture.created.draftId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      return section?.payload as { name: string; shortName: string };
    });
    expect(identity).toMatchObject({
      name: "Climate Evidence",
      shortName: "Climate",
    });
  });

  it("stops moving and fails after three moves", async () => {
    const fixture = await createHijackedAddressFixture("address-limit");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.setupOperationId, {
        addressMove: {
          from: fixture.created.publicAddress,
          to: fixture.created.publicAddress,
          movedAt: Date.now(),
          count: 3,
          applied: true,
        },
      });
    });

    await expect(
      fixture.t.action(
        internal.evidenceLibraries.readinessSetupActions.runReadinessSetup,
        fixture.args,
      ),
    ).resolves.toEqual({ status: "failed" });
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );
    expect(operation).toMatchObject({
      status: "failed",
      error: {
        code: "ADDRESS_NOT_OURS",
        message: "Another site answers this Evidence Library address",
      },
    });
  });
});
