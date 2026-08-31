/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import { TEST_AI_MODELS } from "../../lib/evidence-libraries/configuration/test-models";
import {
  AI_PROVIDER,
  AI_PROVIDER_CREDENTIAL_KEY,
  PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
} from "../../lib/evidence-libraries/configuration/ai";
import { createCoolifyLibraryTag } from "./coolifyClient";
import {
  createDeployedSetupFixture,
  essentialSetupSections,
  TEST_RUNTIME_IMAGE,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";

const ENCRYPTION_KEY = "33".repeat(32);
const APPLICATION_UUID = "app000000000000000000001";
const COOLIFY_ORIGIN = "http://coolify:8080";
const RUNTIME_COMMIT = "a".repeat(40);
const NEWER_COMMIT = "b".repeat(40);
const NEWER_RUNTIME_IMAGE = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"f".repeat(64)}`;
const LATEST_COMMIT = "c".repeat(40);
const LATEST_RUNTIME_IMAGE = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"e".repeat(64)}`;
const INITIAL_CONFIG_HASH = "1".repeat(32);
const UPDATED_CONFIG_HASH = "2".repeat(32);
const FINISHED_CONFIG_HASH = "3".repeat(64);

type RecordedRequest = {
  body: unknown;
  method: string;
  url: URL;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function runtimeEnvironment(key: string, value: string) {
  return {
    uuid: `env-${key.toLowerCase().replaceAll("_", "-")}`,
    key,
    value,
    is_preview: false,
    is_literal: true,
    is_multiline: false,
    is_shown_once: false,
    is_runtime: true,
    is_buildtime: true,
    is_coolify: false,
    is_buildpack_control: false,
    is_shared: false,
    comment: null,
  };
}

function createRuntimeNetwork(input: {
  libraryId: string;
  publicAddress: string;
  revisionKey: string;
  runtimeCommit?: string;
  runtimeImage?: string;
}) {
  let commit = input.runtimeCommit ?? RUNTIME_COMMIT;
  // The address Coolify serves. A move patches it, and every later request
  // has to be answered on the new one.
  let publicDomain = input.publicAddress;
  let configHash = INITIAL_CONFIG_HASH;
  let deployedConfigHash = INITIAL_CONFIG_HASH;
  let deploymentStatus = "queued";
  let activeRevision = input.revisionKey;
  const requests: RecordedRequest[] = [];
  const environments = [
    runtimeEnvironment(
      "LIBRARY_CONFIG_JSON",
      JSON.stringify({ revision: "old" }),
    ),
    runtimeEnvironment("MEILISEARCH_MASTER_KEY", "search-master-key"),
    runtimeEnvironment("SOURCE_COMMIT", commit),
    runtimeEnvironment(
      "RUNTIME_IMAGE",
      input.runtimeImage ?? TEST_RUNTIME_IMAGE,
    ),
  ];
  const deploymentUuid = "deployment-configuration-65";

  const application = () => ({
    uuid: APPLICATION_UUID,
    name: createCoolifyLibraryTag(input.libraryId as never),
    config_hash: configHash,
    git_repository: "OpenDevEd/new-el",
    git_branch: "main",
    git_commit_sha: commit,
    build_pack: "dockercompose",
    ports_exposes: "80",
    fqdn: null,
    docker_compose_location: "/docker/compose.library.yaml",
    docker_compose_domains: JSON.stringify({
      web: { domain: publicDomain },
    }),
    source_type: "App\\Models\\GithubApp",
    source_id: 7,
    environment: {
      name: "development",
      project: { uuid: "project0000000000000001" },
    },
    destination: { server: { uuid: "server00000000000000001" } },
    settings: {
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      connect_to_docker_network: false,
      inject_build_args_to_dockerfile: false,
      include_source_commit_in_build: false,
      is_container_label_escape_enabled: false,
    },
  });

  const fetchImpl: typeof fetch = vi.fn(
    async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      const request = requestInput instanceof Request ? requestInput : null;
      const url = new URL(
        typeof requestInput === "string"
          ? requestInput
          : requestInput instanceof URL
            ? requestInput.href
            : requestInput.url,
      );
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ body, method, url });

      if (url.origin === COOLIFY_ORIGIN) {
        // The address check asks what Coolify serves. Nothing but this
        // library, which never offers its own address as a candidate.
        if (
          method === "GET" &&
          (url.pathname === "/api/v1/applications" ||
            url.pathname === "/api/v1/services")
        ) {
          return jsonResponse([]);
        }
        const applicationPath = `/api/v1/applications/${APPLICATION_UUID}`;
        if (method === "GET" && url.pathname === applicationPath) {
          return jsonResponse(application());
        }
        if (method === "PATCH" && url.pathname === applicationPath) {
          const patch = body as {
            git_commit_sha?: string;
            docker_compose_domains?: { name: string; domain: string }[];
          };
          if (patch.git_commit_sha) commit = patch.git_commit_sha;
          const movedDomain = patch.docker_compose_domains?.[0]?.domain;
          if (movedDomain) publicDomain = movedDomain;
          configHash = UPDATED_CONFIG_HASH;
          return jsonResponse({ uuid: APPLICATION_UUID });
        }
        if (method === "GET" && url.pathname === `${applicationPath}/tags`) {
          return jsonResponse([
            {
              uuid: "tag-openscholar-library",
              name: createCoolifyLibraryTag(input.libraryId as never),
            },
          ]);
        }
        if (url.pathname === `${applicationPath}/envs`) {
          if (method === "GET")
            return jsonResponse(structuredClone(environments));
          const desired = body as { key: string; value: string };
          const current = environments.find(({ key }) => key === desired.key);
          if (current) Object.assign(current, desired);
          else
            environments.push(runtimeEnvironment(desired.key, desired.value));
          configHash = UPDATED_CONFIG_HASH;
          return jsonResponse(
            environments.find(({ key }) => key === desired.key),
            201,
          );
        }
        if (
          method === "GET" &&
          url.pathname ===
            `/api/v1/deployments/applications/${APPLICATION_UUID}`
        ) {
          return jsonResponse({ count: 0, deployments: [] });
        }
        if (method === "POST" && url.pathname === "/api/v1/deploy") {
          deployedConfigHash = configHash;
          return jsonResponse({
            deployments: [
              {
                message: "Deployment started",
                resource_uuid: APPLICATION_UUID,
                deployment_uuid: deploymentUuid,
              },
            ],
          });
        }
        if (
          method === "GET" &&
          url.pathname === `/api/v1/deployments/${deploymentUuid}`
        ) {
          return jsonResponse({
            deployment_uuid: deploymentUuid,
            commit,
            configuration_hash: deployedConfigHash,
            status: deploymentStatus,
          });
        }
      }

      if (
        url.origin === "https://verifier.example.test" &&
        method === "POST" &&
        url.pathname === "/v1/library-runtime/readiness"
      ) {
        return jsonResponse({
          ready: true,
          applicationUuid: APPLICATION_UUID,
          commit,
          runtimeImage: environments.find(({ key }) => key === "RUNTIME_IMAGE")
            ?.value,
          services: [
            "web",
            "search-indexer",
            "source-sync",
            "source-writeback",
            "publication-worker",
            "meilisearch",
            "redis",
          ].map((service) => ({ service })),
        });
      }
      if (
        url.origin === new URL(publicDomain).origin &&
        method === "GET" &&
        url.pathname === "/api/library-config/health"
      ) {
        return jsonResponse({
          state: "active",
          rejected: null,
          active: { revision: activeRevision },
        });
      }
      if (
        url.origin === new URL(publicDomain).origin &&
        method === "GET" &&
        url.pathname === "/lib"
      ) {
        return new Response("ready", { status: 200 });
      }
      // A live library sends a signed-out visitor of its admin area to
      // OpenScholar, and readiness checks exactly that.
      if (
        url.origin === new URL(publicDomain).origin &&
        method === "GET" &&
        url.pathname === "/admin"
      ) {
        return new Response(null, {
          status: 307,
          headers: {
            location: `https://openscholar.example.test/evidence-libraries/${input.libraryId}/admin?return=%2Fadmin`,
          },
        });
      }
      // Any other host is free: our proxy has no server for it.
      if (url.pathname === "/") {
        return new Response("no available server", { status: 503 });
      }
      return jsonResponse({ message: "Unexpected test request" }, 500);
    },
  );

  return {
    fetchImpl,
    requests,
    environments,
    get commit() {
      return commit;
    },
    get publicDomain() {
      return publicDomain;
    },
    finishDeployment() {
      deploymentStatus = "finished";
      deployedConfigHash = FINISHED_CONFIG_HASH;
      configHash = FINISHED_CONFIG_HASH;
    },
    failReadiness() {
      activeRevision = "another-revision";
    },
    restoreReadiness() {
      activeRevision = input.revisionKey;
    },
    setActiveRevision(revisionKey: string) {
      activeRevision = revisionKey;
    },
  };
}

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
  await fixture.t.run(async (ctx) => {
    const binding = await ctx.db.get(fixture.created.runtimeBindingId);
    if (!binding) throw new Error("Runtime binding is missing");
    await ctx.db.patch(binding._id, {
      targetRuntimeId: APPLICATION_UUID,
      updatedAt: 100,
    });
    const credentials = await ctx.db
      .query("evidenceLibraryCredentials")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", fixture.created.libraryId),
      )
      .collect();
    for (const [index, credential] of credentials.entries()) {
      const value =
        credential.credentialKey === "library-service"
          ? `els_${"a".repeat(43)}`
          : credential.credentialKey === "/authentication/secret"
            ? "a".repeat(32)
            : credential.credentialKey === "/services/database/url"
              ? "postgresql://library:password@postgres:5432/library"
              : credential.credentialKey === "/services/search/key"
                ? "search-key"
                : "storage-service-role-key";
      await ctx.db.patch(credential._id, {
        encryptedValue: encrypt(value, ENCRYPTION_KEY),
        updatedAt: 200 + index,
      });
    }
  });
  return fixture;
}

