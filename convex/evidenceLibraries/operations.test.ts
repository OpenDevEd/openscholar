/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  applyOperationTransition,
  queueEvidenceLibraryOperation,
} from "./operations";

describe("Evidence Library operation state", () => {
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
