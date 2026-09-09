/// <reference types="vite/client" />
import { createHash } from "node:crypto";
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
    await ctx.db.insert("evidenceLibraryCredentials", {libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update("els_" + "a".repeat(43)).digest("hex"), validationState: "valid", createdByClerkUserId: "library-owner", updatedByClerkUserId: "library-owner", createdAt: 1, updatedAt: 1});
    return libraryId;
  });
  const profileOwner = t.withIdentity({subject: "profile-owner"});
  const otherProfile = await profileOwner.mutation(api.authors.profiles.create, {name: "Caitlin Mills"});
  const service = {libraryId, credentialDigest: createHash("sha256").update("els_" + "a".repeat(43)).digest("hex"), clerkUserId: "library-owner"};
  const request = (body: Record<string, unknown>, credential = "els_" + "a".repeat(43)) => t.fetch("/api/v1/evidence-libraries/author-profiles", {
    method: "POST", headers: {Authorization: `Bearer ${credential}`, "Content-Type": "application/json"},
    body: JSON.stringify({libraryId, clerkUserId: "library-owner", ...body}),
  });
  expect((await request({operation: "search", search: ""}, "els_" + "b".repeat(43))).status).toBe(401);
  expect((await request({operation: "search", search: "", clerkUserId: "profile-owner"})).status).toBe(403);
  const found = await t.query(internal.authors.libraryCatalog.search, {...service, search: "Caitlin"});
  expect(found[0]).toMatchObject({id: otherProfile, canEdit: false});
  await expect(t.query(internal.authors.libraryCatalog.search, {...service, search: "", clerkUserId: "profile-owner"})).rejects.toThrow();
  expect((await request({operation: "create", name: "  "})).status).toBe(400);
  expect((await request({operation: "create", name: "Another name", profileId: otherProfile})).status).toBe(400);
  expect((await request({operation: "save", name: "Another name", profileId: otherProfile})).status).toBe(400);
  const response = await request({operation: "create", name: "  Library-created author  "});
  expect(response.status).toBe(200);
  const created = (await response.json()).profiles[0];
  expect(created).toMatchObject({name: "Library-created author", revision: 1, canEdit: true, bio: "", affiliation: ""});
  const libraryOwner = t.withIdentity({subject: "library-owner"});
  const profile = await libraryOwner.query(api.authors.profiles.get, {profileId: created.id});
  expect(profile?.role).toBe("owner");
  expect((await profileOwner.query(api.authors.profiles.get, {profileId: created.id}))?.role).toBeNull();
  expect((await profileOwner.query(api.authors.profiles.get, {profileId: otherProfile}))?.name).toBe("Caitlin Mills");
});
