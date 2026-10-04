// The Evidence Library list, read a page at a time on the server (#423): the libraries of each
// organization a person owns, then the ones they were granted, with its filters, its count,
// the organizations its filter offers, and the backfill of the count.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";

const modules = import.meta.glob("/convex/**/*.ts");
const stamp = { clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 };

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    for (const clerkId of ["me", "someone"]) await ctx.db.insert("users", { libraryItemCount: 0, clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 });
    const organization = (name: string) => ctx.db.insert("organizations", { clerkOrganizationId: `org_${name}`, evidenceLibrariesEnabled: true, name, slug: name.toLowerCase(), state: "active", ...stamp });
    const [beta, alpha, partner] = [await organization("Beta"), await organization("Alpha"), await organization("Partner")];
    for (const organizationId of [beta, alpha]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `membership-${organizationId}`, clerkUserId: "me", role: "org:admin", state: "active", ...stamp });
    const library = (organizationId: Id<"organizations">, name: string) =>
      ctx.db.insert("evidenceLibraries", { organizationId, name, slug: name.toLowerCase().replaceAll(" ", "-"), state: "active", createdByClerkUserId: "someone", updatedByClerkUserId: "someone", createdAt: 1, updatedAt: 1 });
    await library(beta, "Beta one");
    for (const name of ["Alpha one", "Alpha two", "Alpha three"]) await library(alpha, name);
    const shared = await library(partner, "Shared reading");
    await library(partner, "Not mine");
    await ctx.db.insert("evidenceLibraryMembers", { libraryId: shared, clerkUserId: "me", role: "editor", grantedBy: "someone", grantedAt: 1 });
    // A grant inside an organization the person owns lists once, as its owner.
    const owned = (await ctx.db.query("evidenceLibraries").withIndex("by_organizationId", (q) => q.eq("organizationId", alpha)).first())!;
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
      const library = (await ctx.db.query("evidenceLibraries").withIndex("by_organizationId", (q) => q.eq("organizationId", beta)).first())!;
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

  it("counts the libraries made before the list paged, once however often the backfill runs", async () => {
    vi.useFakeTimers();
    try {
      const { t, me, alpha } = await setup();
      const before = await me.query(api.evidenceLibraries.queries.countLibraries, {});
      // As libraries made before the count: written without the trigger that keeps it.
      await runUntriggered(t, async (ctx) => {
        for (const name of ["Older one", "Older two"]) await ctx.db.insert("evidenceLibraries", { organizationId: alpha, name, slug: name.toLowerCase().replace(" ", "-"), state: "active", createdByClerkUserId: "someone", updatedByClerkUserId: "someone", createdAt: 1, updatedAt: 1 });
      });
      expect(await t.action(internal.migrations.pagedLibraryList.verify, {})).toBe(2);
      for (let runs = 0; runs < 2; runs++) {
        await t.mutation(internal.migrations.pagedLibraryList.run, {});
        await t.finishAllScheduledFunctions(vi.runAllTimers);
      }
      expect(await t.action(internal.migrations.pagedLibraryList.verify, {})).toBe(0);
      expect(await me.query(api.evidenceLibraries.queries.countLibraries, {})).toBe(before + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
