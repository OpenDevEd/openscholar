// Who owns an Evidence Library once libraries belong to a workspace (#650): an organization's admins, or the person whose own workspace it's in.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { readLibraryRole } from "./access";
import { organizationWorkspaceOf } from "../workspaces/personal";

const modules = import.meta.glob("/convex/**/*.ts");

it("makes the person whose own workspace a library is in its owner, and an organization's admins the owners of its libraries", async () => {
  const t = convexTest(schema, modules);
  const { roles, team } = await t.run(async (ctx) => {
    const fields = { state: "active" as const, createdAt: 1, updatedAt: 1 };
    const ada = await ctx.db.insert("users", { ...fields, clerkId: "ada", email: "ada@example.org" });
    await ctx.db.insert("users", { ...fields, clerkId: "ben", email: "ben@example.org" });
    const team = await seedOrganizationFeatures(ctx, ["ada", "ben"], { evidenceLibraries: true });
    const admin = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", team).eq("clerkUserId", "ada").eq("state", "active")).unique();
    await ctx.db.patch("organizationMemberships", admin!._id, { role: "org:admin" });
    const base = { state: "active" as const, createdByClerkUserId: "ada", updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 };
    const mine = (await ctx.db.get("evidenceLibraries", await ctx.db.insert("evidenceLibraries", { ...base, name: "Mine", slug: "mine", workspaceId: await personalWorkspaceOf(ctx, ada) })))!;
    await ctx.db.insert("evidenceLibraryMembers", { libraryId: mine._id, clerkUserId: "ben", role: "editor", grantedBy: "ada", grantedAt: 1 });
    const theirs = (await ctx.db.get("evidenceLibraries", await ctx.db.insert("evidenceLibraries", { ...base, name: "Team", slug: "team", workspaceId: await organizationWorkspaceOf(ctx, team) })))!;
    const roles = {
      mine: [await readLibraryRole(ctx, mine, "ada"), await readLibraryRole(ctx, mine, "ben")],
      team: [await readLibraryRole(ctx, theirs, "ada"), await readLibraryRole(ctx, theirs, "ben")],
    };
    return { roles, team };
  });
  // Ben edits it on a grant of Ada's.
  expect(roles).toEqual({ mine: ["owner", "editor"], team: ["owner", null] });
  // Once Ada's account is deleted, her own library is closed to everyone, as a deleted organization's are.
  expect(await t.run(async (ctx) => {
    const ada = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "ada")).unique())!;
    await ctx.db.patch("users", ada._id, { state: "deleted" });
    const mine = (await ctx.db.query("evidenceLibraries").collect()).find((library) => library.name === "Mine")!;
    return await readLibraryRole(ctx, mine, "ben");
  })).toBeNull();
  await t.run(async (ctx) => {
    const ada = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "ada")).unique())!;
    await ctx.db.patch("users", ada._id, { state: "active" });
  });
  // Her own library lists in her own workspace, with her name on it; her organization's in its own.
  const ada = t.withIdentity({ subject: "ada" });
  const listed = async (organization?: Id<"organizations">) =>
    (await ada.query(api.evidenceLibraries.queries.listLibraries, { ...(organization ? { organization } : {}), paginationOpts: { cursor: null, numItems: 10 } })).page.map((library) => [library.name, library.role, library.organization.name]);
  expect(await listed()).toEqual([["Mine", "owner", "ada@example.org"]]);
  expect(await listed(team)).toEqual([["Team", "owner", "Feature test"]]);
});
