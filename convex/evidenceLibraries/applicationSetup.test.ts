/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  createActivatedSetupFixture,
  TEST_RUNTIME_IMAGE,
} from "../../tests/helpers/evidence-library-setup-fixture";

const LATEST_RUNTIME_COMMIT = "b".repeat(40);
const LATEST_RUNTIME_DIGEST = `sha256:${"c".repeat(64)}`;
const LATEST_RUNTIME_IMAGE = `ghcr.io/opendeved/evidence-library-runtime@${LATEST_RUNTIME_DIGEST}`;

async function createApplicationStageFixture(suffix: string) {
  const fixture = await createActivatedSetupFixture(suffix);
  await fixture.t.mutation(
    internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      encryptedDatabaseUrl: "encrypted-database-url",
      outcome: "created",
      databaseName: "el_application",
      loginName: "el_application_user",
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
      privateBucket: "el-private-application",
      publicBucket: "el-public-application",
    },
  );
  return fixture;
}

function stubApplicationActionEnvironment() {
  vi.stubEnv("ENCRYPTION_KEY", "11".repeat(32));
  vi.stubEnv("GITHUB_TOKEN", "github-token");
  vi.stubEnv("EL_OPENSCHOLAR_URL", "https://openscholar.example.test");
  vi.stubEnv("EL_CONVEX_SITE_URL", "https://convex.example.test");
  vi.stubEnv("EL_STORAGE_URL", "https://storage.example.test");
  vi.stubEnv("EL_STORAGE_MAX_PDF_BYTES", "52428800");
  vi.stubEnv("EL_COOLIFY_URL", "https://coolify.example.test");
  vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
  vi.stubEnv("EL_COOLIFY_SERVER_UUID", "server-1");
  vi.stubEnv("EL_COOLIFY_PROJECT_UUID", "project-1");
  vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  vi.stubEnv("EL_COOLIFY_GITHUB_APP_UUID", "github-app-1");
}

