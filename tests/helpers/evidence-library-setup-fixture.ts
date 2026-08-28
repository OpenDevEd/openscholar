import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("/convex/**/*.ts");

// Turns a { sectionKey: payload } record into the rows the save mutation takes.
export function toSectionRows<T extends Record<string, unknown>>(sections: T) {
  return Object.entries(sections).map(([sectionKey, payload]) => ({
    sectionKey: sectionKey as keyof T & string,
    payload,
  }));
}

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
  footer: { poweredBy: true },
};

type TestClient = Pick<ReturnType<typeof convexTest>, "mutation" | "query">;

// Reserves the first address our database has free for this name, the way
// the address action does without the Coolify and HTTP checks.
export async function reserveLibraryAddressByName(
  as: TestClient,
  name: string,
) {
  const state = await as.query(
    internal.evidenceLibraries.queries.readAddressCandidates,
    { name },
  );
  const candidate =
    state.status === "candidates" ? state.candidates[0] : undefined;
  if (!candidate) throw new Error(`No address is free for ${name}`);
  return await reserveLibraryAddress(as, { name, ...candidate });
}

// Reserves an address the way the address action does, without the Coolify
// and HTTP checks that only the action can run.
async function reserveLibraryAddress(
  as: TestClient,
  args: { name: string; publicAddress: string; slug: string },
) {
  const reserved = await as.mutation(
    internal.evidenceLibraries.mutations.reserveAddress,
    args,
  );
  if (reserved.status !== "reserved") {
    throw new Error(`Address ${args.publicAddress} was not reserved`);
  }
  return reserved;
}

// A library the Owner has named but not activated: its setup operation is
// queued and has never started.
export async function createDraftSetupFixture(suffix: string) {
  const t = convexTest(schema, modules);
  const clerkOrganizationId = `org_${suffix}`;
  const clerkUserId = `user_${suffix}`;
  const { membershipId, organizationId } = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId,
      name: `Team ${suffix}`,
      slug: `team-${suffix}`,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      evidenceLibrariesEnabled: true,
    });
    const membershipId = await ctx.db.insert("organizationMemberships", {
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
    return { membershipId, organizationId };
  });
  const admin = t.withIdentity({
    subject: clerkUserId,
    o: { id: clerkOrganizationId, rol: "org:admin" },
  });
  const created = await reserveLibraryAddress(admin, {
    name: essentialSetupSections.identity.name,
    publicAddress: essentialSetupSections.identity.baseUrl,
    slug: "climate-evidence",
  });
  return {
    admin,
    clerkOrganizationId,
    clerkUserId,
    created,
    membershipId,
    organizationId,
    t,
  };
}

export async function createActivatedSetupFixture(suffix: string) {
  const draft = await createDraftSetupFixture(suffix);
  const { admin, created, t } = draft;
  const saved = await admin.mutation(
    api.evidenceLibraries.mutations.saveDraftSections,
    {
      libraryId: created.libraryId,
      sections: toSectionRows(essentialSetupSections),
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
    ...draft,
    activated,
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
      aiProviderKey: { present: false } as const,
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
      coolifyConfigHash: "d".repeat(64),
    },
  );
  return {
    ...fixture,
    prepared,
    applicationId: `coolify-${suffix}`,
    deploymentId: `deployment-${suffix}`,
  };
}

export async function createReadySetupFixture(suffix: string) {
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
  return fixture;
}
