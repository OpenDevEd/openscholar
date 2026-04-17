import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";

const identity = {
  subject: "clerk_col",
  tokenIdentifier: "clerk_col|test",
};

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_col",
      email: "col@test.com",
      firstName: "C",
      lastName: "U",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const otherUserId = await ctx.db.insert("users", {
      clerkId: "clerk_col_other",
      email: "colo@test.com",
      firstName: "O",
      lastName: "O",
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
    const collectionId = await ctx.db.insert("collections", {
      userId,
      name: "Seed Collection",
      createdAt: now,
      updatedAt: now,
    });
    const otherCollectionId = await ctx.db.insert("collections", {
      userId: otherUserId,
      name: "Other Collection",
      createdAt: now,
      updatedAt: now,
    });
    const titles = ["One", "Two", "Three"];
    for (const title of titles) {
      const libraryItemId = await ctx.db.insert("libraryItems", {
        userId,
        openalexId: `https://openalex.org/W${title}`,
        rating: 3,
        title,
        searchableText: title,
        savedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("libraryItemCollections", {
        userId,
        collectionId,
        libraryItemId,
        assignedAt: now,
      });
    }
    return { userId, otherUserId, collectionId, otherCollectionId } as {
      userId: Id<"users">;
      otherUserId: Id<"users">;
      collectionId: Id<"collections">;
      otherCollectionId: Id<"collections">;
    };
  });
}

describe("extraction.sources.collections.listItems", () => {
  it("joins junction rows to libraryItems for the authenticated owner", async () => {
    const t = convexTest(schema);
    const { collectionId } = await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(
      api.extraction.sources.collections.listItems,
      {
        collectionId,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(res.page).toHaveLength(3);
    expect(res.page.every((p) => typeof p.title === "string")).toBe(true);
  });

  it("rejects access to another user's collection", async () => {
    const t = convexTest(schema);
    const { otherCollectionId } = await seed(t);
    const auth = t.withIdentity(identity);
    await expect(
      auth.query(api.extraction.sources.collections.listItems, {
        collectionId: otherCollectionId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  });

  it("honors paginationOpts", async () => {
    const t = convexTest(schema);
    const { collectionId } = await seed(t);
    const auth = t.withIdentity(identity);
    const first = await auth.query(
      api.extraction.sources.collections.listItems,
      {
        collectionId,
        paginationOpts: { numItems: 2, cursor: null },
      },
    );
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
  });
});

describe("extraction.sources.collections.listAllItems", () => {
  it("returns every joined libraryItem for the collection", async () => {
    const t = convexTest(schema);
    const { collectionId } = await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(
      api.extraction.sources.collections.listAllItems,
      { collectionId },
    );
    expect(res.items).toHaveLength(3);
    expect(res.truncated).toBe(false);
    expect(res.items.every((p) => typeof p.title === "string")).toBe(true);
  });

  it("rejects access to another user's collection", async () => {
    const t = convexTest(schema);
    const { otherCollectionId } = await seed(t);
    const auth = t.withIdentity(identity);
    await expect(
      auth.query(api.extraction.sources.collections.listAllItems, {
        collectionId: otherCollectionId,
      }),
    ).rejects.toThrow();
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema);
    const { collectionId } = await seed(t);
    await expect(
      t.query(api.extraction.sources.collections.listAllItems, {
        collectionId,
      }),
    ).rejects.toThrow();
  });
});