describe("Evidence Library application setup", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps the same managed credentials when application setup retries", async () => {
    const fixture = await createApplicationStageFixture("application-secrets");

    const first = await fixture.t.mutation(
      internal.evidenceLibraries.applicationSetup.prepareApplicationSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        candidateEncryptedSearchKey: "encrypted-search-1",
        candidateEncryptedAuthenticationSecret: "encrypted-auth-1",
        candidateEncryptedMachineCredential: "encrypted-machine-1",
        candidateMachineCredentialDigest: "digest-1",
        candidateMachineCredentialHint: "els_one...",
        candidateRuntimeCommit: "a".repeat(40),
        candidateRuntimeImage: TEST_RUNTIME_IMAGE,
      },
    );
    const repeated = await fixture.t.mutation(
      internal.evidenceLibraries.applicationSetup.prepareApplicationSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        candidateEncryptedSearchKey: "encrypted-search-2",
        candidateEncryptedAuthenticationSecret: "encrypted-auth-2",
        candidateEncryptedMachineCredential: "encrypted-machine-2",
        candidateMachineCredentialDigest: "digest-2",
        candidateMachineCredentialHint: "els_two...",
        candidateRuntimeCommit: "b".repeat(40),
        candidateRuntimeImage: `ghcr.io/opendeved/evidence-library-runtime@sha256:${"f".repeat(64)}`,
      },
    );

    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      encryptedSearchKey: "encrypted-search-1",
      encryptedAuthenticationSecret: "encrypted-auth-1",
      encryptedMachineCredential: "encrypted-machine-1",
      encryptedDatabaseUrl: "encrypted-database-url",
      encryptedStorageServiceRoleKey: "encrypted-storage-key",
      storagePrivateBucket: "el-private-application",
      storagePublicBucket: "el-public-application",
      runtimeCommit: "a".repeat(40),
      runtimeImage: TEST_RUNTIME_IMAGE,
      revisionKey: fixture.activated.revisionKey,
      targetBaseUrl: fixture.created.publicAddress,
      sections: expect.arrayContaining([
        {
          sectionKey: "identity",
          payload: expect.objectContaining({ name: "Climate Evidence" }),
        },
      ]),
    });
    const saved = await fixture.t.run((ctx) =>
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .collect(),
    );
    expect(saved.map((credential) => credential.credentialKey).sort()).toEqual([
      "/authentication/secret",
      "/services/database/url",
      "/services/search/key",
      "/services/storage/serviceRoleKey",
      "library-service",
    ]);
    expect(
      saved.find(
        (credential) => credential.credentialKey === "library-service",
      ),
    ).toMatchObject({
      credentialDigest: "digest-1",
      maskedHint: "els_one...",
      validationState: "valid",
    });
    expect(
      JSON.stringify(
        await fixture.admin.query(
          api.evidenceLibraries.credentials.listCredentialMetadata,
          { libraryId: fixture.created.libraryId },
        ),
      ),
    ).not.toContain("encrypted-");

    const completed = await fixture.t.mutation(
      internal.evidenceLibraries.applicationSetup.completeApplicationSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        outcome: "created",
        applicationId: "coolify-application-1",
        runtimeCommit: first.runtimeCommit,
        runtimeImage: first.runtimeImage,
        runtimeConfigSha256: "c".repeat(64),
        coolifyConfigHash: "d".repeat(64),
        searchHost: "http://meilisearch:7700",
        searchIndex: "evidence_library",
        storageUrl: "https://storage.example.test",
        storagePrivateBucket: first.storagePrivateBucket,
        storagePublicBucket: first.storagePublicBucket,
        storageMaxPdfBytes: 52_428_800,
        databaseCredentialId: first.databaseCredentialId,
        searchCredentialId: first.searchCredentialId,
        storageCredentialId: first.storageCredentialId,
        aiProviderKey: { present: false } as const,
      },
    );
    expect(completed).toMatchObject({
      nextStep: "deployment",
      status: "running",
    });
    const runtime = await fixture.t.run(async (ctx) => ({
      binding: await ctx.db.get(fixture.created.runtimeBindingId),
      operation: await ctx.db.get(fixture.created.setupOperationId),
      scheduledFunctions: await ctx.db.system
        .query("_scheduled_functions")
        .collect(),
    }));
    expect(runtime.binding).toMatchObject({
      state: "pending",
      targetRuntimeId: "coolify-application-1",
      runtimeCommit: first.runtimeCommit,
      searchHost: "http://meilisearch:7700",
      searchIndex: "evidence_library",
      storagePrivateBucket: first.storagePrivateBucket,
      storagePublicBucket: first.storagePublicBucket,
      storageMaxPdfBytes: 52_428_800,
      databaseCredentialId: first.databaseCredentialId,
      searchCredentialId: first.searchCredentialId,
      storageCredentialId: first.storageCredentialId,
    });
    expect(runtime.operation).toMatchObject({
      stage: "deployment",
      setupRuntimeCommit: first.runtimeCommit,
      setupReceipts: {
        application: {
          applicationId: "coolify-application-1",
          runtimeCommit: first.runtimeCommit,
          runtimeConfigSha256: "c".repeat(64),
          coolifyConfigHash: "d".repeat(64),
        },
      },
    });
    expect(
      runtime.scheduledFunctions.filter((scheduled) =>
        scheduled.name.includes("runDeploymentSetup"),
      ),
    ).toHaveLength(1);
  });

  it("selects the same latest published runtime used by updates", async () => {
    const fixture = await createApplicationStageFixture(
      "application-latest-runtime",
    );
    stubApplicationActionEnvironment();
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (request) => {
        const url = new URL(String(request));
        requests.push(url);
        if (
          url.href ===
          "https://api.github.com/repos/OpenDevEd/new-el/actions/workflows/runtime-image.yml/runs?branch=main&event=workflow_run&status=success&per_page=1"
        ) {
          return Response.json({
            workflow_runs: [
              {
                conclusion: "success",
                event: "workflow_run",
                head_sha: LATEST_RUNTIME_COMMIT,
              },
            ],
          });
        }
        if (
          url.href ===
          `https://ghcr.io/v2/opendeved/evidence-library-runtime/manifests/${LATEST_RUNTIME_COMMIT}`
        ) {
          return new Response(null, {
            status: 200,
            headers: { "docker-content-digest": LATEST_RUNTIME_DIGEST },
          });
        }
        return Response.json({ message: "unavailable" }, { status: 503 });
      }),
    );

    await expect(
      fixture.t.action(
        internal.evidenceLibraries.applicationSetupActions.runApplicationSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).resolves.toEqual({ status: "failed" });

    const operation = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );
    expect(operation).toMatchObject({
      setupRuntimeCommit: LATEST_RUNTIME_COMMIT,
      setupRuntimeImage: LATEST_RUNTIME_IMAGE,
    });
    expect(requests.slice(0, 2).map(String)).toEqual([
      "https://api.github.com/repos/OpenDevEd/new-el/actions/workflows/runtime-image.yml/runs?branch=main&event=workflow_run&status=success&per_page=1",
      `https://ghcr.io/v2/opendeved/evidence-library-runtime/manifests/${LATEST_RUNTIME_COMMIT}`,
    ]);
  });

  it("reuses the saved runtime pair without another release lookup", async () => {
    const fixture = await createApplicationStageFixture(
      "application-saved-runtime",
    );
    await fixture.t.mutation(
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
        candidateRuntimeCommit: LATEST_RUNTIME_COMMIT,
        candidateRuntimeImage: LATEST_RUNTIME_IMAGE,
      },
    );
    stubApplicationActionEnvironment();
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (request) => {
        requests.push(new URL(String(request)));
        return Response.json({ message: "unavailable" }, { status: 503 });
      }),
    );

    await fixture.t.action(
      internal.evidenceLibraries.applicationSetupActions.runApplicationSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
      },
    );

    expect(
      requests.some(({ hostname }) =>
        ["api.github.com", "ghcr.io"].includes(hostname),
      ),
    ).toBe(false);
  });
});
