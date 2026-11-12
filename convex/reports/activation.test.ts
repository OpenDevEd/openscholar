import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { actorFor } from "../workspaces/actor";
import { activate, checked, passed, refused, row, setup, type World } from "./reports.test-support";

// Activating a report (#1261): only its workspace's admins, one spent from the workspace's balance of activations
// before anything is bought, and one bought for a report that then moved on kept in that balance. The balance and the
// charge are Autumn's, behind the action: its answers here are stubbed.
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
const actorOf = (world: World, clerkId: string, workspaceId: World["own"]) =>
  world.t.run(async (ctx) => actorFor(ctx, (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique())!, workspaceId));
const emailed = async (world: World, key: string) => {
  await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  const { _id } = await row(world.t, key);
  return world.t.run(async (ctx) => (await ctx.db.query("reportEmails").withIndex("by_reportId", (q) => q.eq("reportId", _id)).take(50)).filter((email) => email.event !== "Registration refused").map((email) => `${email.audience}: ${email.event}`).sort());
};

/**
 * Autumn and Stripe as the action reaches them. Autumn's balance of activations starts at `balance`, a purchase adds
 * one, a hold takes one and a release gives it back. `due` is what a quote with a code comes to, in US dollars. The
 * customer has a card only with `card`. With `lost`, Autumn makes the purchase but its answer never arrives, and the
 * customer's invoices then hold `lost`. Stripe has every invoice paid, at $5. Answers the calls made to Autumn, in order.
 */
function autumnStub({ balance, card = false, due = () => 5, dropFirstQuote = false, lost }: { balance: number; card?: boolean; due?: (code: string | undefined) => number; dropFirstQuote?: boolean; lost?: { status: string; stripe_id: string } }) {
  vi.stubEnv("AUTUMN_URL", "https://autumn.test");
  vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_fake");
  const asked: Array<Record<string, unknown> & { path: string }> = [];
  let left = balance;
  let dropped = !dropFirstQuote;
  let bought = false;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://api.stripe.com")) return Response.json({ id: "in_late", status: "paid", total: 500, currency: "usd", payments: { data: [] } });
    const path = url.split("/v1/")[1]!;
    const body = JSON.parse(String(init?.body ?? "{}")) as { customer_id?: string; email?: string; feature_id?: string; required_balance?: number; lock?: { lock_id: string }; lock_id?: string; action?: string; discounts?: Array<{ promotion_code: string }>; invoice_mode?: unknown };
    if (path === "billing.preview_attach") {
      // The first quote gets no answer, as a dropped connection gives none: it is asked once more.
      if (!dropped) {
        dropped = true;
        throw new TypeError("fetch failed");
      }
      const total = due(body.discounts?.[0]?.promotion_code);
      return Response.json({ total, line_items: [{ total }] });
    }
    if (path === "balances.check") {
      asked.push({ path, feature_id: body.feature_id, required_balance: body.required_balance, lock_id: body.lock?.lock_id });
      const allowed = left > 0;
      if (allowed) left--;
      return Response.json({ allowed, balance: null });
    }
    if (path === "balances.finalize") {
      asked.push({ path, lock_id: body.lock_id, action: body.action });
      if (body.action === "release") left++;
      return Response.json({ success: true });
    }
    if (path === "billing.attach") {
      asked.push({ path, discounts: body.discounts, invoice_mode: body.invoice_mode });
      if (!bought) left++;
      bought = true;
      if (lost) throw new TypeError("fetch failed");
      return Response.json({ payment_url: null });
    }
    if (body.email) asked.push({ path, email: body.email });
    const invoices = lost && bought ? [{ plan_ids: ["report_activation"], total: 10, currency: "usd", created_at: Date.now(), hosted_invoice_url: "https://invoice.stripe.example/pay", ...lost }] : [];
    return Response.json({ id: body.customer_id, email: null, subscriptions: [], purchases: [], invoices, balances: {}, payment_method: card ? { card: { brand: "visa", last4: "4242" } } : null });
  });
  return asked;
}