/** The publish operation an address move just queued, newest first. */
async function readMoveOperation(
  fixture: Awaited<ReturnType<typeof createReadyLibrary>>,
) {
  const operation = await fixture.t.run(async (ctx) => {
    const rows = await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_createdAt", (query) =>
        query.eq("libraryId", fixture.created.libraryId),
      )
      .order("desc")
      .take(5);
    return rows.find((row) => row.addressMove) ?? null;
  });
  if (!operation?.configurationAttemptToken) {
    throw new Error("The address move did not start an attempt");
  }
  return operation;
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
    api.evidenceLibraries.mutations.saveDraftSections,
    {
      libraryId: fixture.created.libraryId,
      sections: toSectionRows(sections),
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
  const operation = await fixture.t.run((ctx) =>
    ctx.db.get(activated.operationId),
  );
  if (!operation?.configurationAttemptToken) {
    throw new Error("Configuration deployment did not start an attempt");
  }
  return {
    activated,
    fixture,
    sections,
    attemptToken: operation.configurationAttemptToken,
    attemptCount: operation.attemptCount,
  };
}

type ChangedConfiguration = Awaited<
  ReturnType<typeof activateChangedConfiguration>
>;

async function failConfigurationDeployment(
  deployment: ChangedConfiguration,
  options: { runtimeCommit?: string } = {},
) {
  await deployment.fixture.t.run(async (ctx) => {
    const [operation, revision, binding] = await Promise.all([
      ctx.db.get(deployment.activated.operationId),
      ctx.db.get(deployment.activated.revisionId),
      ctx.db.get(deployment.fixture.created.runtimeBindingId),
    ]);
    if (!operation || !revision || !binding || binding.state !== "ready") {
      throw new Error("The deployment fixture is incomplete");
    }
    await ctx.db.patch(operation._id, {
      status: "failed",
      stage: "publishing",
      error: {
        code: "CONFIGURATION_DEPLOYMENT_STALLED",
        message: "The publish stopped answering. Try again.",
        stage: "publishing",
      },
      completedAt: Date.now(),
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
      configurationDeploymentTarget: {
        applicationId: binding.targetRuntimeId,
        aiProviderKey: { present: false },
        runtimeBindingId: binding._id,
        targetBaseUrl: binding.targetBaseUrl,
        customDomains: [],
        revisionKey: revision.revisionKey,
        defaultLocale: "en-GB",
        runtimeCommit: options.runtimeCommit ?? binding.runtimeCommit,
        runtimeImage: binding.runtimeImage,
        encryptedRuntimeConfig: "encrypted-runtime-config",
        runtimeConfigSha256: "4".repeat(64),
        savedAt: Date.now(),
      },
    });
  });
}

async function failSavedConfigurationDeployment(
  deployment: ChangedConfiguration,
) {
  await deployment.fixture.t.run(async (ctx) => {
    const operation = await ctx.db.get(deployment.activated.operationId);
    if (!operation) throw new Error("The deployment operation is missing");
    await ctx.db.patch(operation._id, {
      status: "failed",
      error: {
        code: "CONFIGURATION_DEPLOYMENT_STALLED",
        message: "The publish stopped answering. Try again.",
        stage: "publishing",
      },
      completedAt: Date.now(),
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
    });
  });
}

