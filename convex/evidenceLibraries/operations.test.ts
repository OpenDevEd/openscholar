/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  applyOperationTransition,
  queueEvidenceLibraryOperation,
} from "./operations";

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

describe("Evidence Library operation state", () => {
  it("scopes idempotency to a library and binds it to the complete command", async () => {
    const t = convexTest(schema);
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
    const t = convexTest(schema);
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
});
