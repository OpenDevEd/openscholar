/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { decrypt } from "../lib/crypto";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");
const encryptionKey = "ab".repeat(32);

async function seedLibrary() {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_service_auth",
      name: "Service Auth Team",
      slug: "service-auth-team",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
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
    return await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "Service Auth Library",
      slug: "service-auth-library",
      state: "active",
      createdByClerkUserId: "user_service_auth",
      updatedByClerkUserId: "user_service_auth",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const admin = t.withIdentity({
    subject: "user_service_auth",
    o: { id: "org_service_auth", rol: "org:admin" },
  });
  return { admin, libraryId, t };
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

    const metadata = await admin.query(
      api.evidenceLibraries.credentials.listCredentialMetadata,
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
  });
});
