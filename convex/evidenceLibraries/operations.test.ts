/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  queueConfigurationDeploymentOperation,
  queueEvidenceLibraryOperation,
} from "./operations";
import { createEvidenceLibrarySetup } from "./mutations";
import { toSectionRows } from "../../tests/helpers/evidence-library-setup-fixture";

const modules = import.meta.glob("/convex/**/*.ts");

const essentialSections = {
  identity: {
    name: "Activation Library",
    shortName: "Activation",
    baseUrl: "https://activation-library.example.org",
    assets: {
      logoDark: "https://assets.example.org/logo.svg",
      favicon: "https://assets.example.org/favicon.ico",
    },
  },
  theme: { colors: { accent: "#005A9C", tertiary: "#F2A900" } },
  localization: { locales: ["en-GB", "fr"], defaultLocale: "en-GB" },
  footer: { poweredBy: true },
};

async function createOperationFixture(
  t: ReturnType<typeof convexTest>,
  suffix: string,
) {
  const clerkOrganizationId = `org_${suffix}`;
  const clerkUserId = `user_${suffix}`;
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId,
      name: `Operation Team ${suffix}`,
      slug: `operation-team-${suffix}`,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      evidenceLibrariesEnabled: true,
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
    const libraryId = await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: `Operation Library ${suffix}`,
      slug: `operation-library-${suffix}`,
      state: "active",
      createdByClerkUserId: clerkUserId,
      updatedByClerkUserId: clerkUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    const revisionIds = [];
    for (const revisionNumber of [1, 2]) {
      revisionIds.push(
        await ctx.db.insert("evidenceLibraryConfigRevisions", {
          libraryId,
          revisionKey: `r${revisionNumber}`,
          revisionNumber,
          basedOnRevisionId: null,
          rollbackOfRevisionId: null,
          contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
          createdByClerkUserId: clerkUserId,
          createdAt: revisionNumber,
        }),
      );
    }
    return { libraryId, revisionIds };
  });
  return {
    ...fixture,
    admin: t.withIdentity({
      subject: clerkUserId,
      o: { id: clerkOrganizationId, rol: "org:admin" },
    }),
  };
}

