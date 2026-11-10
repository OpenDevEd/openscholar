import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { actorFor } from "../workspaces/actor";
import { activate, checked, passed, refused, row, setup, type World } from "./reports.test-support";

// Activating a report (#1261): only its workspace's admins, a free activation counted against the day's, and a paid
// one that comes back after its report moved on kept for a refund. The charge itself is Autumn's, behind the action.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.test");
  vi.stubEnv("EL_SMTP_HOST", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const activations = (world: World) => world.t.run((ctx) => ctx.db.query("reportActivations").take(20));
const emailed = async (world: World, key: string) => {
  await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  const { _id } = await row(world.t, key);
  return world.t.run(async (ctx) => (await ctx.db.query("reportEmails").withIndex("by_reportId", (q) => q.eq("reportId", _id)).take(50)).filter((email) => email.event !== "Registration refused").map((email) => `${email.audience}: ${email.event}`).sort());
};

describe("activating a report", () => {
  it("is for an admin of its workspace: an organisation's member who started it can't", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")], world.author, world.lab);
    await expect(activate(world, key, { as: "author", workspaceId: world.lab })).rejects.toMatchObject(refused("FORBIDDEN"));
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.lab, key, now: Date.now() })).toMatchObject({ admin: false, organization: "Learning Lab" });
    await activate(world, key, { as: "orgadmin", workspaceId: world.lab });
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ free: false, state: "live", charge: { invoice: `in_${key}` } }]);
  });

  it("is free while the workspace has free activations left today, and refused as free once they are used", async () => {
    const world = await setup();
    await world.reviewer.mutation(api.reports.settings.update, { perDay: 1 });
    const first = await checked(world, [passed("byline")]);
    await world.t.run(async (ctx) => {
      // A second start the same day: the plan's one a day is the author's own, so it is lifted here.
      await ctx.db.query("reportStarts").take(5).then((rows) => Promise.all(rows.map((started) => ctx.db.delete("reportStarts", started._id))));
    });
    const second = await checked(world, [passed("byline")]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key: first.key, now: Date.now() })).toMatchObject({ admin: true, organization: null, free: { perDay: 1, left: 1 } });
    await activate(world, first.key, { free: true });
    await expect(activate(world, second.key, { free: true })).rejects.toMatchObject(refused("CONFLICT"));
    expect(await row(world.t, second.key)).toMatchObject({ status: "passed" });
    // Paid for, it goes live, and the day's free one stays used.
    await activate(world, second.key);
    expect((await activations(world)).map((activation) => activation.free)).toEqual([true, false]);
  });

  it("refuses a report that is already live before anything is charged", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    await activate(world, key);
    const charged = await activations(world);
    await expect(activate(world, key)).rejects.toMatchObject(refused("CONFLICT"));
    expect(await activations(world)).toEqual(charged);
  });

  it("keeps a charge that comes back after its report moved on, and leaves the report as it was", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // A reviewer declines it while the bank answers: declined, it can't go live.
    await world.reviewer.mutation(api.reports.review.decide, { key, decision: "decline", seenPdfAt: (await row(world.t, key)).pdf!.at, note: "Not a report" });
    const actor = await world.t.run(async (ctx) => actorFor(ctx, (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "author")).unique())!, world.own));
    await world.t.mutation(internal.reports.activation.goLive, { actor, key, free: false, charge: { invoice: "in_late", total: 5, currency: "usd" } });
    expect(await row(world.t, key)).toMatchObject({ status: "declined" });
    expect(await activations(world)).toMatchObject([{ state: "unused", charge: { invoice: "in_late" } }]);
  });
});

describe("a member's report ready to activate", () => {
  it("tells the organisation's admins, and nobody when its starter can activate it", async () => {
    const world = await setup();
    const member = await checked(world, [passed("byline")], world.author, world.lab);
    const admin = await checked(world, [passed("byline")], world.orgAdmin, world.lab);
    const own = await checked(world, [passed("byline")]);
    expect(await emailed(world, member.key)).toEqual(["admins: Waiting for an admin"]);
    expect(await emailed(world, admin.key)).toEqual([]);
    expect(await emailed(world, own.key)).toEqual([]);
  });
});
