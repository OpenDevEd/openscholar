#!/usr/bin/env node
// Gives each person who bought credits on the old site their balance as a top-up in Autumn. See README.md.
// Usage: AUTUMN_URL=... AUTUMN_SECRET_KEY=... node carry-credits.mjs <export.zip> [--apply]
// Without --apply it only lists them. Running it twice changes nothing: Autumn skips a plan already active.
import { execFileSync } from "node:child_process";

const [zip, apply] = process.argv.slice(2);
const rows = (table) => execFileSync("unzip", ["-p", zip, `${table}/documents.jsonl`], { maxBuffer: 2e9 }).toString().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const autumn = async (path, body) => {
  const response = await fetch(`${process.env.AUTUMN_URL}/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AUTUMN_SECRET_KEY}`, "Content-Type": "application/json", "User-Agent": "openscholar-launch/1.0" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
};

const users = new Map(rows("users").map((user) => [user._id, user]));
const owed = rows("credits").flatMap(({ userId, paidBalance }) => {
  const user = users.get(userId);
  return paidBalance > 0 && user && user.state !== "deleted" ? [{ user, paid: paidBalance }] : [];
});
console.log(`${owed.length} people, ${owed.reduce((sum, { paid }) => sum + paid, 0)} credits`);

const unit = (await autumn("plans.list", {})).list.find((plan) => plan.id === "top_up")?.items[0]?.price?.billing_units;
if (!unit) throw new Error("Autumn has no top-up plan with a billing unit");

let wrong = 0;
for (const { user, paid } of owed) {
  if (apply !== "--apply") {
    console.log(user._id, user.email, paid);
    continue;
  }
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
  // The account has to exist first: that gives it Free, which the import then has to name or Autumn ends it.
  await autumn("customers.get_or_create", { customer_id: user._id, email: user.email, name });
  await autumn("billing.import", {
    customer_id: user._id,
    billables: [
      { plan: { plan_id: "free" } },
      { plan: { plan_id: "top_up", feature_quantities: [{ feature_id: "credits", quantity: Math.ceil(paid / unit) * unit }], balances: [{ feature_id: "credits", balance: paid }] } },
    ],
  });
  const customer = await autumn("customers.get_or_create", { customer_id: user._id });
  const kept = customer.balances.credits.breakdown.find((part) => part.plan_id === "top_up")?.remaining;
  const onFree = customer.subscriptions.some((plan) => plan.plan_id === "free" && plan.status === "active");
  console.log(user._id, paid, kept === paid && onFree ? "ok" : `WRONG: top-up ${kept}, Free ${onFree}`);
  if (kept !== paid || !onFree) wrong += 1;
}
process.exit(wrong ? 1 : 0);