async function createActivationFixture(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  state: "provisioning" | "active",
) {
  const clerkOrganizationId = `org_${suffix}`;
  const clerkUserId = `user_${suffix}`;
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId,
      name: `Activation Team ${suffix}`,
      slug: `activation-team-${suffix}`,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      evidenceLibrariesEnabled: true,
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
  const created = await admin.run((ctx) =>
    createEvidenceLibrarySetup(ctx, {
      name: "Activation Library",
      slug: "activation-library",
      publicAddress: essentialSections.identity.baseUrl,
    }),
  );
  if (state === "active") {
    await admin.run(async (ctx) => {
      const insertCredential = async (credentialKey: string) =>
        await ctx.db.insert("evidenceLibraryCredentials", {
          libraryId: created.libraryId,
          credentialKey,
          encryptedValue: `encrypted-${credentialKey}`,
          validationState: "valid",
          createdByClerkUserId: clerkUserId,
          updatedByClerkUserId: clerkUserId,
          createdAt: 1,
          updatedAt: 1,
        });
      const [databaseCredentialId, searchCredentialId, storageCredentialId] =
        await Promise.all([
          insertCredential("/services/database/url"),
          insertCredential("/services/search/key"),
          insertCredential("/services/storage/serviceRoleKey"),
        ]);
      await ctx.db.replace(created.runtimeBindingId, {
        libraryId: created.libraryId,
        targetBaseUrl: created.publicAddress,
        targetRuntimeId: "coolify-activation-app",
        runtimeCommit: "a".repeat(40),
        searchHost: "http://meilisearch:7700",
        searchIndex: "evidence_library",
        storageUrl: "https://storage.example.test",
        storagePrivateBucket: "private-activation",
        storagePublicBucket: "public-activation",
        storageMaxPdfBytes: 52_428_800,
        databaseCredentialId,
        searchCredentialId,
        storageCredentialId,
        state: "ready",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(created.libraryId, {
        state,
        activeRevisionId: created.revisionId,
      });
    });
  }
  return { admin, created };
}

describe("Evidence Library operation state", () => {
  it("scopes idempotency to a library and binds it to the complete command", async () => {
    const t = convexTest(schema, modules);
    const first = await createOperationFixture(t, "first");
    const second = await createOperationFixture(t, "second");
    const firstCommand = {
      libraryId: first.libraryId,
      idempotencyKey: "shared-key",
      revisionId: first.revisionIds[0],
      activationEditVersion: 1,
    };
    const firstOperation = await first.admin.run((ctx) =>
      queueConfigurationDeploymentOperation(ctx, firstCommand),
    );
    const secondOperation = await second.admin.run((ctx) =>
      queueConfigurationDeploymentOperation(ctx, {
        libraryId: second.libraryId,
        idempotencyKey: "shared-key",
        revisionId: second.revisionIds[0],
        activationEditVersion: 1,
      }),
    );

    expect(secondOperation.operationId).not.toBe(firstOperation.operationId);
    expect(
      await first.admin.run((ctx) =>
        queueConfigurationDeploymentOperation(ctx, firstCommand),
      ),
    ).toEqual(firstOperation);
    await expect(
      first.admin.run((ctx) =>
        queueConfigurationDeploymentOperation(ctx, {
          ...firstCommand,
          revisionId: first.revisionIds[1],
        }),
      ),
    ).rejects.toThrow(/CONFLICT.*idempotency/);
    await expect(
      first.admin.run((ctx) =>
        queueConfigurationDeploymentOperation(ctx, {
          ...firstCommand,
          activationEditVersion: 2,
        }),
      ),
    ).rejects.toThrow(/CONFLICT.*idempotency/);
    await expect(
      first.admin.run((ctx) =>
        queueConfigurationDeploymentOperation(ctx, {
          ...firstCommand,
          idempotencyKey: "wrong-revision-owner",
          revisionId: second.revisionIds[0],
        }),
      ),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      first.admin.run((ctx) =>
        // @ts-expect-error Runtime validation still rejects a missing revision.
        queueConfigurationDeploymentOperation(ctx, {
          libraryId: first.libraryId,
          idempotencyKey: "missing-revision",
          activationEditVersion: 2,
        }),
      ),
    ).rejects.toThrow(/VALIDATION_ERROR.*revision/);
  });

  it("does not expose configuration deployment through the generic queue", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createOperationFixture(t, "public_publish_queue");
    await expect(
      fixture.admin.mutation(api.evidenceLibraries.operations.queueOperation, {
        libraryId: fixture.libraryId,
        // @ts-expect-error Publish is intentionally not a public queue kind.
        kind: "publish",
        idempotencyKey: "publish:legacy",
        revisionId: fixture.revisionIds[0],
      }),
    ).rejects.toThrow(/Validator error/);
  });

  it("freezes visible sections into the existing setup operation atomically", async () => {
    const t = convexTest(schema, modules);
    const { admin, created } = await createActivationFixture(
      t,
      "setup_activation",
      "provisioning",
    );
    const saved = await admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: created.libraryId,
        sections: toSectionRows(essentialSections),
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
    await t.run((ctx) =>
      ctx.db.patch(created.libraryId, {
        state: "active",
      }),
    );
    const retried = await admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      {
        libraryId: created.libraryId,
        expectedEditVersion: saved.editVersion,
      },
    );
    const stored = await t.run(async (ctx) => ({
      library: await ctx.db.get(created.libraryId),
      operations: await ctx.db
        .query("evidenceLibraryConfigOperations")
        .collect()
        .then((operations) =>
          operations.filter(
            (operation) => operation.libraryId === created.libraryId,
          ),
        ),
      revisionSections: await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query.eq("revisionId", activated.revisionId),
        )
        .collect(),
      scheduledFunctions: await ctx.db.system
        .query("_scheduled_functions")
        .collect(),
    }));

    expect(activated).toMatchObject({
      kind: "setup",
      operationId: created.setupOperationId,
      revisionKey: "r2",
      status: "running",
    });
    expect(retried).toEqual(activated);
    expect(stored.operations).toHaveLength(1);
    expect(
      stored.scheduledFunctions.filter((scheduled) =>
        scheduled.name.includes("runDatabaseSetup"),
      ),
    ).toHaveLength(1);
    expect(stored.operations[0]).toMatchObject({
      _id: created.setupOperationId,
      activationEditVersion: saved.editVersion,
      kind: "setup",
      revisionId: activated.revisionId,
    });
    expect(
      Object.fromEntries(
        stored.revisionSections.map((section) => [
          section.sectionKey,
          section.payload,
        ]),
      ),
    ).toEqual(essentialSections);
    expect(stored.library).not.toHaveProperty("activeRevisionId");
  });

  it("stores assembly issues on the failed publish operation and exposes them through the draft", async () => {
    const t = convexTest(schema, modules);
    const { admin, created } = await createActivationFixture(
      t,
      "publish_issues",
      "active",
    );
    const saved = await admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: created.libraryId,
        sections: toSectionRows(essentialSections),
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
    const running = await t.run((ctx) =>
      ctx.db.get("evidenceLibraryConfigOperations", activated.operationId),
    );
    const issues = [
      { pointer: "/authentication/secret", message: "Required field is missing." },
      { pointer: "/identity/assets/favicon", message: "Value must match the uri format." },
    ];

    await expect(
      t.mutation(
        internal.evidenceLibraries.configurationDeployment
          .failConfigurationDeployment,
        {
          libraryId: created.libraryId,
          operationId: activated.operationId,
          attemptToken: running!.configurationAttemptToken!,
          attemptCount: running!.attemptCount,
          error: {
            code: "CONFIGURATION_ASSEMBLY_FAILED",
            message: "Evidence Library configuration could not be assembled",
            issues,
          },
        },
      ),
    ).resolves.toBe("failed");

    const draft = await admin.query(api.evidenceLibraries.queries.getDraft, {
      libraryId: created.libraryId,
    });
    expect(draft.operation).toMatchObject({
      _id: activated.operationId,
      status: "failed",
      error: { code: "CONFIGURATION_ASSEMBLY_FAILED", stage: "assembling" },
      issues,
    });
  });

  it("starts one publish revision for a running library without changing the active revision", async () => {
    const t = convexTest(schema, modules);
    const { admin, created } = await createActivationFixture(
      t,
      "publish_activation",
      "active",
    );
    const saved = await admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: created.libraryId,
        sections: toSectionRows(essentialSections),
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
    const retried = await admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      {
        libraryId: created.libraryId,
        expectedEditVersion: saved.editVersion,
      },
    );
    const beforeRejected = await t.run(async (ctx) => {
      const sections = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query.eq("draftId", created.draftId),
        )
        .collect();
      const localization = sections.find(
        (section) => section.sectionKey === "localization",
      )!;
      await ctx.db.patch(localization._id, {
        payload: { locales: ["fr"], defaultLocale: "not-supported" },
      });
      return {
        operations: await ctx.db
          .query("evidenceLibraryConfigOperations")
          .collect()
          .then((operations) =>
            operations.filter(
              (operation) => operation.libraryId === created.libraryId,
            ),
          ),
        revisions: await ctx.db
          .query("evidenceLibraryConfigRevisions")
          .withIndex("by_libraryId_and_revisionNumber", (query) =>
            query.eq("libraryId", created.libraryId),
          )
          .collect(),
      };
    });

    expect(activated).toMatchObject({
      kind: "publish",
      revisionKey: "r2",
      status: "running",
    });
    expect(retried).toEqual(activated);
    expect(
      await t.run((ctx) =>
        ctx.db.get("evidenceLibraryConfigOperations", activated.operationId),
      ),
    ).toMatchObject({
      attemptCount: 1,
      idempotencyKey: `activate:${saved.editVersion}`,
      kind: "publish",
      revisionId: activated.revisionId,
      stage: "assembling",
    });
    expect(await t.run((ctx) => ctx.db.get(created.libraryId))).toMatchObject({
      activeRevisionId: created.revisionId,
      latestRevisionId: activated.revisionId,
    });

    await expect(
      admin.mutation(api.evidenceLibraries.mutations.activateConfiguration, {
        libraryId: created.libraryId,
        expectedEditVersion: activated.editVersion,
      }),
    ).rejects.toThrow(/\/localization\/defaultLocale/);
    const afterRejected = await t.run(async (ctx) => ({
      library: await ctx.db.get(created.libraryId),
      operations: await ctx.db
        .query("evidenceLibraryConfigOperations")
        .collect()
        .then((operations) =>
          operations.filter(
            (operation) => operation.libraryId === created.libraryId,
          ),
        ),
      revisions: await ctx.db
        .query("evidenceLibraryConfigRevisions")
        .withIndex("by_libraryId_and_revisionNumber", (query) =>
          query.eq("libraryId", created.libraryId),
        )
        .collect(),
    }));
    expect(afterRejected.operations).toHaveLength(
      beforeRejected.operations.length,
    );
    expect(afterRejected.revisions).toHaveLength(
      beforeRejected.revisions.length,
    );
    expect(afterRejected.library?.activeRevisionId).toBe(created.revisionId);
  });
});
