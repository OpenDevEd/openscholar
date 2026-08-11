/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  assertEvidenceLibraryDevProvisioningEnabled,
  seedDevelopmentRuntimeBinding,
  validateTargetBaseUrl,
} from "./provisioning";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function createProvisioningFixture(
  t: ReturnType<typeof convexTest>,
  suffix: string,
) {
  const clerkOrganizationId = `org_${suffix}`;
  const clerkUserId = `user_${suffix}`;
  const libraryId = await t.run(async (ctx) => {
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
    return await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: `Library ${suffix}`,
      slug: `library-${suffix}`,
      state: "provisioning",
      createdByClerkUserId: clerkUserId,
      updatedByClerkUserId: clerkUserId,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return {
    admin: t.withIdentity({
      subject: clerkUserId,
      o: { id: clerkOrganizationId, rol: "org:admin" },
    }),
    libraryId,
  };
}

function validSeedArgs(libraryId: Id<"evidenceLibraries">) {
  return {
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
  };
}

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
  it("requires an explicit development opt-in and still rejects production", () => {
    expect(() =>
      assertEvidenceLibraryDevProvisioningEnabled({}),
    ).toThrow(/not-enabled/);
    expect(() =>
      assertEvidenceLibraryDevProvisioningEnabled({
        EVIDENCE_LIBRARY_DEV_PROVISIONING_ENABLED: "false",
      }),
    ).toThrow(/not-enabled/);
    expect(() =>
      assertEvidenceLibraryDevProvisioningEnabled({
        CONVEX_CLOUD_ENV: "prod",
        EVIDENCE_LIBRARY_DEV_PROVISIONING_ENABLED: "true",
      }),
    ).toThrow(/not-available-in-production/);
    expect(() =>
      assertEvidenceLibraryDevProvisioningEnabled({
        EVIDENCE_LIBRARY_DEV_PROVISIONING_ENABLED: "true",
      }),
    ).not.toThrow();
  });

  it("stores platform values and credential references outside draft JSON", async () => {
    vi.stubEnv("EVIDENCE_LIBRARY_DEV_PROVISIONING_ENABLED", "true");
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

  it.each([
    "targetRuntimeId",
    "searchHost",
    "searchIndex",
    "storageUrl",
    "storageDocumentsBucket",
    "storageImagesBucket",
    "encryptedDatabaseUrl",
    "encryptedSearchKey",
    "encryptedStorageServiceRoleKey",
    "zoteroTranslationUrl",
  ] as const)("rejects blank %s before writing anything", async (field) => {
    vi.stubEnv("EVIDENCE_LIBRARY_DEV_PROVISIONING_ENABLED", "true");
    const t = convexTest(schema);
    const { admin, libraryId } = await createProvisioningFixture(t, field);
    const args = {
      ...validSeedArgs(libraryId),
      ...(field === "zoteroTranslationUrl" ? { zoteroTranslationUrl: "   " } : {}),
    };
    if (field !== "zoteroTranslationUrl") {
      args[field] = "   ";
    }

    await expect(
      admin.run((ctx) => seedDevelopmentRuntimeBinding(ctx, args)),
    ).rejects.toThrow(/must not be blank/);
    const counts = await t.run(async (ctx) => ({
      bindings: (await ctx.db.query("evidenceLibraryRuntimeBindings").collect()).length,
      credentials: (await ctx.db.query("evidenceLibraryCredentials").collect()).length,
    }));
    expect(counts).toEqual({ bindings: 0, credentials: 0 });
  });

  it("reserves each target runtime for exactly one library", async () => {
    vi.stubEnv("EVIDENCE_LIBRARY_DEV_PROVISIONING_ENABLED", "true");
    const t = convexTest(schema);
    const first = await createProvisioningFixture(t, "runtime_first");
    const second = await createProvisioningFixture(t, "runtime_second");

    await first.admin.run((ctx) =>
      seedDevelopmentRuntimeBinding(ctx, validSeedArgs(first.libraryId)),
    );
    await expect(
      second.admin.run((ctx) =>
        seedDevelopmentRuntimeBinding(ctx, validSeedArgs(second.libraryId)),
      ),
    ).rejects.toThrow(/CONFLICT.*target runtime/);

    const counts = await t.run(async (ctx) => ({
      bindings: (await ctx.db.query("evidenceLibraryRuntimeBindings").collect()).length,
      credentials: (await ctx.db.query("evidenceLibraryCredentials").collect()).length,
    }));
    expect(counts).toEqual({ bindings: 1, credentials: 3 });
  });
});
