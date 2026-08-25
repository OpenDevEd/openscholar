import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("/convex/**/*.ts");

export const essentialSetupSections = {
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

export async function createActivatedSetupFixture(suffix: string) {
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
    { name: essentialSetupSections.identity.name },
  );
  const saved = await admin.mutation(
    api.evidenceLibraries.mutations.saveEssentialConfiguration,
    {
      libraryId: created.libraryId,
      sections: essentialSetupSections,
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
  const operation = await t.run((ctx) => ctx.db.get(created.setupOperationId));
  if (!operation?.setupAttemptToken) {
    throw new Error("Activated setup did not start an attempt");
  }
  return {
    activated,
    admin,
    created,
    t,
    attemptToken: operation.setupAttemptToken,
    attemptCount: operation.attemptCount,
  };
}

export async function createDeployedSetupFixture(suffix: string) {
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
      databaseName: `el_${suffix}`,
      loginName: `el_${suffix}_user`,
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
      privateBucket: `el-private-${suffix}`,
      publicBucket: `el-public-${suffix}`,
    },
  );
  const prepared = await fixture.t.mutation(
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
      candidateRuntimeCommit: "a".repeat(40),
    },
  );
  await fixture.t.mutation(
    internal.evidenceLibraries.applicationSetup.completeApplicationSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      outcome: "created",
      applicationId: `coolify-${suffix}`,
      runtimeCommit: prepared.runtimeCommit,
      runtimeConfigSha256: "b".repeat(64),
      coolifyConfigHash: "c".repeat(64),
      searchHost: "http://meilisearch:7700",
      searchIndex: "evidence_library",
      storageUrl: "https://storage.example.test",
      storagePrivateBucket: prepared.storagePrivateBucket,
      storagePublicBucket: prepared.storagePublicBucket,
      storageMaxPdfBytes: 52_428_800,
      databaseCredentialId: prepared.databaseCredentialId,
      searchCredentialId: prepared.searchCredentialId,
      storageCredentialId: prepared.storageCredentialId,
    },
  );
  await fixture.t.mutation(
    internal.evidenceLibraries.deploymentSetup.saveDeploymentSetupId,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      deploymentId: `deployment-${suffix}`,
      outcome: "created",
    },
  );
  await fixture.t.mutation(
    internal.evidenceLibraries.deploymentSetup.completeDeploymentSetup,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken: fixture.attemptToken,
      attemptCount: fixture.attemptCount,
      deploymentId: `deployment-${suffix}`,
    },
  );
  return {
    ...fixture,
    prepared,
    applicationId: `coolify-${suffix}`,
    deploymentId: `deployment-${suffix}`,
  };
}
