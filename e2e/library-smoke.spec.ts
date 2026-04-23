import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSharedE2EUserEmail(): string {
  return requireEnv("E2E_CLERK_USER_EMAIL");
}

async function signIn(page: Page) {
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress: getSharedE2EUserEmail(),
  });
  await page.waitForFunction(() => Boolean(window.Clerk?.session));
}

async function getConvexToken(page: Page): Promise<string> {
  const token = await page.evaluate(async () => {
    const session = window.Clerk?.session;
    if (!session) {
      return null;
    }

    try {
      return await session.getToken({
        template: "convex",
        skipCache: true,
      });
    } catch {
      return await session.getToken({ skipCache: true });
    }
  });

  if (!token) {
    throw new Error("Failed to acquire a Clerk token for Convex seeding.");
  }

  return token;
}

async function seedLibrarySmokeFixture(args: {
  token: string;
  seedId: string;
}): Promise<{ collectionId: Id<"collections">; filteredCount: number; totalCount: number }> {
  const convexUrl = requireEnv("NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(args.token);

  await client.mutation(api.users.mutations.ensureUser, {});

  const collectionId = await client.mutation(
    api.library.collections.createCollection,
    {
      name: `Plan 05 smoke ${args.seedId}`,
    },
  );

  const collectionTargetCount = 21;
  const totalTargetCount = 22;

  for (let index = 0; index < totalTargetCount; index += 1) {
    const libraryItemId = await client.mutation(api.library.mutations.saveToLibrary, {
      openalexId: `W_PLAN05_${args.seedId}_${index}`,
      rating: 5,
      title: `Plan 05 Smoke Paper ${index + 1}`,
      authors: "Smoke, Test",
      abstract: `Plan 05 smoke abstract ${index + 1}`,
      publicationYear: 2024,
      journal: "Smoke Journal",
      citedByCount: index,
      isOpenAccess: true,
      oaStatus: "gold",
      paperData: JSON.stringify({
        id: `https://openalex.org/W_PLAN05_${args.seedId}_${index}`,
        title: `Plan 05 Smoke Paper ${index + 1}`,
      }),
    });

    if (index < collectionTargetCount) {
      await client.mutation(api.library.collections.addToCollection, {
        collectionId,
        libraryItemId,
      });
    }
  }

  const [filteredCount, totalCount] = await Promise.all([
    client.query(api.library.queries.getLibraryFilteredCount, {
      sortBy: "savedAt",
      sortOrder: "desc",
      collectionId,
    }),
    client.query(api.library.queries.getLibraryCount, {}),
  ]);

  return {
    collectionId,
    filteredCount,
    totalCount,
  };
}

test.describe("library smoke", () => {
  test("shows the exact collection total and page range in a real browser", async ({
    page,
  }) => {
    test.slow();

    await signIn(page);

    const token = await getConvexToken(page);
    const seedId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedLibrarySmokeFixture({ token, seedId });

    await page.goto(`/library?col=${fixture.collectionId}`);

    await expect(
      page.getByText(`${fixture.filteredCount} / ${fixture.totalCount} results`),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(`Showing 1-20 of ${fixture.filteredCount} papers`),
    ).toBeVisible({ timeout: 60_000 });
  });
});
