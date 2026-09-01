import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/** Sets the authoritative verification zone on the existing development rows. */
export const run = internalMutation({
  args: {
    updates: v.array(
      v.object({
        domainId: v.id("evidenceLibraryDomains"),
        verificationHost: v.string(),
      }),
    ),
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    let updated = 0;
    for (const update of args.updates) {
      const row = await ctx.db.get("evidenceLibraryDomains", update.domainId);
      if (!row) continue;
      const ownsHost =
        row.host === update.verificationHost ||
        row.host.endsWith(`.${update.verificationHost}`);
      if (!ownsHost) throw new Error("Verification zone does not own the host");
      await ctx.db.patch(row._id, {
        verificationHost: update.verificationHost,
      });
      updated += 1;
    }
    return { updated };
  },
});
