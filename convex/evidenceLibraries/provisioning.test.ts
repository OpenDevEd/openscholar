/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  seedDevelopmentRuntimeBinding,
  validateTargetBaseUrl,
} from "./provisioning";

describe("validateTargetBaseUrl", () => {
  it("accepts an origin and rejects a path-bearing URL", () => {
    expect(validateTargetBaseUrl("https://library.example.org")).toBe(
      "https://library.example.org",
    );
    expect(() => validateTargetBaseUrl("https://library.example.org/lib")).toThrow(
      /origin-only/,
    );
  });
});

describe("development runtime binding seed", () => {
  it("stores platform values and credential references outside draft JSON", async () => {
    const t = convexTest(schema);
    const libraryId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_seed",
        name: "Seed Team",
        slug: "seed-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_seed",
        clerkUserId: "user_seed",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("evidenceLibraries", {
        organizationId,
        name: "Seed Library",
        slug: "seed-library",
        state: "provisioning",
        createdByClerkUserId: "user_seed",
        updatedByClerkUserId: "user_seed",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const admin = t.withIdentity({
      subject: "user_seed",
      o: { id: "org_seed", rol: "org:admin" },
    });
    const seeded = await admin.run((ctx) =>
      seedDevelopmentRuntimeBinding(ctx, {
        libraryId,
        targetRuntimeId: "runtime_dev_1",
        targetBaseUrl: "https://library.example.org",
        searchHost: "https://search.example.org",
        searchIndex: "evidence",
        storageUrl: "https://storage.example.org",
        storageDocumentsBucket: "documents",
        storageImagesBucket: "images",
        storageMaxPdfBytes: 20_000_000,
        encryptedDatabaseUrl: "enc-db",
        encryptedSearchKey: "enc-search",
        encryptedStorageServiceRoleKey: "enc-storage",
      }),
    );
    const stored = await t.run(async (ctx) => ({
      binding: await ctx.db.get("evidenceLibraryRuntimeBindings", seeded.bindingId),
      credentials: await ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId", (query) => query.eq("libraryId", libraryId))
        .collect(),
      sections: await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_libraryId_and_kind", (query) =>
          query.eq("libraryId", libraryId).eq("kind", "draft"),
        )
        .collect(),
    }));

    expect(stored.binding).toMatchObject({
      state: "pending",
      targetRuntimeId: "runtime_dev_1",
      targetBaseUrl: "https://library.example.org",
    });
    expect(stored.credentials).toHaveLength(3);
    expect(stored.sections).toHaveLength(0);
  });
});
