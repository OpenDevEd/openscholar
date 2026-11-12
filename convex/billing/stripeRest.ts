// What OpenScholar asks Stripe itself, outside Autumn, as plain requests so no caller loads Stripe's library: voiding
// a declined charge's invoice, reading the credit on a customer's balance, and for a report's activation, the bank's
// page that comes back to the report, how its invoice stands, and how its Checkout session does.

type Stripe = Record<string, unknown>;

async function stripe(path: string, init: { method?: "GET" | "POST"; form?: Record<string, string> } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY isn't set");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method ?? (init.form ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${key}` },
    ...(init.form && { body: new URLSearchParams(init.form) }),
  });
  if (!response.ok) throw new Error(`Stripe answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as Stripe;
}

/** Voids an open invoice, so nothing can be collected on it. Throws when Stripe refuses or can't be reached. */
export async function voidInvoice(invoice: string) {
  await stripe(`invoices/${encodeURIComponent(invoice)}/void`, { method: "POST" });
}

/**
 * Voids a declined charge's invoice, which Autumn otherwise leaves open, holding the purchase it was for, until its due
 * date: meanwhile every purchase of the workspace waits for it to be paid (`unlessPaymentOpen`). Voided, the decline
 * changed nothing. A failure leaves it to Autumn.
 */
export async function voidDeclined(invoice: string) {
  try {
    await voidInvoice(invoice);
  } catch (error) {
    console.error(JSON.stringify({ event: "declined-invoice-not-voided", invoice, error: String(error).slice(0, 400) }));
  }
}

/**
 * The credit on a Stripe customer's balance, in US dollars, which Stripe takes an invoice from before the card (a
 * refund of a plan's unused days, say); 0 for none. Undefined when it can't be read.
 */
export async function stripeCredit(customer: string): Promise<number | undefined> {
  try {
    const balance = (await stripe(`customers/${encodeURIComponent(customer)}`)).balance;
    return typeof balance === "number" && balance < 0 ? -balance / 100 : 0;
  } catch (error) {
    console.error(JSON.stringify({ event: "stripe-credit-unread", customer, error: String(error).slice(0, 400) }));
    return undefined;
  }
}

/** The id of a Stripe Checkout session, from its page's address; null when the address isn't one. */
export const checkoutId = (url: string | null | undefined) => url?.match(/\/(cs_(?:test|live)_[A-Za-z0-9]+)/)?.[1] ?? null;

/**
 * How a Checkout session stands: paid, with the invoice Stripe made for it (none for a moment after the payment),
 * still open, or shut with nothing paid. Throws when Stripe can't be read.
 */
export async function checkoutOf(session: string): Promise<{ status: "paid"; invoice: string | null } | { status: "open" } | { status: "expired" }> {
  const read = await stripe(`checkout/sessions/${encodeURIComponent(session)}`);
  if (read.status === "expired") return { status: "expired" };
  // Complete and unpaid is a payment still on its way (a bank debit): it waits like an open one.
  if (read.status !== "complete" || read.payment_status === "unpaid") return { status: "open" };
  return { status: "paid", invoice: typeof read.invoice === "string" ? read.invoice : null };
}

/** Shuts an open Checkout session, so it can't be paid any more. Throws when it isn't open, or Stripe can't be reached. */
export async function expireCheckout(session: string) {
  await stripe(`checkout/sessions/${encodeURIComponent(session)}/expire`, { method: "POST" });
}

/** An invoice with the payment Stripe tried for it: amounts in cents. */
async function invoiceOf(invoice: string) {
  const read = await stripe(`invoices/${encodeURIComponent(invoice)}?expand[]=payments.data.payment.payment_intent`);
  const payments = ((read.payments as { data?: Array<{ payment?: { payment_intent?: Stripe | string } }> } | undefined)?.data ?? []).map((payment) => payment.payment?.payment_intent);
  const intent = payments.find((candidate): candidate is Stripe => typeof candidate === "object" && candidate !== null);
  return { status: String(read.status), total: Number(read.total ?? 0), currency: String(read.currency ?? "usd"), intent };
}

/**
 * The bank's page for a charge it asked to confirm, which comes back to `back` once the person has answered. The
 * charge was made with the person away, so Stripe kept its payment waiting; confirming it again with a way back is
 * what Stripe gives a page for (docs.stripe.com/payments/3d-secure/authentication-flow). Null when the payment isn't
 * waiting on the bank, or Stripe can't be asked: the invoice's own page still takes the payment.
 */
export async function bankPage(invoice: string, back: string): Promise<string | null> {
  try {
    const { intent } = await invoiceOf(invoice);
    if (intent?.status !== "requires_action") return null;
    const confirmed = await stripe(`payment_intents/${encodeURIComponent(String(intent.id))}/confirm`, { form: { return_url: back } });
    const url = (confirmed.next_action as { redirect_to_url?: { url?: string } } | null | undefined)?.redirect_to_url?.url;
    return typeof url === "string" ? url : null;
  } catch (error) {
    console.error(JSON.stringify({ event: "bank-page-unmade", invoice, error: String(error).slice(0, 400) }));
    return null;
  }
}

/**
 * How a charge's invoice stands: paid (what it came to in US dollars), void, or open, and whether the bank or the
 * card refused its payment, which then can't go through without being made again. Throws when Stripe can't be read.
 */
export async function chargeOf(invoice: string): Promise<{ status: "paid"; total: number; currency: string } | { status: "void" } | { status: "open"; refused: boolean }> {
  const read = await invoiceOf(invoice);
  if (read.status === "paid") return { status: "paid", total: read.total / 100, currency: read.currency };
  if (read.status === "void" || read.status === "uncollectible") return { status: "void" };
  return { status: "open", refused: read.intent?.status === "requires_payment_method" };
}
