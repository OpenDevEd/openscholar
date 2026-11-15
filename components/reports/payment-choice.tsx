"use client";

// How a report is paid for: from the workspace's publication balance, in dollars, or by card. Shown where its licence
// is chosen, which sets its price, and again where it is activated, where everything but the licence can still change.
// The balance pays what it can, its refilling part first, and a card pays the rest; by card, the balance is left as it
// is. A voucher code lowers what the card pays, never what the balance does.

import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, CreditCard, FileText, Wallet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { StripeIcon } from "@/components/icons/stripe-icon";
import { Segmented } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import type { BalancePart } from "@/convex/billing/validators";
import { inSentence, useMoney } from "@/lib/hooks/use-money";
import { CURRENCY_MAIL } from "@/lib/billing/contact";
import { BOUGHT_MIN, STRIPE_MIN, payment, type PayWith } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

/**
 * What a workspace has to pay for a report with, as the server reads it for every step (convex/billing/accounts.ts
 * `fundsOf`): its publication balance in US dollars (null for no limit) and its parts, the credit on its Stripe customer,
 * whether a card is saved, which that credit is taken before, and the Stripe customer's currency when it isn't dollars.
 */
export type Funds = { balance: number | null; parts: BalancePart[]; credit: number; cardSaved: boolean; /** The Stripe customer's currency when it isn't US dollars: nothing can be bought there. */ currency: string | null };