describe("activating a report", () => {
  it("is for an admin of its workspace: an organisation's member who started it can't", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")], world.author, world.lab);
    await expect(activate(world, key, { as: "author", workspaceId: world.lab })).rejects.toMatchObject(refused("FORBIDDEN"));
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.lab, key })).toMatchObject({ admin: false, organization: "Learning Lab" });
    await activate(world, key, { as: "orgadmin", workspaceId: world.lab });
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", charge: { invoice: `in_${key}` } }]);
  });

  it("spends one from the workspace's balance, with no card and nothing bought", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const asked = autumnStub({ balance: 1 });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, pay: false })).toEqual({ live: true });
    vi.unstubAllGlobals();
    const [activation] = await activations(world);
    // Held under a name of the record's, then that same hold taken once the report is live. Neither the customer's card nor a quote was read.
    const hold = expect.stringMatching(new RegExp(`^report-activation-${activation!._id}-`));
    expect(asked).toEqual([
      { path: "balances.check", feature_id: "report_activations", required_balance: 1, lock_id: hold },
      { path: "balances.finalize", lock_id: asked[0]!.lock_id, action: "confirm" },
    ]);
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(activation).toMatchObject({ state: "live", hold: asked[0]!.lock_id });
    expect(activation!.charge).toBeUndefined();
  });

  it("with none left in the balance, buys nothing until the person agrees to pay, and leaves no record", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // No card either: what the person is told is that the balance is empty, not that a card is missing.
    const asked = autumnStub({ balance: 0 });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, pay: false })).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT", reason: "noneLeft" }) });
    vi.unstubAllGlobals();
    expect(asked.map((call) => call.path)).not.toContain("billing.attach");
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
    expect(await activations(world)).toEqual([]);
  });

  it("refuses a report that is already live before anything is charged", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    await activate(world, key);
    const charged = await activations(world);
    await expect(activate(world, key)).rejects.toMatchObject(refused("CONFLICT"));
    expect(await activations(world)).toEqual(charged);
  });

  it("refuses before charging when the registrar its DOI was reserved with is switched off", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // Its DOI is Crossref's; an admin turns Crossref off and Zenodo on afterwards.
    await world.t.run(async (ctx) => {
      const settings = (await ctx.db.query("reportSettings").first())!;
      await ctx.db.patch("reportSettings", settings._id, { publication: { ...settings.publication, crossref: { ...settings.publication.crossref, mode: "off" }, zenodo: { ...settings.publication.zenodo, mode: "sandbox" } } });
    });
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paused: true });
    await expect(activate(world, key)).rejects.toMatchObject(refused("FEATURE_DISABLED"));
    expect(await activations(world)).toEqual([]);
    // Zenodo alone gives no report a DOI, so publishing is off for new reports too: no Publish to start one from.
    expect(await world.author.query(api.reports.settings.open, {})).toBe(false);
  });

  it("settles a charge once, keeps its code through the bank's confirmation, and needs nobody still an admin", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")], world.author, world.lab);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "orgadmin", world.lab), key, code: "HALFOFF" });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_3ds", url: "https://bank.example/confirm" } });
    // The bank's page is the payer's: the organisation's admins get it, its members only that the payment waits.
    expect(await world.orgAdmin.query(api.reports.activation.terms, { workspaceId: world.lab, key })).toMatchObject({ pending: { url: "https://bank.example/confirm" } });
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.lab, key })).toMatchObject({ pending: { url: null } });
    // The admin who paid leaves before the bank answers; the webhook and the page then both settle it.
    await world.t.run(async (ctx) => ctx.db.patch("organizationMemberships", (await ctx.db.query("organizationMemberships").withIndex("by_clerkMembershipId", (q) => q.eq("clerkMembershipId", "mem_orgadmin")).unique())!._id, { state: "revoked" }));
    const paid = { kind: "held" as const, hold: "hold_3ds", charge: { invoice: "in_3ds", total: 2.5, currency: "usd" } };
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: paid });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: paid });
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", code: "HALFOFF", charge: { invoice: "in_3ds", total: 2.5 } }]);
  });

  it("takes one activation when a paid charge is settled twice, with more in the balance", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_late", url: "https://bank.example/confirm" } });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    // The one it bought, and two more given since.
    const asked = autumnStub({ balance: 3 });
    // The webhook and the page both saw it waiting, and each settles it.
    const wait = (await world.t.query(internal.reports.activation.waitingCharge, { activationId }))!;
    await world.t.action(internal.reports.activation.watch, { activationId, attempt: 0 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "held", hold: "a-second-hold", charge: { invoice: wait.invoice, total: 5, currency: "usd" } } });
    await world.t.action(internal.reports.activation.finishHold, { activationId, hold: "a-second-hold", attempt: 0 });
    vi.unstubAllGlobals();
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    // The first hold is taken; the second, on a record already live, is given back.
    expect(asked.filter((call) => call.path === "balances.finalize").map((call) => call.action)).toEqual(["confirm", "release"]);
  });

  it("finds a purchase whose answer was lost: one waiting on the bank waits, so paying it later still makes the report live", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    autumnStub({ balance: 0, card: true, lost: { status: "open", stripe_id: "in_lost" } });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, pay: true })).rejects.toThrow();
    vi.unstubAllGlobals();
    // Kept, with the invoice's page, for the watch and the webhooks to settle: the next try sends the person there.
    expect(await activations(world)).toMatchObject([{ state: "pending", charge: { invoice: "in_lost" }, payUrl: "https://invoice.stripe.example/pay" }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ pending: { url: "https://invoice.stripe.example/pay" } });
  });

  it("finds a purchase whose answer was lost: one already paid goes live on what it bought", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    autumnStub({ balance: 0, card: true, lost: { status: "paid", stripe_id: "in_lost" } });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, pay: true })).rejects.toThrow();
    vi.unstubAllGlobals();
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", charge: { invoice: "in_lost", total: 10 } }]);
  });

  it("settles a paid charge once while another settlement of it is under way", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_late", url: "https://bank.example/confirm" } });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    const asked = autumnStub({ balance: 1 });
    // The webhook is settling it: the watch, which finds it paid too, leaves it to that one.
    expect(await world.t.mutation(internal.reports.activation.claimSettle, { activationId })).toBe(true);
    await world.t.action(internal.reports.activation.watch, { activationId, attempt: 0 });
    vi.unstubAllGlobals();
    expect(asked.filter((call) => call.path === "balances.check")).toEqual([]);
    expect(await activations(world)).toMatchObject([{ state: "pending" }]);
  });

  it("keeps an activation bought for a report that moved on in the balance, and tells whoever paid", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_late", url: "https://bank.example/confirm" } });
    // A reviewer declines it while the bank answers: declined, it can't go live.
    await world.reviewer.mutation(api.reports.review.decide, { key, decision: "decline", seenPdfAt: (await row(world.t, key)).pdf!.at, note: "Not a report" });
    // The bank confirms: Stripe has the invoice paid, and Autumn has the activation it bought in the balance.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    const asked = autumnStub({ balance: 1 });
    await world.t.action(internal.reports.activation.watch, { activationId, attempt: 0 });
    // Held for the report, then given back: nothing is refunded, and nothing is taken.
    expect(asked.filter((call) => call.path === "balances.finalize")).toEqual([{ path: "balances.finalize", lock_id: asked.find((call) => call.path === "balances.check")!.lock_id, action: "release" }]);
    expect(await emailed(world, key)).toContain("author: Activation kept");
    vi.unstubAllGlobals();
    expect(await row(world.t, key)).toMatchObject({ status: "declined" });
    expect(await activations(world)).toMatchObject([{ state: "unused", charge: { invoice: "in_late", total: 5 } }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ kept: true });
  });

  it("activates with no card when a code takes the whole price off, and asks for a card when it leaves some to pay", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // The balance is empty, the customer has no card saved, and no email: an organisation's has none.
    const asked = autumnStub({ balance: 0, due: (code) => (code === "FREEDOI" ? 0 : 5), dropFirstQuote: true });
    const attached = () => asked.filter((call) => call.path === "billing.attach");
    const activateWith = (code: string) => world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, pay: true, code });
    // Half off leaves $5 to pay, which takes a card: nothing is asked of Autumn's billing, and no record is left behind.
    await expect(activateWith("HALFOFF")).rejects.toMatchObject(refused("BILLING_CARD_REQUIRED"));
    expect(attached()).toEqual([]);
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
    expect(await activations(world)).toEqual([]);
    // The whole price off: bought with no card, billed by invoice so Autumn sends nobody to Stripe's page for $0. The
    // one bought is then spent from the balance on this report.
    expect(await activateWith("FREEDOI")).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(attached()).toMatchObject([{ invoice_mode: { enabled: true }, discounts: [{ promotion_code: "FREEDOI" }] }]);
    expect(asked.at(-1)).toMatchObject({ path: "balances.finalize", action: "confirm" });
    // Autumn bills by invoice only a customer with an email: it was given the activating person's first.
    expect(asked.filter((call) => call.email)).toHaveLength(1);
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", code: "FREEDOI", charge: { total: 0 } }]);
  });

  it("keeps a charge whose payment the bank refused to confirm as refused, voiding its invoice, so Activate starts afresh with the code it was asked with", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, code: "HALFOFF" });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_3ds", url: "https://hooks.stripe.com/3d_secure_2/hosted" } });
    const voided: string[] = [];
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") voided.push(url);
      return Response.json({ id: "in_3ds", status: "open", total: 500, amount_paid: 0, payments: { data: [{ payment: { payment_intent: { id: "pi_1", status: "requires_payment_method" } } }] } });
    });
    await world.t.action(internal.reports.activation.watch, { activationId, attempt: 0 });
    vi.unstubAllGlobals();
    expect(voided).toEqual(["https://api.stripe.com/v1/invoices/in_3ds/void"]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ pending: null, refused: { code: "HALFOFF" } });
    // Activated again, it's a new charge, and the report no longer says the last one was refused.
    await activate(world, key);
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect((await activations(world)).map((activation) => activation.state)).toEqual(["refused", "live"]);
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
