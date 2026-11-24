import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { INTAKE_OFF } from "../../lib/reports/intake";

/**
 * New reports got a switch of their own, off until an admin opens them (reports/intake.ts). On a deployment where
 * publishing was already on, this opens them with no limit, so the deploy closes nothing; one with publishing off
 * keeps them off. Run once per deployment right after its Convex push, then drop this file:
 *   npx convex run migrations/reportIntake:run
 * Safe to run again: settings that have new reports saved are left as they are.
 */
export const run = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await ctx.db.query("reportSettings").first();
    if (!row || row.intake) {
      console.log(JSON.stringify({ event: "report-intake-migration", changed: false }));
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("reportSettings", row._id, { intake: { ...INTAKE_OFF, mode: row.enabled ? "on" : "off", openedAt: row.enabled ? now : null }, updatedAt: now });
    console.log(JSON.stringify({ event: "report-intake-migration", changed: true, mode: row.enabled ? "on" : "off" }));
    return null;
  },
});