/** An amount that rolls to each new value, as the app's other numbers do. It jumps there when motion is reduced. */
function RollingMoney({ value }: { value: number }) {
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const cents = useSpring(Math.round(value * 100), { stiffness: 140, damping: 24 });
  const text = useTransform(cents, (n) => {
    const amount = Math.round(n) / 100;
    // Whole while it rolls between whole amounts; with cents only where it lands on some.
    return amount.toLocaleString(locale, { style: "currency", currency: "USD", minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: value % 1 ? 2 : 0 });
  });
  // The spring is an animation system outside React: point it at each new amount.
  useEffect(() => {
    if (reduceMotion) cents.jump(Math.round(value * 100));
    else cents.set(Math.round(value * 100));
  }, [cents, value, reduceMotion]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

/** What pays: the publication balance or a card, while the balance holds something. With nothing in it, a card does. */
export function PayWithSwitch({ funds: balance, credited, payWith, onPayWith, className }: { funds: Funds; /** The Stripe credit pays some of what a card would: `payment()`'s `fromCredit`. */ credited: boolean; payWith: PayWith; onPayWith: (payWith: PayWith) => void; className?: string }) {
  const t = useTranslations("publishReports.flow.payment");
  const money = useMoney();
  if (balance.balance !== 0)
    return (
      <Segmented
        size="md"
        label={t("payWith")}
        value={payWith}
        onChange={onPayWith}
        // On a phone the two don't always fit side by side: the icons go, and past that the card takes a second row, never cut off.
        // At large text a label wider than the phone wraps inside its segment instead of running off the screen.
        className={cn("max-w-full shrink flex-wrap rounded-[1.375rem] animate-in fade-in duration-200 motion-reduce:animate-none max-sm:[&_svg]:hidden max-sm:[&_button]:h-auto max-sm:[&_button]:min-h-9 max-sm:[&_button]:max-w-full max-sm:[&_button]:flex-wrap max-sm:[&_button]:whitespace-normal max-sm:[&_button]:py-1.5 max-sm:[&_.truncate]:overflow-visible max-sm:[&_.truncate]:whitespace-normal max-sm:[&_button]:rounded-2xl max-sm:[&>span]:rounded-2xl", className)}
        options={[
          { id: "balance", label: t("balance"), icon: Wallet, detail: balance.balance === null ? t("noLimit") : <bdi dir="ltr" className="tabular-nums">{money(balance.balance)}</bdi> },
          // No card is named here: which card pays is chosen in the pay dialog, and naming one would read as the only one.
          { id: "card", label: t("card"), icon: CreditCard },
        ]}
      />
    );
  return (
    // Nothing in the balance leaves one way to pay: said, not offered as a choice of one.
    // The two forms take each other's place when the balance changes under them, as when another workspace is picked: each fades in.
    <p className="flex h-9 items-center gap-2 text-sm font-medium animate-in fade-in duration-200 motion-reduce:animate-none">
      {/* Stripe takes a charge from the workspace's credit there before the card: said where it pays some. */}
      {credited ? <StripeIcon aria-hidden className="size-4" /> : <CreditCard className="size-4 text-muted-foreground" />}
      {t(credited ? "byCredit" : "byCard")}
    </p>
  );
}

/**
 * What a report's price comes to, as a bill reads: the price, what the balance and a code take off it, and what is
 * left to pay. `boxed` draws it as a slip of its own; without, it is lines under whatever it sits beside.
 */
export function Bill({ licence, price, funds, owner, payWith, code, note, onSaveCard, now = false, boxed = false, className }: { /** Opens Stripe's page for the workspace's cards, where one is saved: offered where Stripe credit sits unused for want of one. */ onSaveCard?: () => void; /** Where the report is activated: what is due is due now. */ now?: boolean; /** The licence the price is for, by name. */ licence: string; /** In dollars. */ price: number; funds: Funds; /** The organisation whose Stripe account the credit is on; null for the person's own. */ owner: string | null; payWith: PayWith; /** The code applied, with the share of what is bought it takes off. */ code: { code: string; off: number } | null; /** Said under the total. */ note?: string; boxed?: boolean; className?: string }) {
  const t = useTranslations("publishReports.flow.payment");
  const money = useMoney();
  const format = useFormatter();
  const sum = payment({ price, balance: funds.balance, payWith: funds.balance === 0 ? "card" : payWith, off: code?.off ?? 0, credit: funds.credit, cardSaved: funds.cardSaved });
  const held = <bdi dir="ltr" className="tabular-nums">{money(funds.credit)}</bdi>;
  return (
    <div className={cn("min-w-0 text-sm", boxed && "rounded-xl border border-border-subtle bg-background px-3.5 py-3", className)}>
      <AutoHeight>
        <dl className="space-y-2">
          <Line label={licence} amount={money(price)} />
          {sum.fromBalance > 0 ? <Line label={t("balance")} amount={`−${money(sum.fromBalance)}`} off /> : null}
          {/* A code lowers only what a card buys, never what the balance pays: said under it, as people expected it off the price. */}
          {code && sum.discount > 0 ? <Line label={t("code", { code: code.code })} hint={t("codeOff", { off: format.number(code.off, { style: "percent", maximumFractionDigits: 1 }), amount: money(sum.bought) })} amount={`−${money(sum.discount)}`} off /> : null}
          {sum.fromCredit > 0 ? (
            <Line
              label={
                <span className="flex min-w-0 items-center gap-1.5">
                  <StripeIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{t("credit")}</span>
                </span>
              }
              hint={owner ? t.rich("creditTheirs", { owner, amount: () => held }) : t.rich("creditYours", { amount: () => held })}
              amount={`−${money(sum.fromCredit)}`}
              off
            />
          ) : null}
        </dl>
      </AutoHeight>
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border-subtle pt-2.5">
        <span className="font-medium">{t(now ? "dueNow" : "due")}</span>
        <bdi dir="ltr" className="text-lg/6 font-semibold">
          <RollingMoney value={sum.due} />
        </bdi>
      </div>
      {/* The least a card buys, or the least Stripe charges it, can be more than is missing: said, so the bill adds up to what the balance shows. */}
      <AutoHeight>
        {sum.spare > 0 ? (
          <p className="pt-2 text-xs text-pretty text-muted-foreground">{sum.raised ? t("leastStripe", { least: inSentence(money(STRIPE_MIN)), spare: inSentence(money(sum.spare)) }) : t("least", { least: inSentence(money(BOUGHT_MIN)), spare: inSentence(money(sum.spare)) })}</p>
        ) : null}
      </AutoHeight>
      {/* A Stripe account in another currency buys nothing priced in dollars: said where a card would pay. */}
      <AutoHeight>
        {funds.currency && sum.bought > 0 ? (
          <p className="pt-2 text-xs text-pretty text-destructive">
            {t("currency", { currency: funds.currency })}{" "}
            <a href={CURRENCY_MAIL} className="font-medium underline underline-offset-2">
              {t("emailUs")}
            </a>
          </p>
        ) : null}
      </AutoHeight>
      {/* Stripe credit that doesn't cover it all, with no card saved: Stripe's page charges it all and leaves the credit. */}
      <AutoHeight>
        {sum.idle > 0 ? (
          <p className="flex items-start gap-1.5 pt-2 text-xs text-pretty text-muted-foreground">
            <StripeIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>
              {t.rich("creditIdle", { amount: () => <bdi dir="ltr" className="tabular-nums">{money(sum.idle)}</bdi> })}
              {onSaveCard ? (
                <>
                  {" "}
                  <button type="button" onClick={onSaveCard} className="font-medium text-foreground underline underline-offset-2">
                    {t("saveCard")}
                  </button>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
      </AutoHeight>
      {note ? <p className="mt-2 text-xs text-pretty text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** What a live report was paid with (convex/reports/activation.ts `paidWith`), in US dollars. */
export type Paid = { fromBalance: number; byCredit: number; byCard: number; code: string | null; left: number | null; receipt: boolean };

/**
 * A live report's bill as it was paid, where its bill stood on every step before: its price, what the balance, a code
 * and Stripe credit took off it, and what a card was charged, with Stripe's receipt under it when something was bought.
 */
export function PaidBill({ licence, price, paid, onReceipt, boxed = false, className }: { licence: string; /** In dollars. */ price: number; paid: Paid; /** Opens Stripe's receipt. */ onReceipt: () => void; boxed?: boolean; className?: string }) {
  const t = useTranslations("publishReports.flow");
  const money = useMoney();
  const covered = paid.fromBalance + paid.byCredit + paid.byCard;
  // What the code took off: the rest of the price. A card that bought past it left the rest in the balance.
  const discount = Math.round(Math.max(0, price - covered) * 100) / 100;
  const kept = Math.round(Math.max(0, covered - price) * 100) / 100;
  return (
    <div className={cn("min-w-0 text-sm", boxed && "rounded-xl border border-border-subtle bg-background px-3.5 py-3", className)}>
      <dl className="space-y-2">
        <Line label={licence} amount={money(price)} />
        {paid.fromBalance > 0 ? <Line label={t("payment.balance")} amount={`−${money(paid.fromBalance)}`} off /> : null}
        {paid.code && discount > 0 ? <Line label={t("payment.code", { code: paid.code })} amount={`−${money(discount)}`} off /> : null}
        {paid.byCredit > 0 ? (
          <Line
            label={
              <span className="flex min-w-0 items-center gap-1.5">
                <StripeIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{t("payment.credit")}</span>
              </span>
            }
            amount={`−${money(paid.byCredit)}`}
            off
          />
        ) : null}
      </dl>
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border-subtle pt-2.5">
        <span className="font-medium">{t("payment.charged")}</span>
        <bdi dir="ltr" className="text-lg/6 font-semibold tabular-nums">
          {money(paid.byCard)}
        </bdi>
      </div>
      {kept > 0 || paid.left !== null ? (
        <p className="pt-2 text-xs text-pretty text-muted-foreground">{paid.left !== null ? t("payment.leftNow", { left: money(paid.left) }) : t("payment.keptNow", { kept: money(kept) })}</p>
      ) : null}
      {paid.receipt ? (
        <Button variant="link" size="sm" className="mt-1.5 h-auto gap-1 px-0 text-xs" onClick={onReceipt}>
          <FileText className="size-3.5" /> {t("paid.receipt")} <ArrowUpRight className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/** One line of the bill: what it is, and its amount at the end. What is taken off the price is marked as a saving. */
function Line({ label, hint, amount, off = false }: { label: ReactNode; /** Under the label, where what it is needs saying. */ hint?: ReactNode; amount: string; off?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", hint ? "items-start" : "items-center")}>
      <dt className="min-w-0 truncate text-muted-foreground">
        {label}
        {hint ? <span className="mt-0.5 block whitespace-normal text-balance text-xs text-muted-foreground/80">{hint}</span> : null}
      </dt>
      {/* Isolated and left to right, so a right-to-left page keeps an amount, its sign and its currency in their own
          order: Arabic's own format, left to the page's direction, splits "US$" around the number. */}
      <dd className={cn("shrink-0 tabular-nums", off && "ink-success")}>
        <bdi dir="ltr">{amount}</bdi>
      </dd>
    </div>
  );
}
