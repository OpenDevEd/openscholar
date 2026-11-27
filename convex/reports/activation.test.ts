import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { actorFor } from "../workspaces/actor";
import { activate, checked, passed, refused, row, setup, type World } from "./reports.test-support";

// Activating a report (#1261): only its workspace's admins, its price paid from the workspace's publication balance
// or by card as the person chose, and what a card bought for a report that then moved on kept in that balance. The
// balance and the charge are Autumn's, behind the action: its answers here are stubbed.
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

/** One of the customer's balances as Autumn lists it. */
type Entry = { id: string; plan_id: string | null; remaining: number; included_grant?: number; prepaid_grant?: number; reset: { interval: string; resets_at: number | null } };
const TOP_UP = "publication_top_up";
/** Stripe's page for a payment with no saved card, as Autumn answers it: its address carries the session's id. */
const CHECKOUT = "https://checkout.stripe.example/c/pay/cs_test_a1B2c3";
/** The share each code takes off what a card buys. */
const OFF: Record<string, number> = { HALFOFF: 0.5, FREEDOI: 1, AFEW26: 1 };

/**
 * Autumn and Stripe as the action reaches them. The customer's publication balance holds `monthly` dollars that refill
 * and `kept` that stay until used. A hold takes from the refilling part first and a release gives it back. A purchase
 * adds its dollars as an entry of its own, at $1 each less what a code takes off; with no `card` and something to pay
 * it answers Stripe's page and adds nothing until `checkoutPaid`. With `lost`, Autumn makes the purchase but its
 * answer never arrives, and the customer's invoices then hold `lost`. Stripe has every invoice paid, at `stripeTotal`
 * cents. `asked` is the calls made to Autumn, in order.
 */
