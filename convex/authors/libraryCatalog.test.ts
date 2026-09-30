import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob("/convex/**/*.ts");

async function setupCatalog() {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async ctx => {
    await seedOrganizationFeatures(ctx, ["profile-owner", "library-owner"], { authors: true });
    for (const clerkId of ["profile-owner", "library-owner"]) {
      await ctx.db.insert("users", {libraryItemCount: 0, clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1});
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
    body: JSON.stringify({libraryId, ...(body.operation === "resolve" ? {} : {clerkUserId: "library-owner"}), ...(body.operation === "search" ? {paginationOpts: {cursor: null, numItems: 12}} : {}), ...body}),
  });
  return {t, libraryId, profileOwner, otherProfile, service, request};
}

it("creates profiles for the library caller but does not give library owners edit access to other profiles", async () => {
  const {t, profileOwner, otherProfile, service, request} = await setupCatalog();
  expect((await request({operation: "search", search: ""}, "els_" + "b".repeat(43))).status).toBe(401);
  expect((await request({operation: "search", search: "", clerkUserId: "profile-owner"})).status).toBe(403);
  const found = await t.query(internal.authors.libraryCatalog.search, {...service, search: "Caitlin", paginationOpts: {cursor: null, numItems: 12}});
  expect(found.profiles[0]).toMatchObject({id: otherProfile, name: "Caitlin Mills"});
  await expect(t.query(internal.authors.libraryCatalog.search, {...service, search: "", clerkUserId: "profile-owner", paginationOpts: {cursor: null, numItems: 12}})).rejects.toThrow();
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

it("resolves current public profile metadata without a reader account or profile edit access", async () => {
  const {t, profileOwner, otherProfile, request} = await setupCatalog();
  const content = {name: "Caitlin Mills", headline: "Professor", affiliation: "University of Minnesota", bio: "Research on learning", website: "https://example.org", linkedin: "", orcid: "0000-0002-1825-0097", openalex: "A123456"};
  await profileOwner.action(api.authors.photos.save, {profileId: otherProfile, expectedRevision: 1, content});
  const read = () => request({operation: "resolve", profileIds: [otherProfile, otherProfile, "missing"]});
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(await response.json()).toEqual({profiles: [{id: otherProfile, revision: 2, photo: null, ...content, website: "https://example.org/"}]});
  await profileOwner.action(api.authors.photos.save, {profileId: otherProfile, expectedRevision: 2, content: {...content, name: "Updated name", affiliation: "Updated affiliation"}});
  expect((await (await read()).json()).profiles[0]).toMatchObject({revision: 3, name: "Updated name", affiliation: "Updated affiliation"});
  expect((await request({operation: "resolve", profileIds: [otherProfile]}, "els_" + "b".repeat(43))).status).toBe(403);
  expect((await request({operation: "resolve", profileIds: Array(101).fill(otherProfile)})).status).toBe(400);
  await t.run(async ctx => {
    const credential = await ctx.db.query("evidenceLibraryCredentials").first();
    await ctx.db.delete("evidenceLibraryCredentials", credential!._id);
  });
  expect((await read()).status).toBe(403);
});

it("paginates indexed library search beyond a thousand authors without omitting or repeating profiles", async () => {
  const {t, request, otherProfile} = await setupCatalog();
  const inserted = await t.run(async ctx => {
    const owner = (await ctx.db.get("authorProfiles", otherProfile))!.ownerId;
    const ids = [];
    for (let i = 0; i < 1003; i++) ids.push(await ctx.db.insert("authorProfiles", {
      ownerId: owner, name: `Catalogpagination Researcher ${String(i).padStart(4, "0")}`,
      headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: "", revision: 1, updatedAt: 1,
    }));
    return ids;
  });
  let cursor: string | null = null;
  const seen: string[] = [];
  for (let page = 0; page < 35; page++) {
    const response = await request({operation: "search", search: "Catalogpagination", paginationOpts: {cursor, numItems: 30}});
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.profiles.length).toBeLessThanOrEqual(30);
    seen.push(...result.profiles.map((profile: {id: string}) => profile.id));
    cursor = result.continueCursor;
    if (result.isDone) { expect(cursor).toBeNull(); break; }
    expect(cursor).not.toBeNull();
  }
  expect(seen.length).toBe(1003);
  expect(new Set(seen)).toEqual(new Set(inserted));
  const exact = await request({operation: "search", search: "1002"});
  expect((await exact.json()).profiles.map((profile: {id: string}) => profile.id)).toEqual([inserted[1002]]);
  expect((await request({operation: "search", search: "", paginationOpts: {cursor: null, numItems: 1000}})).status).toBe(400);
});