describe("Evidence Library configuration deployment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    vi.stubEnv("EL_COOLIFY_URL", COOLIFY_ORIGIN);
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
    vi.stubEnv("EL_OPENSCHOLAR_URL", "https://openscholar.example.test");
    vi.stubEnv("EL_CONVEX_SITE_URL", "https://convex.example.test");
    vi.stubEnv("EL_RUNTIME_VERIFIER_URL", "https://verifier.example.test");
    vi.stubEnv("EL_RUNTIME_VERIFIER_TOKEN", "verifier-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not activate an unchanged live configuration", async () => {
    const fixture = await createReadyLibrary("unchanged");
    const unchanged = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId: fixture.created.libraryId },
    );
    expect(unchanged.hasUnpublishedChanges).toBe(false);

    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.mutations.activateConfiguration,
        {
          libraryId: fixture.created.libraryId,
          expectedEditVersion: fixture.activated.editVersion,
        },
      ),
    ).rejects.toThrow(/CONFLICT.*no saved changes to activate/i);

    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: toSectionRows({
          ...essentialSetupSections,
          identity: {
            ...essentialSetupSections.identity,
            name: "Changed unchanged",
          },
        }),
        expectedEditVersion: fixture.activated.editVersion,
      },
    );
    const changed = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId: fixture.created.libraryId },
    );
    expect(changed.hasUnpublishedChanges).toBe(true);
    expect(saved.editVersion).toBe(changed.draft.editVersion);
  });

  it("refuses to publish before touching Coolify when the platform has no embedding key", async () => {
    vi.stubEnv("EL_EMBEDDING_OPENROUTER_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fixture = await createReadyLibrary("deploy-embedder");
    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: toSectionRows({
          ...essentialSetupSections,
          features: { ai: true },
          ai: {
            providers: [
              {
                provider: AI_PROVIDER,
                enabled: true,
                models: [TEST_AI_MODELS[0]],
                defaultModel: TEST_AI_MODELS[0],
              },
            ],
          },
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
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(activated.operationId),
    );
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      throw new Error("Coolify must not be called");
    });

    expect(
      await fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: activated.operationId,
          attemptToken: operation!.configurationAttemptToken!,
          attemptCount: operation!.attemptCount,
        },
      ),
    ).toEqual({ status: "failed" });
    expect(calls).toBe(0);
    const failed = await fixture.t.run((ctx) =>
      ctx.db.get(activated.operationId),
    );
    expect(failed).toMatchObject({
      error: {
        code: "PLATFORM_EMBEDDING_KEY_MISSING",
        message: PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
      },
      status: "failed",
    });
    // Nothing was written down, so no secret can be recovered from the row.
    expect(failed?.configurationDeploymentTarget).toBeUndefined();
  });

  it("sends the embedder to Coolify and keeps its key out of every owner view", async () => {
    const EMBEDDING_KEY = `sk-or-v1-${"5".repeat(48)}`;
    vi.stubEnv("EL_EMBEDDING_OPENROUTER_KEY", EMBEDDING_KEY);
    const fixture = await createReadyLibrary("deploy-embedder-ok");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryCredentials", {
        libraryId,
        credentialKey: AI_PROVIDER_CREDENTIAL_KEY,
        pathPattern: "/ai/providers/*/apiKey",
        instanceKey: AI_PROVIDER,
        encryptedValue: encrypt("sk-or-answers", ENCRYPTION_KEY),
        validationState: "untested",
        createdByClerkUserId: "user_embedder",
        updatedByClerkUserId: "user_embedder",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId,
        sections: toSectionRows({
          ...essentialSetupSections,
          features: { ai: true },
          ai: {
            providers: [
              {
                provider: AI_PROVIDER,
                enabled: true,
                models: [TEST_AI_MODELS[0]],
                defaultModel: TEST_AI_MODELS[0],
              },
            ],
          },
        }),
        expectedEditVersion: fixture.activated.editVersion,
      },
    );
    const activated = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      { libraryId, expectedEditVersion: saved.editVersion },
    );
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(activated.operationId),
    );
    const network = createRuntimeNetwork({
      libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);

    await fixture.t.action(
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      {
        libraryId,
        operationId: activated.operationId,
        attemptToken: operation!.configurationAttemptToken!,
        attemptCount: operation!.attemptCount,
      },
    );

    // Coolify received the embedder, with the platform key inside it.
    const runtimeJson = network.environments.find(
      ({ key }) => key === "LIBRARY_CONFIG_JSON",
    )!.value;
    expect(JSON.parse(runtimeJson)).toMatchObject({
      features: { ai: true, aiSearch: true, deepResearch: false },
      search: {
        embedder: {
          source: "rest",
          url: "https://openrouter.ai/api/v1/embeddings",
          apiKey: EMBEDDING_KEY,
          dimensions: 1024,
        },
      },
    });

    // The owner's own views, read after the action ran, carry neither key.
    const draft = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    const overviews = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    const versions = await fixture.admin.query(
      api.evidenceLibraries.versions.listVersions,
      { libraryId },
    );
    for (const view of [draft, overviews, versions]) {
      const seen = JSON.stringify(view);
      expect(seen).not.toContain(EMBEDDING_KEY);
      expect(seen).not.toContain("sk-or-answers");
      expect(seen).not.toContain("openrouter.ai/api/v1/embeddings");
    }
  });

  it("saves one immutable target, polls Coolify, verifies the runtime, and activates it", async () => {
    const deployment = await activateChangedConfiguration("action-success");
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);
    const actionArgs = {
      libraryId: deployment.fixture.created.libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };

    const firstResult = await deployment.fixture.t.action(
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      actionArgs,
    );
    expect(firstResult).toEqual({ pollCount: 1, status: "running" });
    const afterStart = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(deployment.activated.operationId),
    );
    expect(afterStart).toMatchObject({
      status: "running",
      stage: "publishing",
      configurationDeploymentTarget: {
        applicationId: APPLICATION_UUID,
        revisionKey: deployment.activated.revisionKey,
        runtimeCommit: RUNTIME_COMMIT,
        runtimeImage: TEST_RUNTIME_IMAGE,
      },
      receipt: {
        revisionKey: deployment.activated.revisionKey,
        runtimeReceiptId: "deployment-configuration-65",
        runtimeCommit: RUNTIME_COMMIT,
        runtimeImage: TEST_RUNTIME_IMAGE,
        coolifyConfigHash: UPDATED_CONFIG_HASH,
      },
    });
    const firstRuntimeJson = network.environments.find(
      ({ key }) => key === "LIBRARY_CONFIG_JSON",
    )!.value;
    expect(JSON.parse(firstRuntimeJson)).toMatchObject({
      revision: deployment.activated.revisionKey,
      services: { search: { key: expect.any(String) } },
    });

    await deployment.fixture.t.run(async (ctx) => {
      const credentials = await ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId", (query) =>
          query.eq("libraryId", deployment.fixture.created.libraryId),
        )
        .collect();
      await ctx.db.patch(credentials[0]!._id, {
        encryptedValue: encrypt("changed-after-start", ENCRYPTION_KEY),
        updatedAt: 999,
      });
      await ctx.db.patch(deployment.fixture.created.libraryId, {
        latestRevisionId: deployment.fixture.activated.revisionId,
      });
    });
    network.finishDeployment();

    expect(
      await deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ status: "succeeded" });
    const completed = await deployment.fixture.t.run(async (ctx) => ({
      library: await ctx.db.get(deployment.fixture.created.libraryId),
      binding: await ctx.db.get(deployment.fixture.created.runtimeBindingId),
      operation: await ctx.db.get(deployment.activated.operationId),
    }));
    expect(completed.library?.activeRevisionId).toBe(
      deployment.activated.revisionId,
    );
    expect(completed.binding).toMatchObject({
      state: "ready",
      runtimeCommit: RUNTIME_COMMIT,
    });
    expect(completed.library?.activeDeploymentOperationId).toBe(
      deployment.activated.operationId,
    );
    expect(completed.operation).toMatchObject({
      status: "succeeded",
      stage: "completed",
      receipt: { coolifyConfigHash: FINISHED_CONFIG_HASH },
    });
    expect(completed.operation).not.toHaveProperty("configurationAttemptToken");
    expect(
      network.requests.filter(
        ({ method, url }) =>
          method === "PATCH" && url.pathname.endsWith("/envs"),
      ),
    ).toHaveLength(1);
    expect(
      network.requests.filter(
        ({ method, url }) =>
          method === "POST" && url.pathname === "/api/v1/deploy",
      ),
    ).toHaveLength(1);
    expect(
      network.requests.some(
        ({ url }) => url.pathname === "/v1/library-runtime/readiness",
      ),
    ).toBe(true);
    expect(
      network.requests.some(
        ({ url }) => url.pathname === "/api/library-config/health",
      ),
    ).toBe(true);
    expect(
      network.environments.find(({ key }) => key === "LIBRARY_CONFIG_JSON")!
        .value,
    ).toBe(firstRuntimeJson);
    await expect(
      deployment.fixture.admin.action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: deployment.fixture.created.libraryId },
      ),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("retries a failed current deployment by reusing its saved target", async () => {
    const deployment = await activateChangedConfiguration("retry-saved-target");
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);
    const actionArgs = {
      libraryId: deployment.fixture.created.libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });
    await failSavedConfigurationDeployment(deployment);
    network.finishDeployment();
    const writesBeforeRetry = network.requests.filter(
      ({ method, url }) =>
        method === "PATCH" || url.pathname === "/api/v1/deploy",
    ).length;

    const retried = await deployment.fixture.admin.mutation(
      api.evidenceLibraries.configurationDeployment
        .retryConfigurationDeployment,
      {
        libraryId: deployment.fixture.created.libraryId,
        operationId: deployment.activated.operationId,
      },
    );
    const claimed = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(deployment.activated.operationId),
    );
    if (!claimed?.configurationAttemptToken) {
      throw new Error("The retry did not claim the deployment");
    }
    expect(retried).toMatchObject({
      operationId: deployment.activated.operationId,
      revisionId: deployment.activated.revisionId,
      status: "running",
    });
    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          ...actionArgs,
          attemptToken: claimed.configurationAttemptToken,
          attemptCount: claimed.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "succeeded" });

    const writesAfterRetry = network.requests.filter(
      ({ method, url }) =>
        method === "PATCH" || url.pathname === "/api/v1/deploy",
    ).length;
    expect(writesAfterRetry).toBe(writesBeforeRetry);
    await expect(
      deployment.fixture.t.run((ctx) =>
        ctx.db.get(deployment.activated.operationId),
      ),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("bases a publish after a failed publish on the live revision", async () => {
    const deployment = await activateChangedConfiguration(
      "publish-after-failure",
    );
    const { libraryId } = deployment.fixture.created;
    const activeRevisionId = deployment.fixture.activated.revisionId;
    const network = createRuntimeNetwork({
      libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);
    const firstActionArgs = {
      libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        firstActionArgs,
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });
    await failSavedConfigurationDeployment(deployment);

    const failed = await deployment.fixture.t.run(async (ctx) => ({
      draft: await ctx.db
        .query("evidenceLibraryConfigDrafts")
        .withIndex("by_libraryId", (query) => query.eq("libraryId", libraryId))
        .unique(),
      library: await ctx.db.get(libraryId),
    }));
    expect(failed.library?.activeRevisionId).toBe(activeRevisionId);
    expect(failed.draft?.baseRevisionId).toBe(deployment.activated.revisionId);

    const saved = await deployment.fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId,
        sections: toSectionRows({
          ...deployment.sections,
          identity: {
            ...deployment.sections.identity,
            name: "Changed again",
          },
        }),
        expectedEditVersion: deployment.activated.editVersion,
      },
    );
    const second = await deployment.fixture.admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      {
        libraryId,
        expectedEditVersion: saved.editVersion,
      },
    );
    const secondRevision = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(second.revisionId),
    );
    expect(secondRevision).toMatchObject({
      basedOnRevisionId: activeRevisionId,
    });
    expect(second.revisionId).not.toBe(deployment.activated.revisionId);

    const secondOperation = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(second.operationId),
    );
    if (!secondOperation?.configurationAttemptToken) {
      throw new Error("The second publish did not start an attempt");
    }
    const secondActionArgs = {
      libraryId,
      operationId: second.operationId,
      attemptToken: secondOperation.configurationAttemptToken,
      attemptCount: secondOperation.attemptCount,
    };
    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        secondActionArgs,
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });

    network.finishDeployment();
    network.setActiveRevision(second.revisionKey);
    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        secondActionArgs,
      ),
    ).resolves.toEqual({ status: "succeeded" });
    await expect(
      deployment.fixture.t.run((ctx) => ctx.db.get(libraryId)),
    ).resolves.toMatchObject({ activeRevisionId: second.revisionId });
  });

  it("keeps the previous revision active while runtime readiness catches up", async () => {
    const deployment = await activateChangedConfiguration("action-failure");
    const previousRevisionId = deployment.fixture.activated.revisionId;
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);
    const actionArgs = {
      libraryId: deployment.fixture.created.libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };
    await deployment.fixture.t.action(
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      actionArgs,
    );
    network.finishDeployment();
    network.failReadiness();

    expect(
      await deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ pollCount: 1, status: "running" });
    const waiting = await deployment.fixture.t.run(async (ctx) => ({
      library: await ctx.db.get(deployment.fixture.created.libraryId),
      binding: await ctx.db.get(deployment.fixture.created.runtimeBindingId),
      operation: await ctx.db.get(deployment.activated.operationId),
    }));
    expect(waiting.library?.activeRevisionId).toBe(previousRevisionId);
    expect(waiting.binding).toMatchObject({ state: "ready" });
    expect(waiting.operation).toMatchObject({
      status: "running",
      stage: "activating",
      configurationReadinessPollCount: 1,
    });
    network.restoreReadiness();
    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).resolves.toEqual({ status: "succeeded" });
  });

  it("updates the software commit first, deploys the active revision at it, and records it on the binding", async () => {
    const fixture = await createReadyLibrary("runtime-update");
    const activeRevision = await fixture.t.run(async (ctx) => {
      const library = await ctx.db.get(fixture.created.libraryId);
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: NEWER_COMMIT,
        latestImage: NEWER_RUNTIME_IMAGE,
        changes: [{ sha: NEWER_COMMIT, message: "feat: faster search" }],
        checkedAt: Date.now(),
      });
      return await ctx.db.get(library!.activeRevisionId!);
    });
    const started = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    expect(started).toMatchObject({
      status: "running",
      revisionId: activeRevision!._id,
      from: RUNTIME_COMMIT,
      to: NEWER_COMMIT,
    });
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
    );
    expect(operation).toMatchObject({
      kind: "publish",
      runtimeUpdate: {
        from: RUNTIME_COMMIT,
        to: NEWER_COMMIT,
        fromImage: TEST_RUNTIME_IMAGE,
        toImage: NEWER_RUNTIME_IMAGE,
      },
      revisionId: activeRevision!._id,
    });
    expect(operation).not.toHaveProperty("activationEditVersion");
    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.versions.startRuntimeUpdate,
        {
          libraryId: fixture.created.libraryId,
        },
      ),
    ).rejects.toThrow(/already running/);

    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: activeRevision!.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);
    const actionArgs = {
      libraryId: fixture.created.libraryId,
      operationId: started.operationId,
      attemptToken: operation!.configurationAttemptToken!,
      attemptCount: operation!.attemptCount,
    };
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ pollCount: 1, status: "running" });
    const writes = network.requests
      .filter(({ method }) => method === "PATCH")
      .map(({ url }) => url.pathname);
    expect(writes[0]).toBe(`/api/v1/applications/${APPLICATION_UUID}`);
    expect(writes.slice(1).every((path) => path.endsWith("/envs"))).toBe(true);
    expect(network.commit).toBe(NEWER_COMMIT);
    expect(
      network.environments.find(({ key }) => key === "SOURCE_COMMIT")?.value,
    ).toBe(NEWER_COMMIT);
    expect(
      JSON.parse(
        network.environments.find(({ key }) => key === "LIBRARY_CONFIG_JSON")!
          .value,
      ),
    ).toMatchObject({ revision: activeRevision!.revisionKey });

    network.finishDeployment();
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ status: "succeeded" });
    const completed = await fixture.t.run(async (ctx) => ({
      library: await ctx.db.get(fixture.created.libraryId),
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      operation: await ctx.db.get(started.operationId),
    }));
    expect(completed.binding).toMatchObject({
      runtimeCommit: NEWER_COMMIT,
      previousRuntime: {
        commit: RUNTIME_COMMIT,
        image: TEST_RUNTIME_IMAGE,
      },
    });
    expect(completed.library).toMatchObject({
      activeRevisionId: activeRevision!._id,
      activeDeploymentOperationId: started.operationId,
    });
    expect(completed.operation).toMatchObject({
      status: "succeeded",
      receipt: { runtimeCommit: NEWER_COMMIT },
    });
  });

  it("continues from the exact target of this library's failed software update", async () => {
    const fixture = await createReadyLibrary("runtime-update-intermediate");
    const releaseId = await fixture.t.run(async (ctx) =>
      ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: NEWER_COMMIT,
        latestImage: NEWER_RUNTIME_IMAGE,
        changes: [{ sha: NEWER_COMMIT, message: "feat: first image" }],
        checkedAt: Date.now(),
      }),
    );
    const first = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    const firstOperation = await fixture.t.run((ctx) =>
      ctx.db.get(first.operationId),
    );
    if (!firstOperation?.configurationAttemptToken) {
      throw new Error("The first software update did not start");
    }
    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: "r1",
    });
    vi.stubGlobal("fetch", network.fetchImpl);
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: first.operationId,
          attemptToken: firstOperation.configurationAttemptToken,
          attemptCount: firstOperation.attemptCount,
        },
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });
    expect(network.commit).toBe(NEWER_COMMIT);

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(first.operationId, {
        status: "failed",
        error: {
          code: "RUNTIME_NOT_READY",
          message: "The verifier was unavailable",
          stage: "publishing",
        },
        completedAt: Date.now(),
        configurationAttemptToken: undefined,
        configurationLeaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(releaseId, {
        latest: LATEST_COMMIT,
        latestImage: LATEST_RUNTIME_IMAGE,
        changes: [{ sha: LATEST_COMMIT, message: "feat: newest image" }],
        checkedAt: Date.now(),
      });
    });

    const second = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    const secondOperation = await fixture.t.run((ctx) =>
      ctx.db.get(second.operationId),
    );
    if (!secondOperation?.configurationAttemptToken) {
      throw new Error("The second software update did not start");
    }
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: second.operationId,
          attemptToken: secondOperation.configurationAttemptToken,
          attemptCount: secondOperation.attemptCount,
        },
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });
    expect(network.commit).toBe(LATEST_COMMIT);
    expect(
      network.environments.find(({ key }) => key === "RUNTIME_IMAGE")?.value,
    ).toBe(LATEST_RUNTIME_IMAGE);
  });

  it("refuses an intermediate release that is not in this library's failed update history", async () => {
    const fixture = await createReadyLibrary("runtime-update-unknown");
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: LATEST_COMMIT,
        latestImage: LATEST_RUNTIME_IMAGE,
        changes: [{ sha: LATEST_COMMIT, message: "feat: newest image" }],
        checkedAt: Date.now(),
      });
    });
    const started = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
    );
    if (!operation?.configurationAttemptToken) {
      throw new Error("The software update did not start");
    }
    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: "r1",
      runtimeCommit: NEWER_COMMIT,
      runtimeImage: NEWER_RUNTIME_IMAGE,
    });
    vi.stubGlobal("fetch", network.fetchImpl);

    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: started.operationId,
          attemptToken: operation.configurationAttemptToken,
          attemptCount: operation.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "failed" });
    expect(
      network.requests.filter(({ method }) => method === "PATCH"),
    ).toHaveLength(0);
    await expect(
      fixture.t.run((ctx) => ctx.db.get(started.operationId)),
    ).resolves.toMatchObject({
      error: { code: "COOLIFY_APPLICATION_CONFLICT", stage: "assembling" },
      status: "failed",
    });
  });

  it("reissues a stale runtime update with a fresh target after a newer command", async () => {
    const fixture = await createReadyLibrary("runtime-update-reissue");
    const activeRevisionId = await fixture.t.run(async (ctx) => {
      const library = await ctx.db.get(fixture.created.libraryId);
      if (!library?.activeRevisionId) {
        throw new Error("The active revision is missing");
      }
      await ctx.db.patch(library.activeRevisionId, {
        ownerConfigurationVersion: 1,
      });
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: NEWER_COMMIT,
        latestImage: NEWER_RUNTIME_IMAGE,
        changes: [{ sha: NEWER_COMMIT, message: "feat: newer runtime" }],
        checkedAt: Date.now(),
      });
      return library.activeRevisionId;
    });

    const started = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    const candidate = await fixture.t.run((ctx) =>
      ctx.db.get(started.revisionId),
    );
    if (!candidate) throw new Error("The runtime candidate is missing");
    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: candidate.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);

    const firstAttempt = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
    );
    if (!firstAttempt?.configurationAttemptToken) {
      throw new Error("The runtime update did not start an attempt");
    }
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: started.operationId,
          attemptToken: firstAttempt.configurationAttemptToken,
          attemptCount: firstAttempt.attemptCount,
        },
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(started.operationId, {
        status: "failed",
        error: {
          code: "COOLIFY_DEPLOYMENT_FAILED",
          message: "Coolify could not deploy the Evidence Library",
          stage: "publishing",
        },
        completedAt: Date.now(),
        configurationAttemptToken: undefined,
        configurationLeaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
    });

    const failed = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "COOLIFY_DEPLOYMENT_FAILED" },
      configurationDeploymentTarget: { revisionKey: candidate.revisionKey },
    });
    const firstTargetSavedAt = failed!.configurationDeploymentTarget!.savedAt;

    const newerCommand = await fixture.t.run(async (ctx) => {
      const domainId = await ctx.db.insert("evidenceLibraryDomains", {
        libraryId: fixture.created.libraryId,
        host: "newer-command.example.org",
        verificationToken: "domain-token",
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
        idempotencyKey: "newer-domain-command",
        domainChange: {
          domainId,
          host: "newer-command.example.org",
          reason: "attach",
          token: "domain-token",
        },
        revisionId: activeRevisionId,
        status: "succeeded",
        stage: "completed",
        attemptCount: 1,
        requestedByClerkUserId: fixture.clerkUserId,
        createdAt: failed!.createdAt + 1,
        updatedAt: failed!.updatedAt + 1,
      });
    });
    vi.setSystemTime(Date.now() + 1_000);

    const repeated = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    expect(repeated).toMatchObject({
      operationId: started.operationId,
      revisionId: started.revisionId,
      status: "running",
    });
    const reissued = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
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

    network.finishDeployment();
    const secondAttempt = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
    );
    if (!secondAttempt?.configurationAttemptToken) {
      throw new Error("The reissued runtime update did not start an attempt");
    }
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: started.operationId,
          attemptToken: secondAttempt.configurationAttemptToken,
          attemptCount: secondAttempt.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "succeeded" });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.libraryId)),
    ).resolves.toMatchObject({ activeRevisionId: candidate._id });
    const completed = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
    );
    expect(completed?.configurationDeploymentTarget?.savedAt).toBeGreaterThan(
      firstTargetSavedAt,
    );
  });

  it("moves a live library only after Coolify serves the new address", async () => {
    const fixture = await createReadyLibrary("address-move-deploy");
    const movedTo = "https://climate-evidence-2-lib.libraries.example.test";
    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: fixture.activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);

    const moved = await fixture.admin.action(
      api.evidenceLibraries.addressActions.moveLibraryAddress,
      { libraryId: fixture.created.libraryId },
    );
    if (moved.status !== "moving") throw new Error("The move did not start");
    const operation = await readMoveOperation(fixture);
    const revision = await fixture.t.run((ctx) =>
      ctx.db.get(operation.revisionId!),
    );
    if (!revision) throw new Error("The moved revision is missing");
    network.setActiveRevision(revision.revisionKey);
    expect(moved.movedTo).toBe(movedTo);

    // The plan is on the operation; nothing carries the new address yet.
    const binding = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    expect(binding).toMatchObject({
      targetBaseUrl: fixture.created.publicAddress,
    });
    expect(operation).toMatchObject({
      addressMove: {
        from: fixture.created.publicAddress,
        to: movedTo,
        applied: false,
      },
    });
    expect(network.publicDomain).toBe(fixture.created.publicAddress);

    const args = {
      libraryId: fixture.created.libraryId,
      operationId: operation._id,
      attemptToken: operation.configurationAttemptToken!,
      attemptCount: operation.attemptCount,
    };
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        args,
      ),
    ).resolves.toMatchObject({ status: "running" });
    expect(network.publicDomain).toBe(movedTo);

    network.finishDeployment();
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        args,
      ),
    ).resolves.toEqual({ status: "succeeded" });

    const state = await fixture.t.run(async (ctx) => {
      const identity = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query
            .eq("revisionId", operation.revisionId!)
            .eq("sectionKey", "identity"),
        )
        .unique();
      return {
        binding: await ctx.db.get(fixture.created.runtimeBindingId),
        draft: await ctx.db
          .query("evidenceLibraryConfigDrafts")
          .withIndex("by_libraryId", (query) =>
            query.eq("libraryId", fixture.created.libraryId),
          )
          .unique(),
        identity,
        operation: await ctx.db.get(operation._id),
      };
    });
    expect(state.binding).toMatchObject({
      targetBaseUrl: movedTo,
      addressState: "ours",
      state: "ready",
    });
    expect(state.identity?.payload).toMatchObject({ baseUrl: movedTo });
    expect(state.draft).toMatchObject({
      baseRevisionId: operation.revisionId,
      editVersion: fixture.activated.editVersion,
    });
    expect(state.operation).toMatchObject({
      status: "succeeded",
      addressMove: { to: movedTo, applied: true },
    });
  });

  it("keeps the old address when Coolify refuses the new domain", async () => {
    const fixture = await createReadyLibrary("address-move-refused");
    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: fixture.activated.revisionKey,
    });
    const failing: typeof fetch = async (requestInput, init) => {
      const url = new URL(String(requestInput));
      const method = (init?.method ?? "GET").toUpperCase();
      if (
        method === "PATCH" &&
        url.pathname === `/api/v1/applications/${APPLICATION_UUID}`
      ) {
        return jsonResponse({ message: "Domain rejected" }, 422);
      }
      return await network.fetchImpl(requestInput, init);
    };
    vi.stubGlobal("fetch", failing);

    const moved = await fixture.admin.action(
      api.evidenceLibraries.addressActions.moveLibraryAddress,
      { libraryId: fixture.created.libraryId },
    );
    expect(moved).toMatchObject({ status: "moving" });
    const operation = await readMoveOperation(fixture);
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: fixture.created.libraryId,
          operationId: operation._id,
          attemptToken: operation.configurationAttemptToken!,
          attemptCount: operation.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "failed" });

    const after = await fixture.t.run(async (ctx) => ({
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      identity: await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query
            .eq("revisionId", fixture.activated.revisionId)
            .eq("sectionKey", "identity"),
        )
        .unique(),
    }));
    expect(after.binding).toMatchObject({
      targetBaseUrl: fixture.created.publicAddress,
    });
    expect(after.identity?.payload).toMatchObject({
      baseUrl: fixture.created.publicAddress,
    });
  });

  it("refuses a software update without a fresh check or when already up to date", async () => {
    const fixture = await createReadyLibrary("runtime-update-refused");
    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.versions.startRuntimeUpdate,
        {
          libraryId: fixture.created.libraryId,
        },
      ),
    ).rejects.toThrow(/Check for updates/);
    await fixture.t.run((ctx) =>
      ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: RUNTIME_COMMIT,
        latestImage: TEST_RUNTIME_IMAGE,
        changes: [],
        checkedAt: Date.now(),
      }),
    );
    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.versions.startRuntimeUpdate,
        {
          libraryId: fixture.created.libraryId,
        },
      ),
    ).rejects.toThrow(/latest software/);
    const operations = await fixture.t.run((ctx) =>
      ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .collect(),
    );
    expect(
      operations.filter(({ runtimeUpdate }) => runtimeUpdate),
    ).toHaveLength(0);
  });

  it("does not let an owner retry a running deployment", async () => {
    const deployment = await activateChangedConfiguration("lease-recovery");
    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        {
          libraryId: deployment.fixture.created.libraryId,
          operationId: deployment.activated.operationId,
        },
      ),
    ).rejects.toThrow(/cannot be retried/);

    await deployment.fixture.t.run((ctx) =>
      ctx.db.patch(deployment.activated.operationId, {
        configurationLeaseExpiresAt: Date.now() - 1,
      }),
    );
    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        {
          libraryId: deployment.fixture.created.libraryId,
          operationId: deployment.activated.operationId,
        },
      ),
    ).rejects.toThrow(/cannot be retried/);
    const unchanged = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(deployment.activated.operationId),
    );
    expect(unchanged).toMatchObject({ attemptCount: 1, status: "running" });
  });

  it("keeps an old-format failed publish out of retry and marks it non-retryable", async () => {
    const deployment = await activateChangedConfiguration("old-format-retry");
    const { libraryId } = deployment.fixture.created;
    await failConfigurationDeployment(deployment);
    await deployment.fixture.t.run(async (ctx) => {
      const operation = await ctx.db.get(deployment.activated.operationId);
      if (!operation?.revisionId) {
        throw new Error("The failed deployment revision is missing");
      }
      await ctx.db.patch(operation.revisionId, {
        ownerConfigurationVersion: 1,
      });
    });

    const projected = await deployment.fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    expect(projected.operation).toMatchObject({
      status: "failed",
      retryable: false,
    });

    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        { libraryId, operationId: deployment.activated.operationId },
      ),
    ).rejects.toThrow(/cannot be retried/i);

    await expect(
      deployment.fixture.t.run((ctx) =>
        ctx.db.get(deployment.activated.operationId),
      ),
    ).resolves.toMatchObject({ status: "failed", attemptCount: 1 });
  });

  it("does not retry a failed publish without a saved target", async () => {
    const deployment = await activateChangedConfiguration("missing-target");
    const { libraryId } = deployment.fixture.created;
    await failConfigurationDeployment(deployment);
    await deployment.fixture.t.run((ctx) =>
      ctx.db.patch(deployment.activated.operationId, {
        configurationDeploymentTarget: undefined,
      }),
    );

    const projected = await deployment.fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    expect(projected.operation).toMatchObject({
      status: "failed",
      retryable: false,
    });
    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        { libraryId, operationId: deployment.activated.operationId },
      ),
    ).rejects.toThrow(/cannot be retried/i);
  });

  it("marks a failed publish stale after a later activation", async () => {
    const deployment = await activateChangedConfiguration("stale-activation");
    const { libraryId } = deployment.fixture.created;
    await failConfigurationDeployment(deployment);

    const before = await deployment.fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    expect(before.operation).toMatchObject({ retryable: true });

    await deployment.fixture.t.run(async (ctx) => {
      const operation = await ctx.db.get(deployment.activated.operationId);
      if (!operation?.revisionId) {
        throw new Error("The failed deployment revision is missing");
      }
      const revision = await ctx.db.get(operation.revisionId);
      if (!revision)
        throw new Error("The failed deployment revision is missing");
      const newerRevisionId = await ctx.db.insert(
        "evidenceLibraryConfigRevisions",
        {
          libraryId,
          revisionKey: `${revision.revisionKey}-newer`,
          revisionNumber: revision.revisionNumber + 1,
          basedOnRevisionId: revision._id,
          rollbackOfRevisionId: null,
          ownerConfigurationVersion: revision.ownerConfigurationVersion,
          contractProvenance: revision.contractProvenance,
          createdByClerkUserId: revision.createdByClerkUserId,
          createdAt: Date.now(),
        },
      );
      await ctx.db.patch(libraryId, {
        activeRevisionId: newerRevisionId,
      });
    });

    const after = await deployment.fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    expect(after.operation).toMatchObject({ retryable: false });
    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        { libraryId, operationId: deployment.activated.operationId },
      ),
    ).rejects.toThrow(/cannot be retried/i);
  });

  it("rejects an older failed publish after a newer configuration command", async () => {
    const deployment = await activateChangedConfiguration("newer-command");
    const { libraryId } = deployment.fixture.created;
    await failConfigurationDeployment(deployment);

    await deployment.fixture.t.run(async (ctx) => {
      const operation = await ctx.db.get(deployment.activated.operationId);
      if (!operation || !operation.revisionId) {
        throw new Error("The failed deployment is missing");
      }
      await ctx.db.insert("evidenceLibraryConfigOperations", {
        libraryId,
        kind: "publish",
        idempotencyKey: "newer-configuration-command",
        activationEditVersion: (operation.activationEditVersion ?? 0) + 1,
        revisionId: operation.revisionId,
        status: "queued",
        stage: "queued",
        attemptCount: 0,
        requestedByClerkUserId: "newer-command-user",
        createdAt: operation.createdAt + 1,
        updatedAt: operation.updatedAt + 1,
      });
    });

    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        { libraryId, operationId: deployment.activated.operationId },
      ),
    ).rejects.toThrow(/cannot be retried/i);
    await expect(
      deployment.fixture.t.run((ctx) =>
        ctx.db.get(deployment.activated.operationId),
      ),
    ).resolves.toMatchObject({ status: "failed", attemptCount: 1 });
  });

  it("marks a failed publish stale after a later runtime update", async () => {
    const deployment = await activateChangedConfiguration("stale-runtime");
    const { libraryId } = deployment.fixture.created;
    await failConfigurationDeployment(deployment);

    const before = await deployment.fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    expect(before.operation).toMatchObject({ retryable: true });

    await deployment.fixture.t.run(async (ctx) => {
      const binding = await ctx.db.get(
        deployment.fixture.created.runtimeBindingId,
      );
      if (!binding || binding.state !== "ready") {
        throw new Error("The runtime binding is missing");
      }
      await ctx.db.patch(binding._id, { runtimeCommit: NEWER_COMMIT });
    });

    const after = await deployment.fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    expect(after.operation).toMatchObject({ retryable: false });
    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        { libraryId, operationId: deployment.activated.operationId },
      ),
    ).rejects.toThrow(/cannot be retried/i);
  });

  it("refuses a claimed retry before doing any Coolify work when its target goes stale", async () => {
    const deployment = await activateChangedConfiguration(
      "claimed-retry-stale",
    );
    const { libraryId } = deployment.fixture.created;
    await failConfigurationDeployment(deployment);
    const network = createRuntimeNetwork({
      libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);

    await deployment.fixture.admin.mutation(
      api.evidenceLibraries.configurationDeployment
        .retryConfigurationDeployment,
      { libraryId, operationId: deployment.activated.operationId },
    );
    const claimed = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(deployment.activated.operationId),
    );
    if (!claimed?.configurationAttemptToken) {
      throw new Error("The retry did not claim the deployment");
    }
    await deployment.fixture.t.run(async (ctx) => {
      const binding = await ctx.db.get(
        deployment.fixture.created.runtimeBindingId,
      );
      if (!binding || binding.state !== "ready") {
        throw new Error("The runtime binding is missing");
      }
      await ctx.db.patch(binding._id, { runtimeCommit: NEWER_COMMIT });
    });

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId,
          operationId: deployment.activated.operationId,
          attemptToken: claimed.configurationAttemptToken,
          attemptCount: claimed.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "failed" });
    expect(network.requests).toHaveLength(0);
    await expect(
      deployment.fixture.t.run((ctx) =>
        ctx.db.get(deployment.activated.operationId),
      ),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("rejects changed source credentials before saving or writing a target", async () => {
    const deployment = await activateChangedConfiguration("source-conflict");
    const prepared = await deployment.fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .prepareConfigurationDeployment,
      {
        libraryId: deployment.fixture.created.libraryId,
        operationId: deployment.activated.operationId,
        attemptToken: deployment.attemptToken,
        attemptCount: deployment.attemptCount,
      },
    );
    if (prepared.state !== "new") throw new Error("Expected a new target");
    await deployment.fixture.t.run((ctx) =>
      ctx.db.patch(prepared.source.machine.id, { updatedAt: 999 }),
    );
    await expect(
      deployment.fixture.t.mutation(
        internal.evidenceLibraries.configurationDeployment
          .saveConfigurationDeploymentTarget,
        {
          libraryId: deployment.fixture.created.libraryId,
          operationId: deployment.activated.operationId,
          attemptToken: deployment.attemptToken,
          attemptCount: deployment.attemptCount,
          source: prepared.source,
          target: {
            applicationId: prepared.applicationId,
            targetBaseUrl: prepared.targetBaseUrl,
            customDomains: [],
            revisionKey: prepared.revision.key,
            defaultLocale: prepared.defaultLocale,
            runtimeCommit: RUNTIME_COMMIT,
            runtimeImage: TEST_RUNTIME_IMAGE,
            encryptedRuntimeConfig: encrypt("{}", ENCRYPTION_KEY),
            runtimeConfigSha256: createHash("sha256")
              .update("{}")
              .digest("hex"),
          },
        },
      ),
    ).rejects.toThrow(/inputs changed/);
    expect(
      await deployment.fixture.t.run((ctx) =>
        ctx.db.get(deployment.activated.operationId),
      ),
    ).not.toHaveProperty("configurationDeploymentTarget");
  });

  it("refuses to finish a publish whose AI key was replaced along the way", async () => {
    const deployment = await activateChangedConfiguration("ai-key-late-change");
    const libraryId = deployment.fixture.created.libraryId;
    await deployment.fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryCredentials", {
        libraryId,
        credentialKey: AI_PROVIDER_CREDENTIAL_KEY,
        pathPattern: "/ai/providers/*/apiKey",
        instanceKey: "openrouter",
        encryptedValue: encrypt("sk-or-first", ENCRYPTION_KEY),
        validationState: "untested",
        createdByClerkUserId: "user_ai_key_late",
        updatedByClerkUserId: "user_ai_key_late",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const network = createRuntimeNetwork({
      libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    vi.stubGlobal("fetch", network.fetchImpl);
    const actionArgs = {
      libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };
    expect(
      await deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ pollCount: 1, status: "running" });

    network.finishDeployment();
    // The key changes at the very last moment: after the runtime has been
    // asked whether it is ready, and before the library is told it is live.
    const replaceKey = async () => {
      await deployment.fixture.t.run(async (ctx) => {
        const row = await ctx.db
          .query("evidenceLibraryCredentials")
          .withIndex("by_libraryId_and_credentialKey", (query) =>
            query
              .eq("libraryId", libraryId)
              .eq("credentialKey", AI_PROVIDER_CREDENTIAL_KEY),
          )
          .unique();
        await ctx.db.patch(row!._id, {
          encryptedValue: encrypt("sk-or-second", ENCRYPTION_KEY),
          updatedAt: 4242,
        });
      });
    };
    vi.stubGlobal("fetch", (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const answer = await network.fetchImpl(input, init);
      if (url.pathname === "/api/library-config/health") await replaceKey();
      return answer;
    }) as typeof fetch);

    expect(
      await deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ status: "failed" });
    const operation = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(deployment.activated.operationId),
    );
    expect(operation).toMatchObject({ status: "failed" });
    // The library keeps the revision it was already serving.
    const library = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(libraryId),
    );
    expect(library?.activeRevisionId).not.toBe(deployment.activated.revisionId);
  });

  it("ignores orphan public publish queues when activation starts", async () => {
    const fixture = await createReadyLibrary("orphan-queue");
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryConfigOperations", {
        libraryId: fixture.created.libraryId,
        kind: "publish",
        idempotencyKey: "legacy-public-publish",
        revisionId: fixture.activated.revisionId,
        status: "queued",
        stage: "queued",
        attemptCount: 0,
        requestedByClerkUserId: "legacy-user",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: toSectionRows({
          ...essentialSetupSections,
          identity: { ...essentialSetupSections.identity, name: "New name" },
        }),
        expectedEditVersion: fixture.activated.editVersion,
      },
    );
    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.mutations.activateConfiguration,
        {
          libraryId: fixture.created.libraryId,
          expectedEditVersion: saved.editVersion,
        },
      ),
    ).resolves.toMatchObject({ kind: "publish", status: "running" });
  });
});
