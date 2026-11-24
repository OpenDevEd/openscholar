// Whether new reports are open (lib/reports/intake.ts): off, on, or between dates, with limits on activations a day,
// a week, a month or the whole time open. Admins set it at Settings > Admin > Publishing. Signing a new report and
// activating one refuse while it is closed; the Publish page works out the same from what `forAuthors` sends.
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { intakeAt, intakeProblem, nthsOf, usedAt, type Intake, type IntakeState } from "../../lib/reports/intake";
import { REPORT_DEFAULTS } from "../../lib/reports/settings";
import { intakeFields, intakeValidator, limitUsesValidator } from "./validators";
import { reportSettings, saveSettings, settingsRow } from "./settings";

/** The activations a limit counts: one under way, one waiting on its payment, and one that went live. */
const COUNTED = ["charging", "pending", "live"] as const;

/** Intake as saved, or off when none is: new reports stay closed until an admin opens them. */
export const intakeOf = (row: { intake?: Intake } | null) => row?.intake ?? REPORT_DEFAULTS.intake;

/**
 * The times of the latest activations that count, newest first: as many as the largest limit, which is all any limit
 * needs (`nthsOf`). None without a limit.
 */
export async function latestActivations(ctx: QueryCtx, intake: Intake): Promise<number[]> {
  const most = Math.max(0, ...intake.limits.map((limit) => limit.count));
  if (intake.mode === "off" || most === 0) return [];
  const lists = await Promise.all(COUNTED.map((state) => ctx.db.query("reportActivations").withIndex("by_state_and_at", (q) => q.eq("state", state)).order("desc").take(most)));
  return lists
    .flat()
    .map((row) => row.at)
    .sort((a, b) => b - a)
    .slice(0, most);
}

const CLOSED: Record<Exclude<IntakeState, { open: true }>["why"], string> = {
  off: "New reports are closed for now. Your report keeps its place.",
  notYet: "New reports aren't open yet. Your report keeps its place.",
  ended: "This period for new reports is over. Your report keeps its place.",
  full: "This period for new reports is over. Your report keeps its place until the next one.",
};

/**
 * Refuses a new report, or an activation, while new reports are closed. Read in the mutation that starts it, so two
 * people taking the last place at once can't both have it: the second is run again and refused.
 */
export async function refuseClosed(ctx: QueryCtx, intake: Intake) {
  const state = intakeAt(intake, nthsOf(intake.limits, await latestActivations(ctx, intake)), Date.now());
  if (!state.open) throw createError("FEATURE_DISABLED", CLOSED[state.why], { reason: "intake" });
}

/**
 * What the admin's New reports section shows: the settings, and for each limit the activations counted in its period
 * at `now`, which the page gives to the minute, and its `nth`.
 */
export const admin = query({
  args: { now: v.number() },
  returns: v.object({ intake: intakeValidator, uses: limitUsesValidator }),
  handler: async (ctx, { now }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const { intake } = await reportSettings(ctx);
    const latest = await latestActivations(ctx, intake);
    return { intake, uses: intake.limits.map((limit) => ({ id: limit.id, used: usedAt(limit, intake, latest, now), nth: latest[limit.count - 1] ?? null })) };
  },
});

/**
 * Saves what changed of New reports, over what is saved: an admin changing one part never puts back another that a
 * second admin changed meanwhile. The whole is checked once merged, as its parts depend on each other (`intakeProblem`).
 */
export const save = mutation({
  args: {
    mode: v.optional(intakeFields.mode),
    opensAt: v.optional(intakeFields.opensAt),
    closesAt: v.optional(intakeFields.closesAt),
    timezone: v.optional(intakeFields.timezone),
    limits: v.optional(intakeFields.limits),
  },
  returns: v.null(),
  handler: async (ctx, asked) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const row = await settingsRow(ctx);
    const saved = intakeOf(row);
    const now = Date.now();
    // Switched on, or from on to between dates and back, "in total" counts from now.
    const merged = { ...saved, ...asked };
    const intake: Intake = { ...merged, openedAt: merged.mode !== "off" && merged.mode !== saved.mode ? now : saved.openedAt };
    const problem = intakeProblem(intake, now, saved);
    if (problem) throw createError("VALIDATION_ERROR", problem);
    await saveSettings(ctx, row._id, { intake });
    return null;
  },
});
