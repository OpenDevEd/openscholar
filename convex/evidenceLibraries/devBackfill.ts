import { v } from "convex/values";
import type { PaginationResult } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * One-off, development only. Sets `evidenceLibrariesEnabled` to `false` on
 * every organisation row that does not have it yet.
 *
 * Convex refuses to push a required field while older rows are missing it,
 * and it refuses to write a field the deployed schema does not declare. So
 * the field ships optional, this mutation fills the gap once on the shared
 * development deployment, and the follow-up change makes the field required
 * and deletes this file.
 *
 * Run it with:
 * `npx convex run evidenceLibraries/devBackfill:devBackfillEvidenceLibrariesEnabled '{}'`
 */
export const devBackfillEvidenceLibrariesEnabled = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), updated: v.number() }),
  handler: async (ctx) => {
    let cursor: string | null = null;
    let scanned = 0;
    let updated = 0;
    // Walks every page, so the answer does not depend on the table's size.
    for (;;) {
      const page: PaginationResult<Doc<"organizations">> = await ctx.db
        .query("organizations")
        .paginate({ cursor, numItems: 200 });
      for (const organization of page.page) {
        scanned += 1;
        if (organization.evidenceLibrariesEnabled === undefined) {
          await ctx.db.patch("organizations", organization._id, {
            evidenceLibrariesEnabled: false,
          });
          updated += 1;
        }
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { scanned, updated };
  },
});

/**
 * Development only. Flips the switch on one organisation without going
 * through Clerk, so the browser check on a lane deployment can prove both
 * states. The real switch is Clerk public metadata.
 */
export const devSetEvidenceLibrariesEnabled = internalMutation({
  args: {
    clerkOrganizationId: v.string(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (query) =>
        query.eq("clerkOrganizationId", args.clerkOrganizationId),
      )
      .unique();
    if (!organization) {
      throw new Error(`No organization row for ${args.clerkOrganizationId}`);
    }
    await ctx.db.patch("organizations", organization._id, {
      evidenceLibrariesEnabled: args.enabled,
    });
    return null;
  },
});
