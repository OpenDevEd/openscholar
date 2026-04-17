import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";

const identity = {
  subject: "clerk_lib",
  tokenIdentifier: "clerk_lib|test",
};

const otherIdentity = {
  subject: "clerk_other",
  tokenIdentifier: "clerk_other|test",
};

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_lib",
      email: "lib@test.com",
      firstName: "L",
      lastName: "U",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const otherUserId = await ctx.db.insert("users", {
      clerkId: "clerk_other",
      email: "other@test.com",
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
    const titles = ["Neural Networks Review", "CRISPR Guide", "Quantum Solar Cells"];
    for (const title of titles) {
      await ctx.db.insert("libraryItems", {
        userId,
        openalexId: `https://openalex.org/W${title.length}`,
        rating: 5,
        title,
        searchableText: title.toLowerCase(),
        savedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("libraryItems", {
      userId: otherUserId,
      openalexId: "https://openalex.org/Wother",
      rating: 0,
      title: "Not Mine",
      searchableText: "not mine",
      savedAt: now,
      updatedAt: now,
    });
    return { userId, otherUserId } as {
      userId: Id<"users">;
      otherUserId: Id<"users">;
    };
  });
}

describe("extraction.sources.library.list", () => {
  it("returns the user's items when no query is given", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(api.extraction.sources.library.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(res.page).toHaveLength(3);
    expect(res.page.every((p) => p.userId !== undefined)).toBe(true);
  });

  it("filters by the search_library index when a query is supplied", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(api.extraction.sources.library.list, {
      paginationOpts: { numItems: 10, cursor: null },
      query: "crispr",
    });
    expect(res.page).toHaveLength(1);
    expect(res.page[0].title).toBe("CRISPR Guide");
  });

  it("paginates when numItems < total", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);
    const first = await auth.query(api.extraction.sources.library.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
  });

  it("excludes items owned by other users", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(api.extraction.sources.library.list, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(res.page.every((p) => p.title !== "Not Mine")).toBe(true);
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema);
    await seed(t);
    await expect(
      t.query(api.extraction.sources.library.list, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
    // other user sees only their own (empty from this seed's POV aside from "Not Mine")
    const otherAuth = t.withIdentity(otherIdentity);
    const otherRes = await otherAuth.query(
      api.extraction.sources.library.list,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(otherRes.page).toHaveLength(1);
    expect(otherRes.page[0].title).toBe("Not Mine");
  });
});

describe("extraction.sources.library.listAllIds", () => {
  it("returns every item for the authed user when under the cap", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(
      api.extraction.sources.library.listAllIds,
      {},
    );
    expect(res.items).toHaveLength(3);
    expect(res.truncated).toBe(false);
    expect(res.items.every((r) => r.userId !== undefined)).toBe(true);
  });

  it("filters via search_library when a query is supplied", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(
      api.extraction.sources.library.listAllIds,
      { query: "crispr" },
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0].title).toBe("CRISPR Guide");
    expect(res.truncated).toBe(false);
  });

  it("scopes to the authed user — excludes other users' rows", async () => {
    const t = convexTest(schema);
    await seed(t);
    const auth = t.withIdentity(identity);
    const res = await auth.query(
      api.extraction.sources.library.listAllIds,
      {},
    );
    expect(res.items.every((r) => r.title !== "Not Mine")).toBe(true);
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema);
    await seed(t);
    await expect(
      t.query(api.extraction.sources.library.listAllIds, {}),
    ).rejects.toThrow();
  });
});
