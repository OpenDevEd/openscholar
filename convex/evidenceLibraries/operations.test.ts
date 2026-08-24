/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  applyOperationTransition,
  queueEvidenceLibraryOperation,
} from "./operations";
import { createEvidenceLibrarySetup } from "./mutations";

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
    await admin.run((ctx) =>
      ctx.db.patch(created.libraryId, {
        state,
        activeRevisionId: created.revisionId,
      }),
    );
  }
  return { admin, created };
}

describe("Evidence Library operation state", () => {
  it("exposes exact transition entrypoints with bounded receipt metadata", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createOperationFixture(t, "transition_contract");
    const queued = await fixture.admin.run((ctx) =>
      queueEvidenceLibraryOperation(ctx, {
        libraryId: fixture.libraryId,
        kind: "validate",
        idempotencyKey: "transition-contract",
      }),
    );

    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.startOperation,
        // @ts-expect-error Runtime validator must reject a missing stage too.
        { libraryId: fixture.libraryId, operationId: queued.operationId },
      ),
    ).rejects.toThrow();
    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.failOperation,
        // @ts-expect-error Runtime validator must reject a missing error too.
        { libraryId: fixture.libraryId, operationId: queued.operationId },
      ),
    ).rejects.toThrow();
    await fixture.admin.mutation(
      internal.evidenceLibraries.operations.startOperation,
      {
        libraryId: fixture.libraryId,
        operationId: queued.operationId,
        stage: "validating",
      },
    );
    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.succeedOperation,
        {
          libraryId: fixture.libraryId,
          operationId: queued.operationId,
          receipt: { revisionKey: "r".repeat(65) },
        },
      ),
    ).rejects.toThrow(/revisionKey/);
    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.succeedOperation,
        {
          libraryId: fixture.libraryId,
          operationId: queued.operationId,
          receipt: { targetConfigSha256: "not-a-digest" },
        },
      ),
    ).rejects.toThrow(/targetConfigSha256/);
    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.succeedOperation,
        {
          libraryId: fixture.libraryId,
          operationId: queued.operationId,
          receipt: { runtimeReceiptId: "   " },
        },
      ),
    ).rejects.toThrow(/runtimeReceiptId/);
    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.succeedOperation,
        {
          libraryId: fixture.libraryId,
          operationId: queued.operationId,
          receipt: { activatedAt: -1 },
        },
      ),
    ).rejects.toThrow(/activatedAt/);
    await expect(
      fixture.admin.mutation(
        internal.evidenceLibraries.operations.succeedOperation,
        {
          libraryId: fixture.libraryId,
          operationId: queued.operationId,
          // @ts-expect-error Exact succeed args reject start-only metadata.
          stage: "activating",
        },
      ),
    ).rejects.toThrow();
    await fixture.admin.mutation(
      internal.evidenceLibraries.operations.failOperation,
      {
        libraryId: fixture.libraryId,
        operationId: queued.operationId,
        error: { code: "REMOTE_FAILURE", message: "Runtime rejected candidate" },
      },
    );

    const stored = await t.run((ctx) =>
      ctx.db.get("evidenceLibraryConfigOperations", queued.operationId),
    );
    expect(stored).toMatchObject({
      error: {
        code: "REMOTE_FAILURE",
        message: "Runtime rejected candidate",
        stage: "validating",
      },
      status: "failed",
    });
  });

  it("scopes idempotency to a library and binds it to the complete command", async () => {
    const t = convexTest(schema, modules);
    const first = await createOperationFixture(t, "first");
    const second = await createOperationFixture(t, "second");
    const firstCommand = {
      libraryId: first.libraryId,
      kind: "publish" as const,
      idempotencyKey: "shared-key",
      revisionId: first.revisionIds[0],
    };
    const firstOperation = await first.admin.run((ctx) =>
      queueEvidenceLibraryOperation(ctx, firstCommand),
    );
    const secondOperation = await second.admin.run((ctx) =>
      queueEvidenceLibraryOperation(ctx, {
        libraryId: second.libraryId,
        kind: "publish",
        idempotencyKey: "shared-key",
        revisionId: second.revisionIds[0],
      }),
    );

    expect(secondOperation.operationId).not.toBe(firstOperation.operationId);
    expect(
      await first.admin.run((ctx) =>
        queueEvidenceLibraryOperation(ctx, firstCommand),
      ),
    ).toEqual(firstOperation);
    await expect(
      first.admin.run((ctx) =>
        queueEvidenceLibraryOperation(ctx, {
          ...firstCommand,
          revisionId: first.revisionIds[1],
        }),
      ),
    ).rejects.toThrow(/CONFLICT.*idempotency/);
    await expect(
      first.admin.run((ctx) =>
        queueEvidenceLibraryOperation(ctx, {
          ...firstCommand,
          kind: "rollback",
        }),
      ),
    ).rejects.toThrow(/CONFLICT.*idempotency/);
    await expect(
      first.admin.run((ctx) =>
        queueEvidenceLibraryOperation(ctx, {
          ...firstCommand,
          idempotencyKey: "wrong-revision-owner",
          revisionId: second.revisionIds[0],
        }),
      ),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      first.admin.run((ctx) =>
        queueEvidenceLibraryOperation(ctx, {
          libraryId: first.libraryId,
          kind: "publish",
          idempotencyKey: "missing-revision",
        }),
      ),
    ).rejects.toThrow(/VALIDATION_ERROR.*revision/);
  });

  it("deduplicates queue requests and enforces terminal transitions", async () => {
    const t = convexTest(schema, modules);
    const libraryId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_operations",
        name: "Operation Team",
        slug: "operation-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_operations",
        clerkUserId: "user_operations",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("evidenceLibraries", {
        organizationId,
        name: "Operation Library",
        slug: "operation-library",
        state: "active",
        createdByClerkUserId: "user_operations",
        updatedByClerkUserId: "user_operations",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const admin = t.withIdentity({
      subject: "user_operations",
      o: { id: "org_operations", rol: "org:admin" },
    });
    const first = await admin.run((ctx) =>
      queueEvidenceLibraryOperation(ctx, {
        libraryId,
        kind: "validate",
        idempotencyKey: "validate:1",
      }),
    );
    const replay = await admin.run((ctx) =>
      queueEvidenceLibraryOperation(ctx, {
        libraryId,
        kind: "validate",
        idempotencyKey: "validate:1",
      }),
    );
    expect(replay).toEqual(first);

    await admin.run((ctx) =>
      applyOperationTransition(ctx, {
        libraryId,
        operationId: first.operationId,
        transition: "start",
        stage: "validating",
      }),
    );
    await admin.run((ctx) =>
      applyOperationTransition(ctx, {
        libraryId,
        operationId: first.operationId,
        transition: "succeed",
        receipt: { targetConfigSha256: "a".repeat(64) },
      }),
    );
    await expect(
      admin.run((ctx) =>
        applyOperationTransition(ctx, {
          libraryId,
          operationId: first.operationId,
          transition: "start",
          stage: "validating",
        }),
      ),
    ).rejects.toThrow(/operation transition/);

    const stored = await t.run((ctx) =>
      ctx.db.get("evidenceLibraryConfigOperations", first.operationId),
    );
    expect(stored).toMatchObject({
      attemptCount: 1,
      stage: "completed",
      status: "succeeded",
      receipt: { targetConfigSha256: "a".repeat(64) },
    });
  });

  it("freezes visible sections into the existing setup operation atomically", async () => {
    const t = convexTest(schema, modules);
    const { admin, created } = await createActivationFixture(
      t,
      "setup_activation",
      "provisioning",
    );
    const saved = await admin.mutation(
      api.evidenceLibraries.mutations.saveEssentialConfiguration,
      {
        libraryId: created.libraryId,
        sections: essentialSections,
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
    }));

    expect(activated).toMatchObject({
      kind: "setup",
      operationId: created.setupOperationId,
      revisionKey: "r2",
      status: "queued",
    });
    expect(stored.operations).toHaveLength(1);
    expect(stored.operations[0]).toMatchObject({
      _id: created.setupOperationId,
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

  it("queues one publish revision for a running library without changing the active revision", async () => {
    const t = convexTest(schema, modules);
    const { admin, created } = await createActivationFixture(
      t,
      "publish_activation",
      "active",
    );
    const saved = await admin.mutation(
      api.evidenceLibraries.mutations.saveEssentialConfiguration,
      {
        libraryId: created.libraryId,
        sections: essentialSections,
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
        payload: { locales: ["fr"], defaultLocale: "en-GB" },
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
      status: "queued",
    });
    expect(
      await t.run((ctx) =>
        ctx.db.get("evidenceLibraryConfigOperations", activated.operationId),
      ),
    ).toMatchObject({
      idempotencyKey: "publish:r2",
      kind: "publish",
      revisionId: activated.revisionId,
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
    expect(afterRejected.operations).toHaveLength(beforeRejected.operations.length);
    expect(afterRejected.revisions).toHaveLength(beforeRejected.revisions.length);
    expect(afterRejected.library?.activeRevisionId).toBe(created.revisionId);
  });
});
