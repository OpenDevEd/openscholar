import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { clerkRequest, clerkSecretKey, isRecord } from "../lib/clerk";

/**
 * Clears the logo Clerk made for an organization whose admins uploaded none, kept from before
 * the webhook kept only uploaded ones (#651): those get one drawn in the organization's colour.
 * Clerk says which logos were uploaded (`has_image`).
 *
 *   npx convex run migrations/organizationLogos:run
 *   npx convex run migrations/organizationLogos:verify
 */
const PAGE = 100;

/** One page of organizations, those of them with a logo kept. */
export const page = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ withLogo: v.array(v.object({ organizationId: v.id("organizations"), clerkOrganizationId: v.string(), imageUrl: v.string() })), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const read = await ctx.db.query("organizations").paginate({ cursor, numItems: PAGE });
    const withLogo = read.page.flatMap((organization) => (organization.imageUrl ? [{ organizationId: organization._id, clerkOrganizationId: organization.clerkOrganizationId, imageUrl: organization.imageUrl }] : []));
    return { withLogo, isDone: read.isDone, continueCursor: read.continueCursor };
  },
});

/** Clears an organization's logo, unless another has been kept since it was read. */
export const clear = internalMutation({
  args: { organizationId: v.id("organizations"), imageUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, { organizationId, imageUrl }) => {
    const organization = await ctx.db.get("organizations", organizationId);
    if (organization?.imageUrl === imageUrl) await ctx.db.patch("organizations", organizationId, { imageUrl: undefined });
    return null;
  },
});

/** The organizations whose kept logo Clerk made, clearing them with `fix`; how many there were. */
async function made(ctx: ActionCtx, fix: boolean) {
  let count = 0;
  for (let cursor: string | null = null; ;) {
    const read: { withLogo: { organizationId: Id<"organizations">; clerkOrganizationId: string; imageUrl: string }[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.organizationLogos.page, { cursor });
    for (const organization of read.withLogo) {
      const { body } = await clerkRequest(clerkSecretKey(), "GET", `/organizations/${organization.clerkOrganizationId}`).catch((error: unknown) => {
        console.error(`[organizationLogos] couldn't read ${organization.clerkOrganizationId} from Clerk`, error);
        return { body: null };
      });
      if (!isRecord(body) || body.has_image === true) continue;
      count++;
      if (fix) await ctx.runMutation(internal.migrations.organizationLogos.clear, { organizationId: organization.organizationId, imageUrl: organization.imageUrl });
    }
    if (read.isDone) return count;
    cursor = read.continueCursor;
  }
}

export const run = internalAction({ args: {}, returns: v.number(), handler: (ctx) => made(ctx, true) });

/** How many organizations still keep a logo Clerk made; 0 when done. */
export const verify = internalAction({ args: {}, returns: v.number(), handler: (ctx) => made(ctx, false) });
