// The two things OpenScholar asks Stripe itself, outside Autumn, as plain requests so no caller loads Stripe's library:
// voiding a declined charge's invoice, and reading the credit on a customer's balance. Each failure is logged and
// leaves things as they were.

async function stripe(path: string, init: RequestInit = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY isn't set");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`Stripe answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Voids a declined charge's invoice, which Autumn otherwise leaves open, holding the purchase it was for, until its due
 * date: meanwhile every purchase of the workspace waits for it to be paid (`unlessPaymentOpen`). Voided, the decline
 * changed nothing. A failure leaves it to Autumn.
 */
export async function voidDeclined(invoice: string) {
  try {
    await stripe(`invoices/${encodeURIComponent(invoice)}/void`, { method: "POST" });
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
