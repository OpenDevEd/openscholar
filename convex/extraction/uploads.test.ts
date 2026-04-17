import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../_generated/api";
import schema from "../schema";
import { MAX_PDF_BYTES } from "../../lib/files/limits";

const identity = {
  subject: "clerk_uploader",
  tokenIdentifier: "clerk_uploader|test",
};

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", {
      clerkId: "clerk_uploader",
      email: "uploader@test.com",
      firstName: "U",
      lastName: "U",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.pdf",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
  });
}

describe("recordUploadedFile", () => {
  it("returns the storageId and byte count when under the cap", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);

    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["small pdf"], { type: "application/pdf" })),
    );

    const res = await auth.mutation(
      api.extraction.uploads.recordUploadedFile,
      { storageId },
    );
    expect(res.storageId).toBe(storageId);
    expect(res.bytes).toBeGreaterThan(0);
    expect(res.bytes).toBeLessThanOrEqual(MAX_PDF_BYTES);

    // File still exists on success
    const still = await t.run(async (ctx) =>
      ctx.db.system.get(storageId),
    );
    expect(still).not.toBeNull();
  });

  it("throws VALIDATION_ERROR when the upload exceeds the cap", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);

    const oversize = MAX_PDF_BYTES + 1;
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array(oversize)], { type: "application/pdf" }),
      ),
    );

    try {
      await auth.mutation(api.extraction.uploads.recordUploadedFile, {
        storageId,
      });
      throw new Error("expected ConvexError VALIDATION_ERROR");
    } catch (e) {
      expect(e).toBeInstanceOf(ConvexError);
      const raw = (e as ConvexError<string>).data;
      const parsed = JSON.parse(raw) as { code: string; message?: string };
      expect(parsed.code).toBe("VALIDATION_ERROR");
      expect(parsed.message).toMatch(/100 MB/);
    }
  });

  it("throws FEATURE_DISABLED when extraction.pdf is off", async () => {
    const t = convexTest(schema);
    await seed(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "extraction.pdf"))
        .unique();
      if (row) {
        await ctx.db.patch(row._id, { enabled: false });
      }
    });
    const auth = t.withIdentity(identity);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "application/pdf" })),
    );
    await expect(
      auth.mutation(api.extraction.uploads.recordUploadedFile, { storageId }),
    ).rejects.toThrow();
  });
});
