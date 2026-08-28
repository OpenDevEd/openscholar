/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import { AI_PROVIDER_CREDENTIAL_KEY } from "../../lib/evidence-libraries/configuration/ai";
import { createCoolifyLibraryTag } from "./coolifyClient";
import {
  createDeployedSetupFixture,
  essentialSetupSections,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";

const ENCRYPTION_KEY = "33".repeat(32);
const APPLICATION_UUID = "app000000000000000000001";
const COOLIFY_ORIGIN = "http://coolify:8080";
const RUNTIME_COMMIT = "a".repeat(40);
const NEWER_COMMIT = "b".repeat(40);
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
}) {
  let commit = RUNTIME_COMMIT;
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
          services: ["web", "worker", "search", "storage", "db", "proxy"],
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
      },
      receipt: {
        revisionKey: deployment.activated.revisionKey,
        runtimeReceiptId: "deployment-configuration-65",
        runtimeCommit: RUNTIME_COMMIT,
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
      runtimeUpdate: { from: RUNTIME_COMMIT, to: NEWER_COMMIT },
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
    expect(completed.binding).toMatchObject({ runtimeCommit: NEWER_COMMIT });
    expect(completed.library).toMatchObject({
      activeRevisionId: activeRevision!._id,
      activeDeploymentOperationId: started.operationId,
    });
    expect(completed.operation).toMatchObject({
      status: "succeeded",
      receipt: { runtimeCommit: NEWER_COMMIT },
    });
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
            .eq("revisionId", fixture.activated.revisionId)
            .eq("sectionKey", "identity"),
        )
        .unique();
      return {
        binding: await ctx.db.get(fixture.created.runtimeBindingId),
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

  it("does not steal an active lease and reclaims an expired one", async () => {
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
    ).rejects.toThrow(/already running/);

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
    ).resolves.toMatchObject({ status: "running" });
    const reclaimed = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(deployment.activated.operationId),
    );
    expect(reclaimed).toMatchObject({ attemptCount: 2, status: "running" });
    expect(reclaimed?.configurationAttemptToken).not.toBe(
      deployment.attemptToken,
    );
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
            revisionKey: prepared.revision.key,
            defaultLocale: prepared.defaultLocale,
            runtimeCommit: RUNTIME_COMMIT,
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
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
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
