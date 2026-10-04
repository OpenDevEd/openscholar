/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { decrypt } from "../lib/crypto";
import schema from "../schema";
import { authenticateLibraryServiceCredential } from "./credentials";

const modules = import.meta.glob("/convex/**/*.ts");
const encryptionKey = "ab".repeat(32);

async function seedLibrary() {
  const t = convexTest(schema, modules);
  const libraries = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_service_auth",
      name: "Service Auth Team",
      slug: "service-auth-team",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      evidenceLibrariesEnabled: true,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: "orgmem_service_auth",
      clerkUserId: "user_service_auth",
      role: "org:admin",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const libraryId = await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "Service Auth Library",
      slug: "service-auth-library",
      state: "active",
      createdByClerkUserId: "user_service_auth",
      updatedByClerkUserId: "user_service_auth",
      createdAt: 1,
      updatedAt: 1,
    });
    const secondLibraryId = await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "Second Service Auth Library",
      slug: "second-service-auth-library",
      state: "active",
      createdByClerkUserId: "user_service_auth",
      updatedByClerkUserId: "user_service_auth",
      createdAt: 1,
      updatedAt: 1,
    });
    return { libraryId, secondLibraryId };
  });
  const admin = t.withIdentity({
    subject: "user_service_auth",
    o: { id: "org_service_auth", rol: "org:admin" },
  });
  return { admin, ...libraries, t };
}

describe("Evidence Library machine credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a new credential once and stores its encrypted value and digest", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { admin, libraryId, t } = await seedLibrary();

    const issued = await admin.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId },
    );

    expect(issued.credential).toMatch(/^els_[A-Za-z0-9_-]{43}$/);
    expect(issued.maskedHint).toMatch(/^els_[A-Za-z0-9_-]{3}\.\.\.$/);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query.eq("libraryId", libraryId).eq("credentialKey", "library-service"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(decrypt(rows[0].encryptedValue, encryptionKey)).toBe(issued.credential);
    expect(rows[0].credentialDigest).toBe(
      createHash("sha256").update(issued.credential).digest("hex"),
    );

    const { page: metadata } = await admin.query(
      api.evidenceLibraries.credentials.listCredentials,
      { libraryId },
    );
    expect(metadata).toEqual([
      expect.objectContaining({
        credentialKey: "library-service",
        maskedHint: issued.maskedHint,
      }),
    ]);
    expect(metadata[0]).not.toHaveProperty("encryptedValue");
    expect(metadata[0]).not.toHaveProperty("credentialDigest");

    const auditRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (query) =>
          query.eq("action", "evidence_library.service_credential.rotated"),
        )
        .take(2),
    );
    expect(auditRows).toEqual([
      expect.objectContaining({
        userId: "user_service_auth",
        metadata: {
          credentialId: issued.credentialId,
          libraryId,
        },
      }),
    ]);
  });

  it("rotates one library in place without invalidating another library", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { admin, libraryId, secondLibraryId, t } = await seedLibrary();

    const firstLibraryCredential = await admin.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId },
    );
    const secondLibraryCredential = await admin.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId: secondLibraryId },
    );
    const rotatedFirstLibraryCredential = await admin.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId },
    );

    expect(rotatedFirstLibraryCredential.credentialId).toBe(
      firstLibraryCredential.credentialId,
    );
    expect(rotatedFirstLibraryCredential.credential).not.toBe(
      firstLibraryCredential.credential,
    );
    expect(secondLibraryCredential.credentialId).not.toBe(
      firstLibraryCredential.credentialId,
    );

    await expect(
      t.run((ctx) =>
        authenticateLibraryServiceCredential(ctx, {
          libraryId,
          credentialDigest: createHash("sha256")
            .update(firstLibraryCredential.credential)
            .digest("hex"),
        }),
      ),
    ).rejects.toThrow(/Evidence Library service authentication failed/);
    await expect(
      t.run((ctx) =>
        authenticateLibraryServiceCredential(ctx, {
          libraryId,
          credentialDigest: createHash("sha256")
            .update(rotatedFirstLibraryCredential.credential)
            .digest("hex"),
        }),
      ),
    ).resolves.toMatchObject({ libraryId });
    await expect(
      t.run((ctx) =>
        authenticateLibraryServiceCredential(ctx, {
          libraryId: secondLibraryId,
          credentialDigest: createHash("sha256")
            .update(secondLibraryCredential.credential)
            .digest("hex"),
        }),
      ),
    ).resolves.toMatchObject({ libraryId: secondLibraryId });
    await expect(
      t.run((ctx) =>
        authenticateLibraryServiceCredential(ctx, {
          libraryId: secondLibraryId,
          credentialDigest: createHash("sha256")
            .update(rotatedFirstLibraryCredential.credential)
            .digest("hex"),
        }),
      ),
    ).rejects.toThrow(/Evidence Library service authentication failed/);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryCredentials").take(3),
    );
    expect(rows).toHaveLength(2);
  });

  it("rejects an active Editor without creating a credential", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, t } = await seedLibrary();
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("organizationMemberships")
        .withIndex("by_clerkMembershipId", (query) =>
          query.eq("clerkMembershipId", "orgmem_service_auth"),
        )
        .unique();
      if (!membership) throw new Error("Expected seeded membership");
      await ctx.db.patch("organizationMemberships", membership._id, {
        role: "org:member",
      });
    });
    const editor = t.withIdentity({
      subject: "user_service_auth",
      o: { id: "org_service_auth", rol: "org:member" },
    });

    await expect(
      editor.action(
        api.evidenceLibraries.credentialActions.rotateServiceCredential,
        { libraryId },
      ),
    ).rejects.toThrow(/Evidence Library access denied/);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryCredentials").take(1),
    );
    expect(rows).toHaveLength(0);
  });
});