function autumnStub({ monthly = 0, kept = 0, card = false, dropFirstQuote = false, lost, racy = false, stripeTotal = 1000, credit = 0, stripeCurrency }: { monthly?: number; kept?: number; card?: boolean; dropFirstQuote?: boolean; lost?: { status: string; stripe_id: string }; /** Holds read the balance and take from it a moment apart, as two at once were seen to on our Autumn. */ racy?: boolean; stripeTotal?: number; /** Credit on the account at Stripe, in dollars, which a charge is paid from before the card. */ credit?: number; /** The currency Stripe has the customer in: with it, Autumn names a Stripe customer, which Stripe answers with the credit. */ stripeCurrency?: string }) {
  vi.stubEnv("AUTUMN_URL", "https://autumn.test");
  vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_fake");
  const asked: Array<Record<string, unknown> & { path: string }> = [];
  const entries: Entry[] = [
    ...(monthly > 0 ? [{ id: "monthly", plan_id: "go", remaining: monthly, included_grant: 20, reset: { interval: "month", resets_at: 1 } }] : []),
    ...(kept > 0 ? [{ id: "given", plan_id: null, remaining: kept, included_grant: kept, reset: { interval: "one_off", resets_at: null } }] : []),
  ];
  const holds = new Map<string, Array<[Entry, number]>>();
  const invoices: Array<Record<string, unknown>> = [];
  const keys = new Set<string>();
  let dropped = !dropFirstQuote;
  /** How Stripe has the checkout session Autumn made. */
  let session: "open" | "paid" | "expired" = "open";
  const left = () => entries.reduce((sum, entry) => sum + entry.remaining, 0);
  const add = (amount: number) => entries.push({ id: `bought-${entries.length}`, plan_id: TOP_UP, remaining: amount, prepaid_grant: amount, reset: { interval: "one_off", resets_at: null } });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("api.stripe.com/v1/checkout/sessions/")) {
      if (url.endsWith("/expire")) session = "expired";
      return Response.json(session === "paid" ? { status: "complete", payment_status: "paid", invoice: "in_checkout" } : { status: session, payment_status: "unpaid", invoice: null });
    }
    if (stripeCurrency && url.includes("api.stripe.com/v1/customers/")) return Response.json({ id: "cus_test", currency: stripeCurrency, balance: -Math.round(credit * 100) });
    if (url.startsWith("https://api.stripe.com")) return Response.json({ id: "in_late", status: "paid", total: stripeTotal, amount_due: Math.max(0, stripeTotal - credit * 100), currency: "usd", payments: { data: [] } });
    const path = url.split("/v1/")[1]!;
    // AFEW26 is an event's code: its reward's id starts event_.
    if (path === "rewards.list") return Response.json({ coupons: [{ id: "activation_free", promo_codes: [{ code: "FREEDOI" }] }, { id: "event_afew_2026", promo_codes: [{ code: "AFEW26" }] }], feature_grants: [] });
    const key = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
    const body = JSON.parse(String(init?.body ?? "{}")) as { customer_id?: string; email?: string; feature_id?: string; required_balance?: number; lock?: { lock_id: string }; lock_id?: string; action?: string; discounts?: Array<{ promotion_code: string }>; invoice_mode?: unknown; redirect_mode?: string; checkout_session_params?: { saved_payment_method_options?: unknown }; customize?: { items?: Array<{ price?: { amount: number; billing_units: number } }> }; feature_quantities?: Array<{ feature_id: string; quantity: number }>; balance_id?: string; add_to_balance?: number };
    const quantity = body.feature_quantities?.[0]?.quantity ?? 0;
    const due = quantity * (1 - (OFF[body.discounts?.[0]?.promotion_code ?? ""] ?? 0));
    if (path === "billing.preview_attach") {
      // The first quote gets no answer, as a dropped connection gives none: it is asked once more.
      if (!dropped) {
        dropped = true;
        throw new TypeError("fetch failed");
      }
      // As Autumn quotes: its lines unrounded, and what is to pay rounded to the cent, half a cent going up.
      return Response.json({ total: Math.round(Math.max(0, due - credit) * 100 + 1e-7) / 100, line_items: [{ total: due }] });
    }
    if (path === "balances.check") {
      asked.push({ path, feature_id: body.feature_id, required_balance: body.required_balance, lock_id: body.lock?.lock_id });
      const allowed = left() >= body.required_balance!;
      if (racy) await new Promise((resolve) => setTimeout(resolve, 50));
      if (allowed) {
        let owed = body.required_balance!;
        holds.set(body.lock!.lock_id, entries.map((entry): [Entry, number] => {
          const taken = Math.min(entry.remaining, owed);
          entry.remaining -= taken;
          owed -= taken;
          return [entry, taken];
        }));
      }
      return Response.json({ allowed, balance: null });
    }
    if (path === "balances.finalize") {
      asked.push({ path, lock_id: body.lock_id, action: body.action });
      if (body.action === "release") for (const [entry, taken] of holds.get(body.lock_id!) ?? []) entry.remaining += taken;
      holds.delete(body.lock_id!);
      return Response.json({ success: true });
    }
    if (path === "billing.attach") {
      asked.push({ path, quantity, priced: body.customize?.items?.[0]?.price, discounts: body.discounts, invoice_mode: body.invoice_mode, redirect: body.redirect_mode, saved: body.checkout_session_params?.saved_payment_method_options });
      // Something to pay and no card, or Stripe's page asked for by name: Stripe's page, and nothing given until it is paid.
      if ((!card || body.redirect_mode === "always") && !body.invoice_mode) return Response.json({ payment_url: CHECKOUT });
      if (!keys.has(key!)) add(quantity);
      keys.add(key!);
      if (lost) {
        if (invoices.length === 0) invoices.push({ plan_ids: [TOP_UP], total: due, currency: "usd", created_at: Date.now(), hosted_invoice_url: "https://invoice.stripe.example/pay", ...lost });
        throw new TypeError("fetch failed");
      }
      // As Autumn bills a saved card: what it quoted.
      return Response.json({ payment_url: null, ...(due > 0 && { invoice: { status: "paid", stripe_id: "in_bought", total: Math.round(due * 100 + 1e-7) / 100, currency: "usd" } }) });
    }
    if (path === "balances.update") {
      asked.push({ path, balance_id: body.balance_id, add_to_balance: body.add_to_balance });
      if (keys.has(key!)) return Response.json({ code: "duplicate_idempotency_key" }, { status: 409 });
      keys.add(key!);
      entries.find((entry) => entry.id === body.balance_id)!.remaining += body.add_to_balance!;
      return Response.json({ success: true });
    }
    if (body.email) asked.push({ path, email: body.email });
    return Response.json({ id: body.customer_id, ...(stripeCurrency && { stripe_id: "cus_test" }), email: null, subscriptions: [], purchases: [], invoices, balances: { publication_balance: { remaining: left(), breakdown: entries } }, payment_method: card ? { card: { brand: "visa", last4: "4242" } } : null });
  });
  return {
    asked,
    /** Autumn gives dollars bought, as it does a moment after Stripe has the payment. */
    give: add,
    /** What each of the customer's balances holds now, by its id. */
    holds: () => Object.fromEntries(entries.map((entry) => [entry.id, entry.remaining])),
    /** The person paid on Stripe's page: Autumn gives what was bought and has its invoice, paid. */
    checkoutPaid(amount: number, total: number) {
      session = "paid";
      add(amount);
      invoices.push({ plan_ids: [TOP_UP], status: "paid", stripe_id: "in_checkout", total, currency: "usd", created_at: Date.now() });
    },
  };
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
    // What it came to is for whoever may pay for it: its starter and the admins, not the organisation's other members.
    const paid = async (who: World["author"]) => (await who.query(api.reports.activation.terms, { workspaceId: world.lab, key }))?.paid;
    expect([await paid(world.orgAdmin), await paid(world.author), await paid(world.member)]).toEqual([expect.objectContaining({ fromBalance: 10 }), expect.objectContaining({ fromBalance: 10 }), null]);
  });

  it("pays from the balance, its refilling part first, with no card and nothing bought", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ monthly: 4, kept: 10 });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10 })).toEqual({ live: true });
    vi.unstubAllGlobals();
    const [activation] = await activations(world);
    // Held under a name of the record's, then that same hold taken once the report is live. Nothing was quoted or bought.
    const hold = expect.stringMatching(new RegExp(`^report-activation-${activation!._id}-`));
    expect(autumn.asked).toEqual([
      { path: "balances.check", feature_id: "publication_balance", required_balance: 10, lock_id: hold },
      { path: "balances.finalize", lock_id: autumn.asked[0]!.lock_id, action: "confirm" },
    ]);
    expect(autumn.holds()).toEqual({ monthly: 0, given: 4 });
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(activation).toMatchObject({ state: "live", hold: autumn.asked[0]!.lock_id, payWith: "balance", price: 10 });
    expect(activation!.charge).toBeUndefined();
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { fromBalance: 10, byCredit: 0, byCard: 0, code: null } });
  });

  it("costs what its licence does: an NC licence takes the other price from the balance", async () => {
    const world = await setup();
    const key = await world.author.mutation(api.reports.flow.sign, { workspaceId: world.own, name: "Ada Author", onBehalfOfAll: true, version: 1, licence: "CC BY-NC 4.0" });
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ price: 30 });
    // An admin changes the price: the report costs the new one from then on.
    await world.reviewer.mutation(api.reports.settings.update, { prices: { other: 25 } });
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ price: 25 });
    await expect(world.reviewer.mutation(api.reports.settings.update, { prices: { standard: 1.5 } })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
  });

  it("spends a balance that covers one report on one when two are activated at once, and charges nothing the page didn't show", async () => {
    vi.useRealTimers();
    const world = await setup();
    const first = await checked(world, [passed("byline")]);
    // A second start the same day: the plan's one a day is the author's own, so it is lifted here.
    await world.t.run(async (ctx) => {
      for (const started of await ctx.db.query("reportStarts").take(5)) await ctx.db.delete("reportStarts", started._id);
    });
    const second = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ monthly: 10, card: true, racy: true });
    // Both pages showed the balance covering it, with nothing due.
    const activate = (key: string) => world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, expect: 0 }).then(() => "live", (error: { data?: { reason?: string } }) => error.data?.reason ?? String(error));
    const answers = await Promise.all([activate(first.key), activate(second.key)]);
    vi.unstubAllGlobals();
    expect(answers.sort()).toEqual(["changed", "live"]);
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    expect((await activations(world)).map((activation) => activation.state)).toEqual(["live"]);
  });

  it("has a card buy exactly what the balance is short of, as one line at its own price, then spends the price from the balance", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ monthly: 4.5, card: true });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, expect: 5.5 })).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(autumn.asked.map((call) => call.path)).toEqual(["billing.attach", "balances.check", "balances.finalize"]);
    // $5.50 of balance for $5.50: by the plan's own price Autumn would sell six whole dollars.
    expect(autumn.asked[0]).toMatchObject({ quantity: 5.5, priced: { amount: 5.5, billing_units: 5.5 } });
    // $4.50 and the $5.50 bought, less the $10 the report costs.
    expect(Object.values(autumn.holds()).reduce((sum, held) => sum + held, 0)).toBe(0);
    expect(await activations(world)).toMatchObject([{ state: "live", payWith: "balance", price: 10, bought: 5.5, charge: { invoice: "in_bought", total: 5.5 } }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { fromBalance: 4.5, byCredit: 0, byCard: 5.5, code: null } });
  });

  it("on half a cent, charges what Autumn quotes, which is what the page reckoned, and nothing above it", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // $5.67 is bought at half off, $2.835: Autumn quotes and bills $2.84.
    const autumn = autumnStub({ kept: 4.33, card: true });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, code: "HALFOFF", expect: 2.83 })).rejects.toMatchObject(refused("CONFLICT"));
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, code: "HALFOFF", expect: 2.84 })).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(await activations(world)).toMatchObject([{ state: "live", bought: 5.67, code: "HALFOFF", charge: { total: 2.84 } }]);
  });

  it("reads a code's share from the quote's unrounded lines, so it holds for whatever is bought next", async () => {
    const world = await setup();
    autumnStub({});
    // Half off $1.01 is 50.5 cents: Autumn's total says 51, its line 50.5. A share read from the total would be 49.5%.
    const { off } = await world.author.action(api.reports.activation.quoteCode, { workspaceId: world.own, code: "HALFOFF", amount: 1.01 });
    vi.unstubAllGlobals();
    expect(off).toBeCloseTo(0.5, 10);
  });

  it("sends the payment to Stripe's page, with the saved cards offered there, when another card is asked for", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ kept: 4, card: true });
    // The saved card is 4242: asked to pay with another, nothing is charged to it.
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, expect: 6, card: "4242", otherCard: true })).toEqual({ url: CHECKOUT });
    vi.unstubAllGlobals();
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toMatchObject([{ quantity: 6, redirect: "always", saved: { allow_redisplay_filters: ["always", "limited", "unspecified"] } }]);
    expect(autumn.holds()).toEqual({ given: 4 });
    expect(await activations(world)).toMatchObject([{ state: "pending", payWith: "balance", bought: 6 }]);
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
  });

  it("refuses another card while the account's credit pays part: Stripe's page would ask for all of it", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ card: true, credit: 4 });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 6, card: "4242", otherCard: true })).rejects.toMatchObject(refused("CONFLICT"));
    vi.unstubAllGlobals();
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    expect(await activations(world)).toEqual([]);
  });

  it("saves a report that goes live to the library of the workspace it was published in", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    autumnStub({ kept: 10 });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10 })).toEqual({ live: true });
    vi.unstubAllGlobals();
    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
    const saved = await world.t.run((ctx) => ctx.db.query("libraryItems").withIndex("by_paperKey", (q) => q.eq("paperKey", `report:${key}`)).take(5));
    expect(saved).toMatchObject([{ workspaceId: world.own, paperKey: `report:${key}` }]);
  });

  it("by card, buys the whole price and leaves the balance as it was", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ monthly: 12, kept: 3, card: true });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 10 })).toEqual({ live: true });
    vi.unstubAllGlobals();
    // Nothing is held: the price is taken from the very dollars the card bought.
    expect(autumn.asked).toMatchObject([{ path: "billing.attach", quantity: 10 }, { path: "balances.update", balance_id: "bought-2", add_to_balance: -10 }]);
    expect(autumn.holds()).toEqual({ monthly: 12, given: 3, "bought-2": 0 });
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", payWith: "card", price: 10, charge: { total: 10 } }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { fromBalance: 0, byCredit: 0, byCard: 10, code: null } });
  });

  it("refuses a charge above what the page showed, buying nothing and leaving no record", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // The page showed $4 in the balance and $6 due; the balance has been spent since.
    const autumn = autumnStub({ card: true });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, expect: 6 })).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT", reason: "changed" }) });
    vi.unstubAllGlobals();
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
    expect(await activations(world)).toEqual([]);
  });

  it("refuses to charge a card the page didn't show, buying nothing", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // The page read no card and said Stripe's page would open; a card was saved elsewhere since.
    const autumn = autumnStub({ card: true });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 10, card: null })).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT", reason: "changed" }) });
    vi.unstubAllGlobals();
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("charges no card to a payment the account's credit covers, whatever card was saved since", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ card: true, credit: 10 });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 0, card: null })).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(autumn.asked.map((call) => call.path)).toContain("billing.attach");
    // The credit paid it, and is said to have: no card did.
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { fromBalance: 0, byCredit: 10, byCard: 0, code: null } });
  });

  it("with no card saved, pays from Stripe credit that covers it all by an invoice the credit pays, never on Stripe's page", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ credit: 70.39 });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 0, card: null })).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toMatchObject([{ invoice_mode: { enabled: true, finalize: true } }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { byCredit: 10, byCard: 0 } });
  });

  it("with no card saved and Stripe credit covering part, charges what Stripe's page takes, all of it, only when the page showed that", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ credit: 3 });
    // A page that counted the credit would have shown $7: Stripe's page takes $10, so nothing is bought.
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 7, card: null })).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT", reason: "changed" }) });
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    // Showing $10, it goes to Stripe's page.
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 10, card: null })).toEqual({ url: CHECKOUT });
    vi.unstubAllGlobals();
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toMatchObject([{ invoice_mode: undefined }]);
    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("has a card buy enough that Stripe charges it at least its least charge, never leaving a sum owed at Stripe", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // $9.70 in the balance and $0.70 of credit: $1 bought would leave the card $0.30, which Stripe doesn't charge.
    const autumn = autumnStub({ kept: 9.7, card: true, credit: 0.7, stripeCurrency: "usd" });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, expect: 0.5, card: "4242" })).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toMatchObject([{ quantity: 1.2 }]);
  });

  it("says what a card bought past the price to reach Stripe's least charge went to the balance", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ card: true, credit: 9.8, stripeCurrency: "usd" });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 0.5, card: "4242" })).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toMatchObject([{ quantity: 10.3 }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { price: 10, fromBalance: 0, kept: 0.3, byCredit: 9.8, byCard: 0.5 } });
  });

  it("charges no card under Stripe's least charge when the credit couldn't be read", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // No Stripe read: sized without the credit, Autumn's quote leaves the card $0.20.
    const autumn = autumnStub({ card: true, credit: 9.8 });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 0.5, card: "4242" })).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT", reason: "changed" }) });
    vi.unstubAllGlobals();
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("refuses a purchase for a workspace whose Stripe account is in another currency, before anything is bought", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ card: true, credit: 70.39, stripeCurrency: "gbp" });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, expect: 10, card: "4242" })).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT", reason: "currency", currency: "GBP" }) });
    vi.unstubAllGlobals();
    expect(autumn.asked.map((call) => call.path)).not.toContain("billing.attach");
    expect(await activations(world)).toEqual([]);
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
  });

  it("with no saved card, pays on Stripe's page with its code, and goes live on what was bought once that is paid", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ monthly: 12, stripeTotal: 500 });
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, code: "HALFOFF", expect: 5 })).toEqual({ url: CHECKOUT });
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toMatchObject([{ quantity: 10, discounts: [{ promotion_code: "HALFOFF" }] }]);
    // It waits, with the way back to Stripe's page, and the report is as it was.
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ pending: { url: CHECKOUT, checkout: true } });
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
    // Pressed again, it is the same payment: nothing more is asked of Autumn's billing.
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10, code: "HALFOFF" })).toEqual({ url: CHECKOUT });
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toHaveLength(1);
    // Paid there: Stripe sends the person back, and the page settles it.
    autumn.checkoutPaid(10, 5);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    await world.author.action(api.reports.activation.settle, { workspaceId: world.own, card: true });
    vi.unstubAllGlobals();
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", code: "HALFOFF", charge: { invoice: "in_checkout", total: 5 } }]);
    expect(autumn.holds()).toEqual({ monthly: 12, "bought-1": 0 });
  });

  it("gives up a payment left on Stripe's page, so the report can be paid another way", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({});
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "card", price: 10 });
    await world.author.action(api.reports.activation.cancelPayment, { workspaceId: world.own, key });
    // Shut at Stripe: paid there afterwards, by a tab left open, it couldn't be.
    autumn.checkoutPaid(10, 10);
    await world.author.action(api.reports.activation.settle, { workspaceId: world.own, card: false });
    vi.unstubAllGlobals();
    expect(await activations(world)).toEqual([]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ pending: null, refused: false });
    expect(await row(world.t, key)).toMatchObject({ status: "passed" });
  });

  it("opens one payment at a time: a second report waits while the workspace's first is unpaid, and neither is given up while it is being settled", async () => {
    const world = await setup();
    const first = await checked(world, [passed("byline")]);
    await world.t.run(async (ctx) => {
      for (const started of await ctx.db.query("reportStarts").take(5)) await ctx.db.delete("reportStarts", started._id);
    });
    const second = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ monthly: 4 });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key: first.key, payWith: "balance", price: 10 });
    // What the first buys lands in the same balance: the second would spend it.
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key: second.key, payWith: "balance", price: 10 })).rejects.toMatchObject(refused("CONFLICT"));
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toHaveLength(1);
    // Paid, and a webhook is settling it: giving it up now is refused, and the record stays for that settlement.
    autumn.checkoutPaid(6, 6);
    const [pending] = await activations(world);
    expect(await world.t.mutation(internal.reports.activation.claimSettle, { activationId: pending!._id })).toBe(true);
    await expect(world.author.action(api.reports.activation.cancelPayment, { workspaceId: world.own, key: first.key })).rejects.toMatchObject(refused("CONFLICT"));
    vi.unstubAllGlobals();
    expect(await activations(world)).toMatchObject([{ state: "pending" }]);
  });

  it("refuses a report whose price changed since the page read it, before anything is bought or spent", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const autumn = autumnStub({ monthly: 20, card: true });
    await world.reviewer.mutation(api.reports.settings.update, { prices: { standard: 12 } });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, expect: 0 })).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT", reason: "changed" }) });
    vi.unstubAllGlobals();
    expect(autumn.asked).toEqual([]);
    expect(await activations(world)).toEqual([]);
  });

  it("waits for the next period once a limit's places are taken, counting only activations under way, waiting or live", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    await world.reviewer.mutation(api.reports.intake.save, { mode: "on", opensAt: null, closesAt: null, timezone: "UTC", limits: [{ id: "day", count: 1, period: "day", reset: "rolling" }] });
    // Today's one place, taken by another workspace's report.
    const taken = await world.t.run(async (ctx) => ctx.db.insert("reportActivations", { workspaceId: world.lab, reportId: (await ctx.db.query("reports").first())!._id, at: Date.now(), by: world.authorId, state: "live" }));
    const begin = async () => world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "balance", price: 10 });
    await expect(begin()).rejects.toMatchObject({ data: expect.objectContaining({ code: "FEATURE_DISABLED", reason: "intake" }) });
    expect(await activations(world)).toHaveLength(1);
    // One the bank refused never took its place.
    await world.t.run((ctx) => ctx.db.patch("reportActivations", taken, { state: "refused" }));
    expect(await begin()).toBeTruthy();
  });

  it("takes a card's price from the balance once Autumn has given what it bought, never part of it, and never twice", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "card", price: 10 });
    const hold = `report-activation-${activationId}-bought`;
    // Stripe has the payment; Autumn has yet to give the $10 it bought, and $3 given before are in the balance.
    const autumn = autumnStub({ kept: 3 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "held", hold, charge: { invoice: "in_1", total: 10, currency: "usd" } } });
    await world.t.action(internal.reports.activation.finishHold, { activationId, hold, attempt: 0 });
    expect(autumn.holds()).toEqual({ given: 3 });
    expect((await activations(world))[0]!.finishedAt).toBeUndefined();
    // Until it is taken, the workspace's next report waits: the $10 on its way is the first report's, not its own.
    await world.t.run(async (ctx) => {
      for (const started of await ctx.db.query("reportStarts").take(5)) await ctx.db.delete("reportStarts", started._id);
    });
    const next = await checked(world, [passed("byline")]);
    await expect(world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key: next.key, payWith: "balance", price: 10 })).rejects.toMatchObject(refused("CONFLICT"));
    autumn.give(10);
    await world.t.action(internal.reports.activation.finishHold, { activationId, hold, attempt: 1 });
    await world.t.action(internal.reports.activation.finishHold, { activationId, hold, attempt: 2 });
    vi.unstubAllGlobals();
    expect(autumn.holds()).toEqual({ given: 3, "bought-1": 0 });
    expect(autumn.asked.filter((call) => call.path === "balances.update")).toHaveLength(1);
    expect((await activations(world))[0]!.finishedAt).toBeDefined();
    expect(await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key: next.key, payWith: "balance", price: 10 })).toBeTruthy();
  });

  it("shows the balance as it was while a card pays toward a report, never what was bought and not yet spent", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const read = (left: number, fetchedAt: number) => world.t.mutation(internal.billing.accounts.writeSnapshot, { workspaceId: world.own, withCard: false, fetchedAt, snapshot: { pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, publication: [{ interval: "month", left, size: 20 }] } });
    const shown = async () => (await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key }))?.balance;
    const later = () => vi.advanceTimersByTime(1_000);
    await read(4, Date.now());
    // A card buys the $6 the balance is short of: Autumn has $10 until the report's price is held.
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "balance", price: 10 });
    later();
    await read(10, Date.now());
    expect(await shown()).toBe(4);
    // Live, its hold still to be finished at Autumn: a webhook's read lands now.
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "held", hold: "a-hold", charge: { invoice: "in_1", total: 6, currency: "usd" } } });
    later();
    const early = Date.now();
    await read(10, early);
    expect(await shown()).toBe(4);
    later();
    await world.t.mutation(internal.reports.activation.finished, { activationId });
    // A read begun before the hold was finished, arriving after it.
    await read(10, early + 1);
    expect(await shown()).toBe(4);
    // Another report's payment opens before the balance is read again: that read is kept back too, so the balance
    // shown is still the one from before this report was paid, and says nothing of what is left since.
    await world.t.run(async (ctx) => {
      for (const started of await ctx.db.query("reportStarts").take(5)) await ctx.db.delete("reportStarts", started._id);
    });
    const second = await checked(world, [passed("byline")]);
    const waiting = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key: second.key, payWith: "card", price: 10 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId: waiting, outcome: { kind: "pending", invoice: "in_2", url: "https://bank.example/confirm" } });
    later();
    await read(0, Date.now());
    expect(await shown()).toBe(4);
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId: waiting, outcome: { kind: "refused" } });
    later();
    await read(0, Date.now());
    expect(await shown()).toBe(0);
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
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "orgadmin", world.lab), key, payWith: "balance", price: 10 });
    // What a card buys with the code, kept as the activation sizes it.
    await world.t.mutation(internal.reports.activation.buying, { activationId, bought: 5, code: "HALFOFF" });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_3ds", url: "https://bank.example/confirm" } });
    // The bank's page is the payer's: the organisation's admins get it, its members only that the payment waits.
    expect(await world.orgAdmin.query(api.reports.activation.terms, { workspaceId: world.lab, key })).toMatchObject({ pending: { url: "https://bank.example/confirm", checkout: false } });
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.lab, key })).toMatchObject({ pending: { url: null } });
    // The admin who paid leaves before the bank answers; the webhook and the page then both settle it.
    await world.t.run(async (ctx) => ctx.db.patch("organizationMemberships", (await ctx.db.query("organizationMemberships").withIndex("by_clerkMembershipId", (q) => q.eq("clerkMembershipId", "mem_orgadmin")).unique())!._id, { state: "revoked" }));
    const paid = { kind: "held" as const, hold: "hold_3ds", charge: { invoice: "in_3ds", total: 2.5, currency: "usd" } };
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: paid });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: paid });
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", code: "HALFOFF", charge: { invoice: "in_3ds", total: 2.5 } }]);
  });

  it("keeps a payment the bank refused as refused when a second look finds its invoice voided", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "balance", price: 10 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_fail", url: "https://bank.example/confirm" } });
    // The page and the watcher both look: the first voids the refused payment, the second finds the invoice void.
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "refused" } });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "none" } });
    // The balance read again after each look runs now, not after this test's environment is gone.
    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await activations(world)).toMatchObject([{ state: "refused" }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ refused: true });
  });

  it("takes the price once when a paid charge is settled twice, with more in the balance", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "balance", price: 10 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_late", url: "https://bank.example/confirm" } });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    // The $10 it bought, and $20 more given since.
    const autumn = autumnStub({ kept: 30 });
    // The webhook and the page both saw it waiting, and each settles it.
    const wait = (await world.t.query(internal.reports.activation.waitingCharge, { activationId }))!;
    await world.t.action(internal.reports.activation.watch, { activationId, attempt: 0 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "held", hold: "a-second-hold", charge: { invoice: wait.invoice, total: 10, currency: "usd" } } });
    await world.t.action(internal.reports.activation.finishHold, { activationId, hold: "a-second-hold", attempt: 0 });
    vi.unstubAllGlobals();
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    // The first hold is taken; the second, on a record already live, is given back.
    expect(autumn.asked.filter((call) => call.path === "balances.finalize").map((call) => call.action)).toEqual(["confirm", "release"]);
    expect(autumn.holds()).toEqual({ given: 20 });
  });

  it("finds a purchase whose answer was lost: one waiting on the bank waits, so paying it later still makes the report live", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    autumnStub({ card: true, lost: { status: "open", stripe_id: "in_lost" } });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10 })).rejects.toThrow();
    vi.unstubAllGlobals();
    // Kept, with the invoice's page, for the watch and the webhooks to settle: the next try sends the person there.
    expect(await activations(world)).toMatchObject([{ state: "pending", charge: { invoice: "in_lost" }, payUrl: "https://invoice.stripe.example/pay" }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ pending: { url: "https://invoice.stripe.example/pay", checkout: false } });
  });

  it("finds a purchase whose answer was lost: one already paid goes live on what it bought", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    autumnStub({ card: true, credit: 4, lost: { status: "paid", stripe_id: "in_lost" } });
    await expect(world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10 })).rejects.toThrow();
    vi.unstubAllGlobals();
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    // Autumn's invoices don't say what the account's credit paid of it: Stripe's does.
    expect(await activations(world)).toMatchObject([{ state: "live", charge: { invoice: "in_lost", total: 10, credit: 4 } }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { fromBalance: 0, byCredit: 4, byCard: 6 } });
  });

  it("settles a paid charge once while another settlement of it is under way", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "balance", price: 10 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_late", url: "https://bank.example/confirm" } });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    const autumn = autumnStub({ kept: 10 });
    // The webhook is settling it: the watch, which finds it paid too, leaves it to that one.
    expect(await world.t.mutation(internal.reports.activation.claimSettle, { activationId })).toBe(true);
    await world.t.action(internal.reports.activation.watch, { activationId, attempt: 0 });
    vi.unstubAllGlobals();
    expect(autumn.asked.filter((call) => call.path === "balances.check")).toEqual([]);
    expect(await activations(world)).toMatchObject([{ state: "pending" }]);
  });

  it("keeps what a card bought for a report that moved on in the balance, and tells whoever paid", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "balance", price: 10 });
    await world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: "in_late", url: "https://bank.example/confirm" } });
    // A reviewer declines it while the bank answers: declined, it can't go live.
    await world.reviewer.mutation(api.reports.review.decide, { key, decision: "decline", seenPdfAt: (await row(world.t, key)).pdf!.at, note: "Not a report" });
    // The bank confirms: Stripe has the invoice paid, and Autumn has the $10 it bought in the balance.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    const autumn = autumnStub({ kept: 10 });
    await world.t.action(internal.reports.activation.watch, { activationId, attempt: 0 });
    // Held for the report, then given back: nothing is refunded, and nothing is taken.
    expect(autumn.asked.filter((call) => call.path === "balances.finalize")).toEqual([{ path: "balances.finalize", lock_id: autumn.asked.find((call) => call.path === "balances.check")!.lock_id, action: "release" }]);
    expect(autumn.holds()).toEqual({ given: 10 });
    expect(await emailed(world, key)).toContain("author: Payment kept");
    vi.unstubAllGlobals();
    expect(await row(world.t, key)).toMatchObject({ status: "declined" });
    expect(await activations(world)).toMatchObject([{ state: "unused", charge: { invoice: "in_late", total: 10 } }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ kept: true });
  });

  it("activates with no card and no Stripe page when a code takes the whole price off", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    // The balance is empty, the customer has no card saved, and no email: an organisation's has none.
    const autumn = autumnStub({ dropFirstQuote: true });
    // Bought with no card, billed by invoice so Autumn sends nobody to Stripe's page for $0, then spent on this report.
    expect(await world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, code: "FREEDOI", expect: 0 })).toEqual({ live: true });
    vi.unstubAllGlobals();
    expect(autumn.asked.filter((call) => call.path === "billing.attach")).toMatchObject([{ quantity: 10, invoice_mode: { enabled: true }, discounts: [{ promotion_code: "FREEDOI" }] }]);
    expect(autumn.asked.at(-1)).toMatchObject({ path: "balances.finalize", action: "confirm" });
    // Autumn bills by invoice only a customer with an email: it was given the activating person's first.
    expect(autumn.asked.filter((call) => call.email)).toHaveLength(1);
    expect(await row(world.t, key)).toMatchObject({ status: "live" });
    expect(await activations(world)).toMatchObject([{ state: "live", code: "FREEDOI", charge: { total: 0 } }]);
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ paid: { fromBalance: 0, byCredit: 0, byCard: 0, code: "FREEDOI" } });
  });

  it("takes an event's code once per person, and any other code every time", async () => {
    const world = await setup();
    // A report a day, as the author's plan starts.
    const report = async () => {
      vi.setSystemTime(Date.now() + 86_400_000);
      return await checked(world, [passed("byline")]);
    };
    const [first, second, third, fourth] = [await report(), await report(), await report(), await report()];
    autumnStub({ kept: 10 });
    const free = (key: string, code: string) => world.author.action(api.reports.activation.activate, { workspaceId: world.own, key, payWith: "balance", price: 10, code, expect: 0 });
    // The balance pays for the first: the code takes nothing off, and stays unused.
    expect(await free(first.key, "AFEW26")).toEqual({ live: true });
    expect(await free(second.key, "AFEW26")).toEqual({ live: true });
    const used = { data: expect.objectContaining({ code: "VALIDATION_ERROR", reason: "codeUsed" }) };
    // Typed in any case, as Stripe takes it.
    await expect(world.author.action(api.reports.activation.quoteCode, { workspaceId: world.own, code: "afew26", amount: 10 })).rejects.toMatchObject(used);
    await expect(free(third.key, "AFEW26")).rejects.toMatchObject(used);
    expect(await row(world.t, third.key)).not.toMatchObject({ status: "live" });
    expect(await free(third.key, "FREEDOI")).toEqual({ live: true });
    expect(await free(fourth.key, "FREEDOI")).toEqual({ live: true });
    vi.unstubAllGlobals();
  });

  it("keeps a charge whose payment the bank refused to confirm as refused, voiding its invoice, so Activate starts afresh", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    const activationId = await world.t.mutation(internal.reports.activation.begin, { actor: await actorOf(world, "author", world.own), key, payWith: "balance", price: 10, code: "HALFOFF" });
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
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.own, key })).toMatchObject({ pending: null, refused: true });
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
