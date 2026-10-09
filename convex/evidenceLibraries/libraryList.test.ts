// The Evidence Library list, read a page at a time on the server (#423): the libraries of each
// organization a person owns, then the ones they were granted, with its filters, its count,
// the organizations its filter offers, and the backfill of the count.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { countOf, workspaceLibrariesOf } from "../lib/listCounts";
import { organizationWorkspaceOf } from "../workspaces/personal";

const modules = import.meta.glob("/convex/**/*.ts");
const stamp = { clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 };

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    for (const clerkId of ["me", "someone"]) await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 });
    const organization = (name: string) => ctx.db.insert("organizations", { clerkOrganizationId: `org_${name}`, evidenceLibrariesEnabled: true, name, slug: name.toLowerCase(), state: "active", ...stamp });
    const [beta, alpha, partner] = [await organization("Beta"), await organization("Alpha"), await organization("Partner")];
    for (const organizationId of [beta, alpha]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `membership-${organizationId}`, clerkUserId: "me", role: "org:admin", state: "active", ...stamp });
    const library = async (organizationId: Id<"organizations">, name: string) =>
      ctx.db.insert("evidenceLibraries", { workspaceId: await organizationWorkspaceOf(ctx, organizationId), name, slug: name.toLowerCase().replaceAll(" ", "-"), state: "active", createdByClerkUserId: "someone", updatedByClerkUserId: "someone", createdAt: 1, updatedAt: 1 });
    await library(beta, "Beta one");
    for (const name of ["Alpha one", "Alpha two", "Alpha three"]) await library(alpha, name);
    const shared = await library(partner, "Shared reading");
    await library(partner, "Not mine");
    await ctx.db.insert("evidenceLibraryMembers", { libraryId: shared, clerkUserId: "me", role: "editor", grantedBy: "someone", grantedAt: 1 });
    // A grant inside an organization the person owns lists once, as its owner.
    const alphaWorkspace = await organizationWorkspaceOf(ctx, alpha);
    const owned = (await ctx.db.query("evidenceLibraries").collect()).find((library) => library.workspaceId === alphaWorkspace)!;
    await ctx.db.insert("evidenceLibraryMembers", { libraryId: owned._id, clerkUserId: "me", role: "creator", grantedBy: "someone", grantedAt: 1 });
    return { alpha, beta, partner };
  });
  return { t, me: t.withIdentity({ subject: "me" }), ...ids };
}

type Me = Awaited<ReturnType<typeof setup>>["me"];
async function names(me: Me, filters: { search?: string; organization?: Id<"organizations"> } = {}, numItems = 2) {
  const seen: string[][] = [];
  let cursor: string | null = null;
  for (let reads = 0; reads < 10; reads++) {
    const page: { page: Array<{ name: string; role: string }>; isDone: boolean; continueCursor: string } = await me.query(api.evidenceLibraries.queries.listLibraries, { ...filters, paginationOpts: { cursor, numItems } });
    seen.push(page.page.map((library) => `${library.name} (${library.role})`));
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return seen;
}

describe("the library list", () => {
  it("steps through each owned organization by name, then the granted libraries, without repeating one", async () => {
    const { me } = await setup();
    expect((await names(me)).flat()).toEqual(["Alpha one (owner)", "Alpha two (owner)", "Alpha three (owner)", "Beta one (owner)", "Shared reading (editor)"]);
    // A page fills from the next organization when one runs out.
    expect((await names(me, {}, 4))[0]).toEqual(["Alpha one (owner)", "Alpha two (owner)", "Alpha three (owner)", "Beta one (owner)"]);
  });

  it("goes on from the next organization when the one a page stopped in is no longer the person's", async () => {
    const { t, me, alpha } = await setup();
    const first = await me.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 2 } });
    expect(first.page.map((library) => library.name)).toEqual(["Alpha one", "Alpha two"]);
    await t.run(async (ctx) => {
      const membership = (await ctx.db.query("organizationMemberships").collect()).find((row) => row.organizationId === alpha)!;
      await ctx.db.delete(membership._id);
    });
    const rest = await me.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: first.continueCursor, numItems: 10 } });
    // Alpha one stays: the person holds a grant to it, so it now lists with the granted libraries.
    expect(rest.page.map((library) => `${library.name} (${library.role})`)).toEqual(["Beta one (owner)", "Shared reading (editor)", "Alpha one (creator)"]);
    expect(rest.isDone).toBe(true);
  });

  it("keeps one organization's libraries, or those whose name or organization contains the search", async () => {
    const { me, alpha, partner } = await setup();
    expect((await names(me, { organization: alpha }, 10)).flat()).toEqual(["Alpha one (owner)", "Alpha two (owner)", "Alpha three (owner)"]);
    expect((await names(me, { organization: partner }, 10)).flat()).toEqual(["Shared reading (editor)"]);
    expect((await names(me, { search: " TWO" }, 10)).flat()).toEqual(["Alpha two (owner)"]);
    expect((await names(me, { search: "partner" }, 10)).flat()).toEqual(["Shared reading (editor)"]);
    expect((await names(me, { search: "nothing like it" }, 10)).flat()).toEqual([]);
  });

  it("counts the libraries a person can open, and names the organizations they belong to", async () => {
    const { t, me, beta } = await setup();
    expect(await me.query(api.evidenceLibraries.queries.countLibraries, {})).toBe(5);
    expect((await me.query(api.evidenceLibraries.queries.listLibraryOwners, {})).page.map((owner) => owner.name)).toEqual(["Alpha", "Beta", "Partner"]);

    await t.run(async (ctx) => {
      const betaWorkspace = await organizationWorkspaceOf(ctx, beta);
      const library = (await ctx.db.query("evidenceLibraries").collect()).find((row) => row.workspaceId === betaWorkspace)!;
      await ctx.db.delete(library._id);
    });
    expect(await me.query(api.evidenceLibraries.queries.countLibraries, {})).toBe(4);
    // An organization left with no library leaves the filter.
    expect((await me.query(api.evidenceLibraries.queries.listLibraryOwners, {})).page.map((owner) => owner.name)).toEqual(["Alpha", "Partner"]);
    // Someone signed out, or with no library, reads an empty list.
    const stranger = t.withIdentity({ subject: "someone" });
    expect(await stranger.query(api.evidenceLibraries.queries.countLibraries, {})).toBe(0);
    expect((await stranger.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
  });

  it("forgets its kept counts when the libraries are replaced without their triggers, as CI's test backend's are", async () => {
    const { t, alpha } = await setup();
    const counted = () => t.run(async (ctx) => countOf(ctx, workspaceLibrariesOf((await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", alpha)).unique())!._id)));
    const before = await counted();
    expect(before).toBeGreaterThan(0);
    // As CI's import does: the rows go, and the counts kept from them stay.
    await runUntriggered(t, async (ctx) => {
      for (const library of await ctx.db.query("evidenceLibraries").collect()) await ctx.db.delete("evidenceLibraries", library._id);
    });
    expect(await counted()).toBe(before);
    // Twice: a count it already forgot is not cleared again.
    for (let resets = 0; resets < 2; resets++) await t.action(internal.migrations.pagedLibraryList.reset, {});
    expect(await counted()).toBe(0);
  });
});
