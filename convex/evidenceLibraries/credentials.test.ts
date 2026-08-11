/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  readCredentialMetadata,
  resolveCredentialPath,
  storeEvidenceLibraryCredential,
} from "./credentials";

describe("resolveCredentialPath", () => {
  it("derives generated write-only patterns and stable keys", () => {
    expect(resolveCredentialPath("/services/database/url")).toEqual({
      credentialKey: "/services/database/url",
      pathPattern: "/services/database/url",
    });
    expect(resolveCredentialPath("/ai/providers/0/apiKey", "openai")).toEqual({
      credentialKey: "/ai/providers/*/apiKey:openai",
      pathPattern: "/ai/providers/*/apiKey",
    });
  });

  it("rejects paths outside the generated credential contract", () => {
    expect(() => resolveCredentialPath("/identity/name")).toThrow(
      /credential path/,
    );
  });
});

describe("Evidence Library credential storage", () => {
  it("returns metadata without encrypted material", async () => {
    const t = convexTest(schema);
    const libraryId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_credentials",
        name: "Credential Team",
        slug: "credential-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_credentials",
        clerkUserId: "user_credentials",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("evidenceLibraries", {
        organizationId,
        name: "Credential Library",
        slug: "credential-library",
        state: "active",
        createdByClerkUserId: "user_credentials",
        updatedByClerkUserId: "user_credentials",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const admin = t.withIdentity({
      subject: "user_credentials",
      o: { id: "org_credentials", rol: "org:admin" },
    });

    await admin.run((ctx) =>
      storeEvidenceLibraryCredential(ctx, {
        libraryId,
        concretePath: "/services/database/url",
        encryptedValue: "ciphertext-only",
        maskedHint: "pos…gres",
      }),
    );
    const metadata = await admin.run((ctx) =>
      readCredentialMetadata(ctx, { libraryId }),
    );

    expect(metadata).toEqual([
      expect.objectContaining({
        credentialKey: "/services/database/url",
        maskedHint: "pos…gres",
        validationState: "untested",
      }),
    ]);
    expect(metadata[0]).not.toHaveProperty("encryptedValue");
  });
});
