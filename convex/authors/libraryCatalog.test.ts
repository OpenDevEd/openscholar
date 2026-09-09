/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob("/convex/**/*.ts");

it("creates profiles for the library caller but does not give library owners edit access to other profiles", async () => {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async ctx => {
    for (const clerkId of ["profile-owner", "library-owner"]) {
      await ctx.db.insert("users", {clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1});
    }
    const organizationId = await ctx.db.insert("organizations", {clerkOrganizationId: "org_catalog", evidenceLibrariesEnabled: true, name: "Library", slug: "library", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1});
    await ctx.db.insert("organizationMemberships", {organizationId, clerkMembershipId: "membership", clerkUserId: "library-owner", role: "org:admin", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1});
    const libraryId = await ctx.db.insert("evidenceLibraries", {organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "library-owner", updatedByClerkUserId: "library-owner", createdAt: 1, updatedAt: 1});
    await ctx.db.insert("evidenceLibraryCredentials", {libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: "digest", validationState: "valid", createdByClerkUserId: "library-owner", updatedByClerkUserId: "library-owner", createdAt: 1, updatedAt: 1});
    return libraryId;
  });
  const profileOwner = t.withIdentity({subject: "profile-owner"});
  const otherProfile = await profileOwner.mutation(api.authors.profiles.create, {name: "Caitlin Mills"});
  const service = {libraryId, credentialDigest: "digest", clerkUserId: "library-owner"};
  const content = {name: "Caitlin Mills", affiliation: "Minnesota", bio: "Learning science", website: "", orcid: ""};
  const found = await t.query(internal.authors.libraryCatalog.search, {...service, search: "Caitlin"});
  expect(found[0]).toMatchObject({id: otherProfile, canEdit: false});
  await expect(t.mutation(internal.authors.libraryCatalog.save, {...service, ...content, profileId: otherProfile, expectedRevision: 1})).rejects.toThrow();
  await expect(t.query(internal.authors.libraryCatalog.search, {...service, search: "", clerkUserId: "profile-owner"})).rejects.toThrow();
  const profileId = await t.mutation(internal.authors.libraryCatalog.save, {...service, ...content});
  const libraryOwner = t.withIdentity({subject: "library-owner"});
  expect((await libraryOwner.query(api.authors.profiles.get, {profileId}))?.role).toBe("owner");
  await t.mutation(internal.authors.libraryCatalog.save, {...service, ...content, profileId, expectedRevision: 1, bio: "Updated"});
  await expect(t.mutation(internal.authors.libraryCatalog.save, {...service, ...content, profileId, expectedRevision: 1})).rejects.toThrow();
});
