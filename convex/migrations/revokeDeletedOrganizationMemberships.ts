import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Revokes the active memberships of organizations that were deleted (#427). Deleting an
 * organization now revokes them itself; before, they stayed active, and would count against
 * the organizations a person can belong to. Safe to run again.
 *
 *   npx convex run migrations/revokeDeletedOrganizationMemberships:run '{"dryRun": true}'
 *   npx convex run migrations/revokeDeletedOrganizationMemberships:run
 *   npx convex run migrations/revokeDeletedOrganizationMemberships:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** An active membership whose organization is deleted or gone. */
async function isLeftover(ctx: QueryCtx, membership: Doc<"organizationMemberships">) {
  return membership.state === "active" && (await ctx.db.get("organizations", membership.organizationId))?.state !== "active";
}

export const memberships = migrations.define({
  table: "organizationMemberships",
  migrateOne: async (ctx, membership) => {
    if (await isLeftover(ctx, membership)) await ctx.db.patch("organizationMemberships", membership._id, { state: "revoked", updatedAt: Date.now() });
  },
});

export const run = migrations.runner(internal.migrations.revokeDeletedOrganizationMemberships.memberships);

/** Active memberships on one page whose organization is deleted or gone. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("organizationMemberships").paginate({ cursor, numItems: 200 });
    let wrong = 0;
    for (const membership of page.page) if (await isLeftover(ctx, membership)) wrong++;
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many active memberships still point at a deleted organization; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.revokeDeletedOrganizationMemberships.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
