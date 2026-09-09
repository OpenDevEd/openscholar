/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob("/convex/**/*.ts");

it("keeps associations tenant scoped and does not let old retries restore removed works", async () => {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async ctx => {
    await ctx.db.insert("users", {clerkId: "profile-owner", email: "owner@example.org", state: "active", createdAt: 1, updatedAt: 1});
    const organizationId = await ctx.db.insert("organizations", {clerkOrganizationId: "org_library", evidenceLibrariesEnabled: true, name: "Library team", slug: "library-team", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1});
    const libraryId = await ctx.db.insert("evidenceLibraries", {organizationId, name: "Learning", slug: "learning", state: "active", createdByClerkUserId: "library-owner", updatedByClerkUserId: "library-owner", createdAt: 1, updatedAt: 1});
    await ctx.db.insert("evidenceLibraryCredentials", {libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: "correct-digest", validationState: "valid", createdByClerkUserId: "library-owner", updatedByClerkUserId: "library-owner", createdAt: 1, updatedAt: 1});
    return libraryId;
  });
  const owner = t.withIdentity({subject: "profile-owner"});
  const profileId = await owner.mutation(api.authors.profiles.create, {name: "Caitlin Mills"});
  const args = {libraryId, credentialDigest: "correct-digest", itemKey: "ABCD2345", revision: 2, profileIds: [profileId, profileId]};
  await expect(t.mutation(internal.authors.publications.replaceFromLibrary, {...args, credentialDigest: "another-library"})).rejects.toThrow();
  await t.mutation(internal.authors.publications.replaceFromLibrary, args);
  await t.mutation(internal.authors.publications.replaceFromLibrary, args);
  const read = () => t.run(ctx => ctx.db.query("authorPublications").collect());
  const references = await read();
  expect(references).toHaveLength(1);
  expect(references[0]).toMatchObject({profileId, libraryId, itemKey: "ABCD2345"});
  await t.mutation(internal.authors.publications.replaceFromLibrary, {...args, revision: 3, profileIds: []});
  await t.mutation(internal.authors.publications.replaceFromLibrary, args);
  expect(await read()).toEqual([]);
});
