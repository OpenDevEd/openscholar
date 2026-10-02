/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "a".repeat(43);

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_sources", evidenceLibrariesEnabled: true, name: "Library", slug: "library", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    const users = new Map<string, Awaited<ReturnType<typeof ctx.db.insert<"users">>>>();
    for (const clerkId of ["owner", "colleague"]) {
      users.set(clerkId, await ctx.db.insert("users", {libraryItemCount: 0,  clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 }));
      await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `membership-${clerkId}`, clerkUserId: clerkId, role: "org:admin", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    }
    const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    const item = (openalexId: string) => ctx.db.insert("libraryItems", { userId: users.get("owner")!, openalexId, rating: 0, title: openalexId, searchableText: openalexId, savedAt: 1, updatedAt: 1 });
    return { libraryId, ownerId: users.get("owner")!, items: [await item("https://openalex.org/W1"), await item("https://openalex.org/W2")] };
  });
  const owner = t.withIdentity({ subject: "owner" });
  const colleague = t.withIdentity({ subject: "colleague" });
  const collectionId = await owner.mutation(api.library.collections.createCollection, { name: "Reading list" });
  const read = async (body: Record<string, unknown> = {}, credential = token) => {
    const response = await t.fetch("/api/v1/evidence-libraries/source-collections/items", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, libraryId: seeded.libraryId, collectionId, knownVersion: null, cursor: null, ...body }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { t, owner, colleague, collectionId, read, ...seeded };
}

it("serves a connected collection's OpenAlex works and a version that moves only when its items change", async () => {
  const { owner, collectionId, items, libraryId, read } = await setup();
  expect((await read()).body).toEqual({ error: "not_configured" });

  await owner.mutation(api.evidenceLibraries.collectionSources.connectCollectionSource, { libraryId, collectionId });
  for (const libraryItemId of items) {
    await owner.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId });
  }
  const first = await read();
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ contractVersion: 1, name: "Reading list", unchanged: false, nextCursor: null });
  expect((first.body.items as { openalexId: string }[]).map((item) => item.openalexId).sort()).toEqual(["W1", "W2"]);

  // A rename is not a change of items, so a library that has this version reads nothing.
  await owner.mutation(api.library.collections.renameCollection, { collectionId, name: "Renamed" });
  expect((await read({ knownVersion: first.body.version })).body).toMatchObject({ unchanged: true, name: "Renamed", items: [] });

  await owner.mutation(api.library.collections.removeFromCollection, { collectionId, libraryItemId: items[0]! });
  const after = await read({ knownVersion: first.body.version });
  expect(after.body.version).not.toBe(first.body.version);
  expect((after.body.items as { openalexId: string }[]).map((item) => item.openalexId)).toEqual(["W2"]);
});

it("names a paper from the OpenScholar API by the OpenAlex id its stored work holds, else by its DOI", async () => {
  const { t, owner, collectionId, libraryId, ownerId, read } = await setup();
  const saved = (openalexId: string, extra: { doi?: string; paperData: string }) =>
    t.run((ctx) => ctx.db.insert("libraryItems", { userId: ownerId, openalexId, rating: 0, title: openalexId, searchableText: openalexId, savedAt: 1, updatedAt: 1, ...extra }));
  const joined = await saved("https://openscholar.ai/OS7", { paperData: JSON.stringify({ id: "https://openscholar.ai/OS7", ids: { openalex: "https://openalex.org/W7" } }) });
  const alone = await saved("https://openscholar.ai/OS8", { doi: "10.1/eight", paperData: JSON.stringify({ id: "https://openscholar.ai/OS8", ids: {} }) });
  await owner.mutation(api.evidenceLibraries.collectionSources.connectCollectionSource, { libraryId, collectionId });
  for (const libraryItemId of [joined, alone]) {
    await owner.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId });
  }

  const items = (await read()).body.items as { openalexId: string | null; doi: string | null }[];

  expect(items.map(({ openalexId, doi }) => `${openalexId} ${doi}`).sort()).toEqual(["W7 null", "null 10.1/eight"]);
});

it("lets only the collection's owner connect it, and stops serving it once they leave the organization", async () => {
  const { t, owner, colleague, collectionId, libraryId, read } = await setup();
  await expect(
    colleague.mutation(api.evidenceLibraries.collectionSources.connectCollectionSource, { libraryId, collectionId }),
  ).rejects.toThrow();
  await owner.mutation(api.evidenceLibraries.collectionSources.connectCollectionSource, { libraryId, collectionId });
  expect((await read({}, "els_" + "b".repeat(43))).status).toBe(401);
  expect((await read()).status).toBe(200);

  await t.run(async (ctx) => {
    const membership = await ctx.db.query("organizationMemberships").withIndex("by_clerkMembershipId", (q) => q.eq("clerkMembershipId", "membership-owner")).unique();
    await ctx.db.patch("organizationMemberships", membership!._id, { state: "revoked" });
  });
  expect(await read()).toEqual({ status: 403, body: { error: "owner_left" } });

  await t.run(async (ctx) => ctx.db.delete("collections", collectionId));
  expect(await read()).toEqual({ status: 404, body: { error: "collection_not_found" } });
});
