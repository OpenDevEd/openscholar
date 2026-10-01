import { assert } from "vitest";
/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { encrypt } from "../lib/crypto";
import { TEST_AI_MODELS } from "../../lib/evidence-libraries/configuration/test-models";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  AI_PROVIDER,
  AI_PROVIDER_CREDENTIAL_KEY,
  PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
} from "../../lib/evidence-libraries/configuration/ai";
import { createCoolifyLibraryTag } from "./coolifyClient";
import { configurationOperationRequiresDeployment } from "./operations";
import {
  createDeployedSetupFixture,
  essentialSetupSections,
  TEST_RUNTIME_IMAGE,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";
import { createFakeClerkOAuth } from "../../tests/helpers/fake-clerk-oauth";

// Every deployment keeps the library's OAuth application in step with its
// addresses, so Clerk answers from memory here.
let clerk = createFakeClerkOAuth();
beforeEach(() => {
  clerk = createFakeClerkOAuth();
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
});
function stubFetch(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", clerk.wrap(fetchImpl));
}

vi.mock("./domainEgressNode", () => ({
  openPinnedDomainClient: async () => globalThis.fetch,
  openOwnProxyClient: async () => globalThis.fetch,
}));

const ENCRYPTION_KEY = "33".repeat(32);
const APPLICATION_UUID = "app000000000000000000001";
const COOLIFY_ORIGIN = "http://coolify:8080";
const STORAGE_ORIGIN = "https://storage.example.test";
const MAX_PDF_BYTES = 52_428_800;
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

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
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
  canonicalAddress?: string;
  /** Other hosts the proxy routes to this library. */
  servedAddresses?: string[];
  revisionKey: string;
  runtimeCommit?: string;
  runtimeImage?: string;
}) {
  let commit = input.runtimeCommit ?? RUNTIME_COMMIT;
  // The address Coolify serves. A move patches it, and every later request
  // has to be answered on the new one.
  let publicDomain = input.publicAddress;
  let configHash = INITIAL_CONFIG_HASH;
  let deployedConfigHash: string | null = INITIAL_CONFIG_HASH;
  let deploymentStatus = "queued";
  let activeRevision = input.revisionKey;
  // The address the running site calls its own. It follows the configuration
  // it was given, as the real runtime does, and redirects every other host.
  let canonical = input.canonicalAddress ?? null;
  let previousCanonical = canonical;
  let readinessUnavailable = false;
  let configurationRejected = false;
  // A rollback stamps what it restores with the time it ran, and the runtime
  // then refuses any other configuration that is not newer than that.
  let rolledBackAt: number | null = null;
  let configurationBusy = false;
  let runtimeRouteMarker: string | null = null;
  const publicHealthMarkers: Array<string | null> = [];
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
  let storageDown: "unreachable" | "failing" | null = null;
  // Buckets made before JPEG covers allow PDFs and PNGs only.
  const buckets = new Map<string, Record<string, unknown>>();
  const bucket = (name: string) =>
    buckets.get(name) ?? {
      id: name,
      name,
      public: name.startsWith("el-public-"),
      file_size_limit: MAX_PDF_BYTES,
      allowed_mime_types: ["application/pdf", "image/png"],
    };

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

      if (url.origin === STORAGE_ORIGIN) {
        if (storageDown === "unreachable") throw new TypeError("fetch failed");
        if (storageDown === "failing") {
          return jsonResponse({ message: "Service Unavailable" }, 503);
        }
        const name = decodeURIComponent(
          url.pathname.replace("/storage/v1/bucket/", ""),
        );
        if (method === "PUT") buckets.set(name, body);
        return jsonResponse(bucket(name));
      }
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

      if (url.origin === "https://verifier.example.test" && method === "POST") {
        const routeStatus: Record<string, string> = {
          "/v1/library-runtime/activation": "active",
          "/v1/library-runtime/finalization": "finalized",
          "/v1/library-runtime/maintenance": "maintenance",
          "/v1/library-runtime/protection": "protected",
        };
        if (routeStatus[url.pathname]) {
          runtimeRouteMarker =
            url.pathname === "/v1/library-runtime/finalization"
              ? null
              : `${(body as { commit: string }).commit}:${(body as { revision: string }).revision}`;
          return jsonResponse({ status: routeStatus[url.pathname] });
        }
        if (url.pathname !== "/v1/library-runtime/readiness") {
          return jsonResponse({ message: "Unexpected verifier request" }, 404);
        }
        if (readinessUnavailable) {
          return jsonResponse({ message: "Runtime is still starting" }, 503);
        }
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
        url.origin === new URL(canonical ?? publicDomain).origin &&
        url.pathname === "/api/openscholar/configuration"
      ) {
        if (method === "PUT" && configurationBusy) {
          return jsonResponse({ message: "Configuration is locked" }, 409);
        }
        if (method === "PUT" && rolledBackAt !== null) {
          const next = body as { revision: string; updatedAt?: string };
          if (
            next.revision !== activeRevision &&
            !(Date.parse(next.updatedAt ?? "") > rolledBackAt)
          ) {
            return jsonResponse(
              { error: { code: "REVISION_NOT_NEWER" } },
              400,
            );
          }
        }
        // The runtime's clock runs half a minute ahead of the platform's.
        if (method === "DELETE") rolledBackAt = Date.now() + 30_000;
        if (method === "PUT" && configurationRejected) {
          return jsonResponse({ message: "Configuration refused" }, 400);
        }
        if (method === "PUT") {
          activeRevision = (body as { revision: string }).revision;
          const baseUrl = (body as { identity?: { baseUrl?: string } })
            .identity?.baseUrl;
          previousCanonical = canonical;
          if (baseUrl) {
            canonical =
              new URL(baseUrl).origin === new URL(publicDomain).origin
                ? null
                : baseUrl;
          }
          return jsonResponse({
            revision: activeRevision,
            sourceSha256: createHash("sha256")
              .update(String(init?.body))
              .digest("hex"),
            status: "active",
          });
        }
        if (method === "DELETE") {
          activeRevision = (body as { revision: string }).revision;
          canonical = previousCanonical;
          return jsonResponse({ revision: activeRevision, status: "active" });
        }
      }
      // The runtime answers its configuration only on the address it calls
      // its own and redirects every other.
      if (url.pathname === "/api/openscholar/configuration") {
        return new Response(null, {
          status: 307,
          headers: {
            location: new URL(url.pathname, canonical ?? publicDomain).href,
          },
        });
      }
      // The health check answers on every host the library is served on,
      // never redirected, so a new address can be read before it is used.
      if (
        (url.origin === new URL(canonical ?? publicDomain).origin ||
          (input.servedAddresses ?? []).some(
            (address) => new URL(address).origin === url.origin,
          )) &&
        method === "GET" &&
        url.pathname === "/api/library-config/health"
      ) {
        publicHealthMarkers.push(runtimeRouteMarker);
        return jsonResponse(
          {
            state: "active",
            rejected: null,
            active: {
              revision: activeRevision,
              ...(rolledBackAt === null
                ? {}
                : { updatedAt: new Date(rolledBackAt).toISOString() }),
            },
          },
          200,
          runtimeRouteMarker
            ? { "X-OpenScholar-Route": runtimeRouteMarker }
            : undefined,
        );
      }
      if (
        url.origin === new URL(canonical ?? publicDomain).origin &&
        method === "HEAD" &&
        url.pathname === "/lib"
      ) {
        return new Response("ready", { status: 200 });
      }
      if (
        canonical &&
        url.origin === new URL(publicDomain).origin &&
        method === "GET" &&
        url.pathname === "/lib"
      ) {
        return new Response(null, {
          status: 307,
          headers: {
            location: new URL("/lib", canonical).href,
          },
        });
      }
      // A live library sends a signed-out visitor of its admin area to
      // OpenScholar, and readiness checks exactly that.
      if (
        url.origin === new URL(canonical ?? publicDomain).origin &&
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
    buckets,
    setStorageDown(down: typeof storageDown) {
      storageDown = down;
    },
    environments,
    publicHealthMarkers,
    get commit() {
      return commit;
    },
    get publicDomain() {
      return publicDomain;
    },
    get activeRevision() {
      return activeRevision;
    },
    finishDeployment() {
      deploymentStatus = "finished";
      deployedConfigHash = FINISHED_CONFIG_HASH;
      configHash = FINISHED_CONFIG_HASH;
    },
    finishDeploymentWithoutHash() {
      deploymentStatus = "finished";
      deployedConfigHash = null;
      configHash = FINISHED_CONFIG_HASH;
    },
    failReadiness() {
      readinessUnavailable = true;
    },
    rejectConfiguration() {
      configurationRejected = true;
    },
    holdConfiguration() {
      configurationBusy = true;
    },
    restoreReadiness() {
      readinessUnavailable = false;
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

async function activateChangedConfiguration(
  suffix: string,
  options: {
    canonicalBaseUrl?: string;
    // What the last update check found about OpenScholar's contract.
    contractSupport?: { running: boolean; latest: boolean };
    topicsEnabled?: boolean;
  } = {},
) {
  const fixture = await createReadyLibrary(suffix);
  if (options.contractSupport) {
    const contractSupport = {
      commit: EVIDENCE_LIBRARY_CONFIG_PROVENANCE.commit,
      ...options.contractSupport,
    };
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: NEWER_COMMIT,
        latestImage: NEWER_RUNTIME_IMAGE,
        changes: [{ sha: NEWER_COMMIT, message: "feat: home page" }],
        releases: [],
        checkedAt: Date.now(),
        contractSupport,
      });
    });
  }
  if (options.canonicalBaseUrl) {
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.runtimeBindingId, {
        canonicalBaseUrl: options.canonicalBaseUrl,
      });
    });
  }
  const sections = {
    ...essentialSetupSections,
    ...(options.topicsEnabled ? { topics: { enabled: true } } : {}),
    identity: {
      ...essentialSetupSections.identity,
      name: `Changed ${suffix}`,
      ...(options.canonicalBaseUrl
        ? { baseUrl: options.canonicalBaseUrl }
        : {}),
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

/**
 * A live library and a working custom domain, with a switch of its main
 * address onto that domain, or back off it, already queued.
 */
async function switchCustomDomain(
  suffix: string,
  domainState: "active" | "failed",
  direction: "on" | "off",
  { served = true }: { served?: boolean } = {},
) {
  const customAddress = "https://evidence.example.org";
  const fixture = await createReadyLibrary(suffix);
  const domainId = await fixture.t.run(async (ctx) => {
    if (direction === "off") {
      await ctx.db.patch(fixture.created.runtimeBindingId, {
        canonicalBaseUrl: customAddress,
      });
    }
    const now = Date.now();
    return await ctx.db.insert("evidenceLibraryDomains", {
      generation: 0,
      libraryId: fixture.created.libraryId,
      host: new URL(customAddress).hostname,
      isApex: false,
      verificationHost: "example.org",
      verificationToken: "0".repeat(32),
      role: direction === "off" ? "primary" : "redirect",
      state: domainState,
      ...(domainState === "failed" ? { failure: "no-name" as const } : {}),
      attachedAt: now,
      createdByClerkUserId: "user_owner",
      createdAt: now,
      updatedAt: now,
    });
  });
  const network = createRuntimeNetwork({
    libraryId: fixture.created.libraryId,
    publicAddress: fixture.created.publicAddress,
    ...(direction === "off" ? { canonicalAddress: customAddress } : {}),
    ...(direction === "on" && served ? { servedAddresses: [customAddress] } : {}),
    // The running site reports the revision it is live on.
    revisionKey: await fixture.t.run(async (ctx) => {
      const library = await ctx.db.get(fixture.created.libraryId);
      const revision = library?.activeRevisionId
        ? await ctx.db.get(library.activeRevisionId)
        : null;
      return revision?.revisionKey ?? "";
    }),
  });
  stubFetch(network.fetchImpl);
  const off = await fixture.admin.mutation(
    api.evidenceLibraries.versions.setDomainPrimary,
    {
      libraryId: fixture.created.libraryId,
      domainId,
      primary: direction === "on",
    },
  );
  const run = async () => {
    const operation = await fixture.t.run((ctx) => ctx.db.get(off.operationId));
    if (!operation?.configurationAttemptToken) {
      throw new Error("The address change did not start an attempt");
    }
    return await fixture.t.action(
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId: off.operationId,
        attemptToken: operation.configurationAttemptToken,
        attemptCount: operation.attemptCount,
      },
    );
  };
  return { customAddress, domainId, fixture, network, off, run };
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
        openAlexApiKey: { present: false },
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
    assert(unchanged, "Expected an accessible draft");
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
    assert(changed, "Expected an accessible draft");
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
    stubFetch(async () => {
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
    stubFetch(network.fetchImpl);

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

    const runtimeConfigWrite = network.requests.find(
      ({ method, url }) =>
        method === "PUT" && url.pathname === "/api/openscholar/configuration",
    );
    expect(runtimeConfigWrite?.body).toMatchObject({
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
    assert(draft, "Expected an accessible draft");
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

  it("activates a configuration without rebuilding or changing traffic", async () => {
    const deployment = await activateChangedConfiguration("action-success");
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    stubFetch(network.fetchImpl);
    const actionArgs = {
      libraryId: deployment.fixture.created.libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };

    const result = await deployment.fixture.t.action(
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      actionArgs,
    );
    expect(result).toEqual({ status: "succeeded" });
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
      receipt: {
        revisionKey: deployment.activated.revisionKey,
        runtimeCommit: RUNTIME_COMMIT,
        runtimeImage: TEST_RUNTIME_IMAGE,
      },
    });
    expect(completed.operation?.receipt).not.toHaveProperty("runtimeReceiptId");
    expect(completed.operation?.receipt).not.toHaveProperty(
      "coolifyConfigHash",
    );
    expect(completed.operation).not.toHaveProperty("configurationAttemptToken");
    expect(
      network.requests.filter(
        ({ method, url }) =>
          method === "PATCH" && url.pathname.endsWith("/envs"),
      ),
    ).toHaveLength(0);
    expect(
      network.requests.filter(
        ({ method, url }) =>
          method === "POST" && url.pathname === "/api/v1/deploy",
      ),
    ).toHaveLength(0);
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
    const configurationWrites = network.requests.filter(
      ({ method, url }) =>
        method === "PUT" && url.pathname === "/api/openscholar/configuration",
    );
    expect(configurationWrites).toHaveLength(1);
    expect(configurationWrites[0]?.body).toMatchObject({
      revision: deployment.activated.revisionKey,
      services: { search: { key: expect.any(String) } },
    });
    const paths = network.requests.map(({ url }) => url.pathname);
    expect(paths).not.toContain("/v1/library-runtime/protection");
    expect(paths).not.toContain("/v1/library-runtime/activation");
    expect(paths).not.toContain("/v1/library-runtime/finalization");
    expect(network.publicHealthMarkers.at(-1)).toBeNull();
    expect(
      network.environments.find(({ key }) => key === "LIBRARY_CONFIG_JSON")!
        .value,
    ).toBe(JSON.stringify({ revision: "old" }));
    await expect(
      deployment.fixture.admin.action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: deployment.fixture.created.libraryId },
      ),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("writes a configuration through the canonical custom address", async () => {
    const canonicalAddress = "https://evidence.example.org";
    const deployment = await activateChangedConfiguration("custom-domain", {
      canonicalBaseUrl: canonicalAddress,
    });
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      canonicalAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    stubFetch(network.fetchImpl);

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: deployment.fixture.created.libraryId,
          operationId: deployment.activated.operationId,
          attemptToken: deployment.attemptToken,
          attemptCount: deployment.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "succeeded" });
    expect(
      network.requests.find(
        ({ method, url }) =>
          method === "PUT" && url.pathname === "/api/openscholar/configuration",
      )?.url.origin,
    ).toBe(canonicalAddress);
  });

  it("switches a library onto a working custom domain without a deployment", async () => {
    const { customAddress, fixture, network, run } = await switchCustomDomain(
      "canonical-on",
      "active",
      "on",
    );

    await expect(run()).resolves.toEqual({ status: "succeeded" });

    // Nothing was redeployed: the change reached the running site directly,
    // on the platform address it answered to until then.
    expect(
      network.requests.some(({ url }) => url.pathname === "/api/v1/deploy"),
    ).toBe(false);
    expect(
      network.requests.find(
        ({ method, url }) =>
          method === "PUT" && url.pathname === "/api/openscholar/configuration",
      )?.url.origin,
    ).toBe(fixture.created.publicAddress);
    const listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    expect(listed.canonicalAddress).toBe(customAddress);
    expect(listed.domains[0]).toMatchObject({
      role: "primary",
      deploymentPending: false,
    });
    // Sign-in answers on exactly the addresses the library now serves.
    const [application] = [...clerk.applications.values()].filter(
      ({ name }) => name === `evidence-library-${fixture.created.libraryId}`,
    );
    expect(application.redirect_uris).toEqual(
      [customAddress, fixture.created.publicAddress]
        .map((origin) => `${origin}/api/auth/callback/openscholar`)
        .sort(),
    );
  });

  it("finishes an address switch that landed before a check failed", async () => {
    const { customAddress, fixture, network, run } = await switchCustomDomain(
      "canonical-on-retry",
      "active",
      "on",
    );
    network.failReadiness();
    await expect(run()).resolves.toEqual({ pollCount: 1, status: "running" });
    network.restoreReadiness();

    // The site already answers on the new address, so the retry reaches it
    // there instead of failing on the old one.
    await expect(run()).resolves.toEqual({ status: "succeeded" });
    const writes = network.requests.filter(
      ({ method, url }) =>
        method === "PUT" && url.pathname === "/api/openscholar/configuration",
    );
    expect(writes.at(-1)?.url.origin).toBe(customAddress);
    const listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    expect(listed.canonicalAddress).toBe(customAddress);
  });

  it("does not switch onto a domain that does not answer as this library", async () => {
    // Its certificate may have expired while it still counts as working.
    // Taking it would send every visitor there with no way back.
    const { fixture, network, run } = await switchCustomDomain(
      "canonical-on-unserved",
      "active",
      "on",
      { served: false },
    );
    await expect(run()).resolves.toEqual({ status: "failed" });
    expect(
      network.requests.some(
        ({ method, url }) =>
          method === "PUT" && url.pathname === "/api/openscholar/configuration",
      ),
    ).toBe(false);
    const listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    expect(listed.canonicalAddress).toBe(fixture.created.publicAddress);
  });

  it("waits out a busy runtime rather than trying the other address", async () => {
    const { network, run } = await switchCustomDomain(
      "canonical-on-busy",
      "active",
      "on",
    );
    network.holdConfiguration();
    await expect(run()).resolves.toEqual({ pollCount: 1, status: "running" });
    expect(
      network.requests.filter(
        ({ method, url }) =>
          method === "PUT" && url.pathname === "/api/openscholar/configuration",
      ),
    ).toHaveLength(1);
  });

  it.each(["active", "failed"] as const)(
    "switches a library off a %s custom domain through a deployment",
    async (domainState) => {
      // A custom domain can have lost its records or its certificate while
      // still counting as working, so the site may not be reachable on it:
      // a deployment carries the change instead.
      const { fixture, off } = await switchCustomDomain(
        `canonical-off-${domainState}`,
        domainState,
        "off",
      );
      const operation = await fixture.t.run((ctx) =>
        ctx.db.get(off.operationId),
      );
      expect(operation?.domainChange).toMatchObject({
        reason: "canonical",
        redeploy: true,
      });
      expect(configurationOperationRequiresDeployment(operation!)).toBe(true);
    },
  );

  it("leaves a failed direct activation out from behind the guard", async () => {
    const deployment = await activateChangedConfiguration("direct-refused");
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    stubFetch(network.fetchImpl);
    network.rejectConfiguration();

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId: deployment.fixture.created.libraryId,
          operationId: deployment.activated.operationId,
          attemptToken: deployment.attemptToken,
          attemptCount: deployment.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "failed" });
    expect(
      network.requests.some(
        ({ url }) => url.pathname === "/v1/library-runtime/protection",
      ),
    ).toBe(false);
  });

  it("retries a failed current deployment by reusing its saved target", async () => {
    const deployment = await activateChangedConfiguration("retry-saved-target");
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    stubFetch(network.fetchImpl);
    const actionArgs = {
      libraryId: deployment.fixture.created.libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };
    network.failReadiness();

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });
    await failSavedConfigurationDeployment(deployment);
    network.restoreReadiness();
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
    stubFetch(network.fetchImpl);
    const firstActionArgs = {
      libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };
    network.failReadiness();

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        firstActionArgs,
      ),
    ).resolves.toEqual({ pollCount: 1, status: "running" });
    await failSavedConfigurationDeployment(deployment);
    network.restoreReadiness();

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
    stubFetch(network.fetchImpl);
    const actionArgs = {
      libraryId: deployment.fixture.created.libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };
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
    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).resolves.toEqual({ pollCount: 2, status: "running" });
    await expect(
      deployment.fixture.t.run((ctx) =>
        ctx.db.get(deployment.activated.operationId),
      ),
    ).resolves.toMatchObject({ configurationReadinessPollCount: 2 });
    network.restoreReadiness();
    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).resolves.toEqual({ status: "succeeded" });
  });

  it("restores the previous runtime configuration when readiness retries are exhausted", async () => {
    const deployment = await activateChangedConfiguration("rollback-exhausted");
    const network = createRuntimeNetwork({
      libraryId: deployment.fixture.created.libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    network.failReadiness();
    stubFetch(network.fetchImpl);
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
    await deployment.fixture.t.run((ctx) =>
      ctx.db.patch(deployment.activated.operationId, {
        configurationReadinessPollCount: 24,
      }),
    );

    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).resolves.toEqual({ status: "failed" });
    expect(network.activeRevision).toBe(
      deployment.fixture.activated.revisionKey,
    );
    expect(
      network.requests.filter(
        ({ method, url }) =>
          method === "DELETE" &&
          url.pathname === "/api/openscholar/configuration",
      ),
    ).toHaveLength(1);
    await expect(
      deployment.fixture.t.run((ctx) =>
        ctx.db.get(deployment.activated.operationId),
      ),
    ).resolves.toMatchObject({ status: "failed" });
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
    stubFetch(network.fetchImpl);
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
    // The new software stores JPEG covers, so the buckets must take them.
    expect(
      [...network.buckets.values()].map(
        ({ allowed_mime_types }) => allowed_mime_types,
      ),
    ).toEqual([
      ["application/pdf", "image/jpeg", "image/png"],
      ["application/pdf", "image/jpeg", "image/png"],
    ]);
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

  it.each(["unreachable", "failing"] as const)("waits out %s storage before a software update touches the site", async (outage) => {
    const fixture = await createReadyLibrary(`storage-${outage}`);
    const activeRevision = await fixture.t.run(async (ctx) => {
      const library = await ctx.db.get(fixture.created.libraryId);
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNTIME_COMMIT,
        latest: NEWER_COMMIT,
        latestImage: NEWER_RUNTIME_IMAGE,
        changes: [{ sha: NEWER_COMMIT, message: "feat: JPEG covers" }],
        checkedAt: Date.now(),
      });
      return await ctx.db.get(library!.activeRevisionId!);
    });
    const started = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(started.operationId),
    );
    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: activeRevision!.revisionKey,
    });
    stubFetch(network.fetchImpl);
    const actionArgs = {
      libraryId: fixture.created.libraryId,
      operationId: started.operationId,
      attemptToken: operation!.configurationAttemptToken!,
      attemptCount: operation!.attemptCount,
    };

    network.setStorageDown(outage);
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ pollCount: 1, status: "running" });
    expect(network.commit).toBe(RUNTIME_COMMIT);

    network.setStorageDown(null);
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toMatchObject({ status: "running" });
    expect(network.commit).toBe(NEWER_COMMIT);
    expect(network.buckets.size).toBe(2);
  });

  it("publishes changes the running software cannot read on the latest release, in the same step", async () => {
    const { activated, fixture, attemptToken, attemptCount } =
      await activateChangedConfiguration("publish-with-update", {
        contractSupport: { running: false, latest: true },
      });
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(activated.operationId),
    );
    expect(operation).toMatchObject({
      kind: "publish",
      revisionId: activated.revisionId,
      activationEditVersion: expect.any(Number),
      runtimeUpdate: {
        from: RUNTIME_COMMIT,
        to: NEWER_COMMIT,
        fromImage: TEST_RUNTIME_IMAGE,
        toImage: NEWER_RUNTIME_IMAGE,
      },
    });

    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: activated.revisionKey,
    });
    stubFetch(network.fetchImpl);
    const actionArgs = {
      libraryId: fixture.created.libraryId,
      operationId: activated.operationId,
      attemptToken,
      attemptCount,
    };
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        actionArgs,
      ),
    ).toEqual({ pollCount: 1, status: "running" });
    expect(network.commit).toBe(NEWER_COMMIT);
    expect(
      JSON.parse(
        network.environments.find(({ key }) => key === "LIBRARY_CONFIG_JSON")!
          .value,
      ),
    ).toMatchObject({ revision: activated.revisionKey });

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
    }));
    expect(completed.binding).toMatchObject({
      runtimeCommit: NEWER_COMMIT,
      previousRuntime: { commit: RUNTIME_COMMIT },
    });
    expect(completed.library).toMatchObject({
      activeRevisionId: activated.revisionId,
    });
    // The earlier software could not read these settings, so it is not put back under them.
    await expect(
      fixture.t.mutation(internal.evidenceLibraries.versions.startRuntimeRollback, {
        libraryId: fixture.created.libraryId,
      }),
    ).rejects.toThrow(/live settings need the current software/);

    // Once the settings from before that publish are restored, the earlier
    // software can take them again.
    await fixture.t.run(async (ctx) => {
      const published = (await ctx.db.get(activated.revisionId))!;
      const original = await ctx.db
        .query("evidenceLibraryConfigRevisions")
        .withIndex("by_libraryId_and_revisionNumber", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .first();
      const { _id, _creationTime, ...fields } = published;
      const restore = await ctx.db.insert("evidenceLibraryConfigRevisions", {
        ...fields,
        revisionKey: `r${published.revisionNumber + 1}`,
        revisionNumber: published.revisionNumber + 1,
        rollbackOfRevisionId: original!._id,
      });
      await ctx.db.patch(fixture.created.libraryId, { activeRevisionId: restore });
    });
    await expect(
      fixture.t.mutation(internal.evidenceLibraries.versions.startRuntimeRollback, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toMatchObject({ from: NEWER_COMMIT, to: RUNTIME_COMMIT });
  });

  it("publishes on the running software when it already reads the contract", async () => {
    const { activated, fixture } = await activateChangedConfiguration(
      "publish-current-software",
      { contractSupport: { running: true, latest: true } },
    );
    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(activated.operationId),
    );
    expect(operation).not.toHaveProperty("runtimeUpdate");
  });

  it("refuses to publish while no release reads the contract yet", async () => {
    await expect(
      activateChangedConfiguration("publish-unreleased-software", {
        contractSupport: { running: false, latest: false },
      }),
    ).rejects.toThrow(/still being released/);
  });

  it("refuses to enable Topics until the running software advertises the contract", async () => {
    await expect(
      activateChangedConfiguration("topics-without-runtime-support", {
        topicsEnabled: true,
      }),
    ).rejects.toThrow(/Topics need a newer Evidence Library software version/);
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
    stubFetch(network.fetchImpl);
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
    stubFetch(network.fetchImpl);

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
    stubFetch(network.fetchImpl);

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
    stubFetch(network.fetchImpl);

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
    const protectionIndex = network.requests.findIndex(
      ({ url }) => url.pathname === "/v1/library-runtime/protection",
    );
    const domainChangeIndex = network.requests.findIndex(
      ({ method, url }) =>
        method === "PATCH" &&
        url.pathname === `/api/v1/applications/${APPLICATION_UUID}`,
    );
    expect(protectionIndex).toBeGreaterThanOrEqual(0);
    expect(protectionIndex).toBeLessThan(domainChangeIndex);

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
      editVersion: fixture.activated.editVersion + 1,
    });
    expect(state.operation).toMatchObject({
      status: "succeeded",
      addressMove: { to: movedTo, applied: true },
    });
  });

  it("waits out a Coolify outage instead of failing the publish", async () => {
    const fixture = await createReadyLibrary("coolify-outage");
    const network = createRuntimeNetwork({
      libraryId: fixture.created.libraryId,
      publicAddress: fixture.created.publicAddress,
      revisionKey: fixture.activated.revisionKey,
    });
    let coolifyDown = false;
    const flaky: typeof fetch = async (requestInput, init) => {
      const url = new URL(String(requestInput));
      if (coolifyDown && url.pathname.startsWith("/api/v1/")) {
        return jsonResponse({ message: "Bad gateway" }, 502);
      }
      return await network.fetchImpl(requestInput, init);
    };
    stubFetch(flaky);

    await fixture.admin.action(
      api.evidenceLibraries.addressActions.moveLibraryAddress,
      { libraryId: fixture.created.libraryId },
    );
    const operation = await readMoveOperation(fixture);
    const revision = await fixture.t.run((ctx) =>
      ctx.db.get(operation.revisionId!),
    );
    if (!revision) throw new Error("The moved revision is missing");
    network.setActiveRevision(revision.revisionKey);
    const args = {
      libraryId: fixture.created.libraryId,
      operationId: operation._id,
      attemptToken: operation.configurationAttemptToken!,
      attemptCount: operation.attemptCount,
    };
    const run = () =>
      fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        args,
      );

    await expect(run()).resolves.toMatchObject({ status: "running" });
    network.finishDeployment();
    coolifyDown = true;
    await expect(run()).resolves.toMatchObject({ status: "running" });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(operation._id)),
    ).resolves.toMatchObject({ status: "running" });

    coolifyDown = false;
    await expect(run()).resolves.toEqual({ status: "succeeded" });
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
    stubFetch(failing);

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
    assert(projected, "Expected an accessible draft");
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
    assert(projected, "Expected an accessible draft");
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
    assert(before, "Expected an accessible draft");
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
    assert(after, "Expected an accessible draft");
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
    assert(before, "Expected an accessible draft");
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
    assert(after, "Expected an accessible draft");
    expect(after.operation).toMatchObject({ retryable: false });
    await expect(
      deployment.fixture.admin.mutation(
        api.evidenceLibraries.configurationDeployment
          .retryConfigurationDeployment,
        { libraryId, operationId: deployment.activated.operationId },
      ),
    ).rejects.toThrow(/cannot be retried/i);
  });

  it("retries an activation that was rolled back with a newer copy", async () => {
    const deployment = await activateChangedConfiguration("retry-rolled-back");
    const { libraryId } = deployment.fixture.created;
    const operationId = deployment.activated.operationId;
    const network = createRuntimeNetwork({
      libraryId,
      publicAddress: deployment.fixture.created.publicAddress,
      revisionKey: deployment.activated.revisionKey,
    });
    stubFetch(network.fetchImpl);
    // The configuration lands, readiness never answers, and the last allowed
    // check puts the previous configuration back.
    network.failReadiness();
    let result: { status: string } = { status: "running" };
    for (let poll = 0; poll < 30 && result.status === "running"; poll += 1) {
      const current = await deployment.fixture.t.run((ctx) =>
        ctx.db.get(operationId),
      );
      result = await deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId,
          operationId,
          attemptToken: current!.configurationAttemptToken!,
          attemptCount: current!.attemptCount,
        },
      );
    }
    expect(result).toEqual({ status: "failed" });
    expect(
      network.requests.some(
        ({ method, url }) =>
          method === "DELETE" && url.pathname === "/api/openscholar/configuration",
      ),
    ).toBe(true);

    // Retried a second later, which the runtime's clock still calls earlier.
    vi.setSystemTime(Date.now() + 1_000);
    network.restoreReadiness();
    await deployment.fixture.admin.mutation(
      api.evidenceLibraries.configurationDeployment
        .retryConfigurationDeployment,
      { libraryId, operationId },
    );
    const claimed = await deployment.fixture.t.run((ctx) =>
      ctx.db.get(operationId),
    );
    if (!claimed?.configurationAttemptToken) {
      throw new Error("The retry did not claim the deployment");
    }
    await expect(
      deployment.fixture.t.action(
        internal.evidenceLibraries.configurationDeploymentActions
          .runConfigurationDeployment,
        {
          libraryId,
          operationId,
          attemptToken: claimed.configurationAttemptToken,
          attemptCount: claimed.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "succeeded" });
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
    stubFetch(network.fetchImpl);

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
    stubFetch(network.fetchImpl);
    const actionArgs = {
      libraryId,
      operationId: deployment.activated.operationId,
      attemptToken: deployment.attemptToken,
      attemptCount: deployment.attemptCount,
    };
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
    stubFetch((async (
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
