/**
 * Keeps a community's count of people (./directory.ts) as its team changes: someone given a role in
 * it, a role changed or taken away, or its organization's admins, who own it, changing. Scheduled,
 * so the change that triggers it isn't held up by reading the team. Kept apart from ./directory.ts
 * so the triggers that run on every write don't load it.
 */
import type { Change } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const recountPeople = makeFunctionReference<"mutation", { libraryId: Id<"evidenceLibraries"> }>("evidenceLibraries/directory:recountPeople");
const recountOrganization = makeFunctionReference<"mutation", { workspaceId: Id<"workspaces"> }>("evidenceLibraries/directory:recountOrganization");
const recountShared = makeFunctionReference<"mutation", { organizationId: Id<"organizations"> }>("evidenceLibraries/directory:recountShared");

/** An organization given a role in a community, its role changed, or taken away (#1091): all its members count, or stop counting. */
export async function recountOnOrganizationGrant(ctx: MutationCtx, change: Change<DataModel, "libraryOrganizationGrants">) {
  const grant = change.newDoc ?? change.oldDoc;
  if (!grant || (change.operation === "update" && change.oldDoc.role === change.newDoc.role)) return;
  await ctx.scheduler.runAfter(0, recountPeople, { libraryId: grant.libraryId });
}

/** A role given, changed or taken away in a community. */
export async function recountOnGrant(ctx: MutationCtx, change: Change<DataModel, "itemAccess">) {
  const grant = change.newDoc ?? change.oldDoc;
  if (grant?.kind !== "library") return;
  if (change.operation === "update" && change.oldDoc.role === change.newDoc.role) return;
  await ctx.scheduler.runAfter(0, recountPeople, { libraryId: grant.item as Id<"evidenceLibraries"> });
}

const isAdmin = (row: Doc<"organizationMemberships"> | null) => row?.role === "org:admin" && row.state === "active";

const isActive = (row: Doc<"organizationMemberships"> | null) => row?.state === "active";

/**
 * Someone becoming or ceasing to be an organization's admin, who own its communities; or joining or leaving
 * it, which counts them in or out of the communities shared with it (#1091).
 */
export async function recountOnMembership(ctx: MutationCtx, change: Change<DataModel, "organizationMemberships">) {
  const organizationId = (change.newDoc ?? change.oldDoc)!.organizationId;
  if (isActive(change.oldDoc) !== isActive(change.newDoc) && (await ctx.db.query("libraryOrganizationGrants").withIndex("by_organization_and_grantedAt", (q) => q.eq("organizationId", organizationId)).first())) {
    await ctx.scheduler.runAfter(0, recountShared, { organizationId });
  }
  if (isAdmin(change.oldDoc) === isAdmin(change.newDoc)) return;
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
  if (workspace) await ctx.scheduler.runAfter(0, recountOrganization, { workspaceId: workspace._id });
}
