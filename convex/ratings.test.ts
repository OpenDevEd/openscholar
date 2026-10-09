// A saved paper's rating as its people's average of their own (#655).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { ensureWorkspace } from "./workspaces/create";

// An organization's averages move in transactions of their own, which these tests let finish.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("rates an organization's paper with its members' average, and shows each member their own", async () => {
  const t = convexTest(schema);
  const { lab, bobMembership } = await t.run(async (ctx) => {
    for (const clerkId of ["alice", "bob"]) await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "org_lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const member = (clerkUserId: string) => ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    await member("alice");
    return { bobMembership: await member("bob"), lab: await ensureWorkspace(ctx, { kind: "organization", organizationId }) };
  });
  const [alice, bob] = ["alice", "bob"].map((subject) => t.withIdentity({ subject }));
  const shown = async (as: typeof alice) => {
    const { page } = await as.query(api.library.queries.browseLibrary, { workspaceId: lab, sortBy: "rating", sortOrder: "desc", paginationOpts: { cursor: null, numItems: 10 } });
    return page.map(({ openalexId, rating, myRating }) => [openalexId, rating, myRating]);
  };
  const settled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  // Alice saves two papers to the lab, rated. Bob rates one of them on a search card, which counts in the lab too.
  await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId: lab, openalexId: "https://openalex.org/W1", title: "One", rating: 4 });
  await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId: lab, openalexId: "https://openalex.org/W2", title: "Two", rating: 3 });
  await bob.mutation(api.research.records.change, { accountId: "bob", requestId: "rated", command: { kind: "rating", paperId: "https://openalex.org/W1", rating: 1 } });
  await settled();
  // The lab sorts by the average; each sees their own stars.
  expect(await shown(alice)).toEqual([["https://openalex.org/W2", 3, 3], ["https://openalex.org/W1", 2.5, 4]]);
  expect(await shown(bob)).toEqual([["https://openalex.org/W2", 3, undefined], ["https://openalex.org/W1", 2.5, 1]]);

  // Someone who leaves takes their ratings out of the lab's averages, and brings them back on rejoining.
  const membership = (state: "active" | "revoked") => t.run((ctx) => ctx.db.patch("organizationMemberships", bobMembership, { state }));
  await membership("revoked");
  await settled();
  expect(await shown(alice)).toEqual([["https://openalex.org/W1", 4, 4], ["https://openalex.org/W2", 3, 3]]);
  await membership("active");
  await settled();
  expect(await shown(alice)).toEqual([["https://openalex.org/W2", 3, 3], ["https://openalex.org/W1", 2.5, 4]]);
});
