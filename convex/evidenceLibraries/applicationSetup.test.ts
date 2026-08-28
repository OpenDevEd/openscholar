/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

describe("Evidence Library application setup", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  it("keeps the same managed credentials when application setup retries", async () => {
    const fixture = await createActivatedSetupFixture("application-secrets");
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
});
