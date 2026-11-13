"use client";

// How a report is paid for: from the workspace's publication balance, in dollars, or by card. Shown where its licence
// is chosen, which sets its price, and again where it is activated, where everything but the licence can still change.
// The balance pays what it can, its refilling part first, and a card pays the rest; by card, the balance is left as it
// is. A voucher code lowers what the card pays, never what the balance does.

import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { CreditCard, Wallet } from "@/components/icons";
import { Segmented } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import type { BalancePart } from "@/convex/billing/validators";
import { inSentence, useMoney } from "@/lib/hooks/use-money";
import { BOUGHT_MIN, payment, type PayWith } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

/** A workspace's publication balance: what it holds in US dollars (null for no limit), and its parts. */
export type Balance = { balance: number | null; parts: BalancePart[] };

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
export function PayWithSwitch({ balance, payWith, onPayWith, className }: { balance: Balance; payWith: PayWith; onPayWith: (payWith: PayWith) => void; className?: string }) {
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
      <CreditCard className="size-4 text-muted-foreground" />
      {t("byCard")}
    </p>
  );
}

/**
 * What a report's price comes to, as a bill reads: the price, what the balance and a code take off it, and what is
 * left to pay. `boxed` draws it as a slip of its own; without, it is lines under whatever it sits beside.
 */
export function Bill({ licence, price, balance, payWith, code, credit = 0, note, now = false, boxed = false, className }: { /** Where the report is activated: what is due is due now. */ now?: boolean; /** The licence the price is for, by name. */ licence: string; /** In dollars. */ price: number; balance: Balance; payWith: PayWith; /** The code applied, with the share of what is bought it takes off. */ code: { code: string; off: number } | null; /** Credit on the account at Stripe, in dollars, which a charge is paid from before the card. */ credit?: number; /** Said under the total. */ note?: string; boxed?: boolean; className?: string }) {
  const t = useTranslations("publishReports.flow.payment");
  const money = useMoney();
  const sum = payment({ price, balance: balance.balance, payWith: balance.balance === 0 ? "card" : payWith, off: code?.off ?? 0 });
  const fromCredit = Math.min(credit, sum.due);
  return (
    <div className={cn("min-w-0 text-sm", boxed && "rounded-xl border border-border-subtle bg-background px-3.5 py-3", className)}>
      <AutoHeight>
        <dl className="space-y-2">
          <Line label={licence} amount={money(price)} />
          {sum.fromBalance > 0 ? <Line label={t("balance")} amount={`−${money(sum.fromBalance)}`} off /> : null}
          {code && sum.discount > 0 ? <Line label={t("code", { code: code.code })} amount={`−${money(sum.discount)}`} off /> : null}
          {fromCredit > 0 ? <Line label={t("credit")} amount={`−${money(fromCredit)}`} off /> : null}
        </dl>
      </AutoHeight>
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border-subtle pt-2.5">
        <span className="font-medium">{t(now ? "dueNow" : "due")}</span>
        <bdi dir="ltr" className="text-lg/6 font-semibold">
          <RollingMoney value={Math.round((sum.due - fromCredit) * 100) / 100} />
        </bdi>
      </div>
      {/* The least a card buys can be more than is missing: said, so the bill adds up to what the balance shows. */}
      <AutoHeight>{sum.spare > 0 ? <p className="pt-2 text-xs text-pretty text-muted-foreground">{t("least", { least: inSentence(money(BOUGHT_MIN)), spare: inSentence(money(sum.spare)) })}</p> : null}</AutoHeight>
      {note ? <p className="mt-2 text-xs text-pretty text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** One line of the bill: what it is, and its amount at the end. What is taken off the price is marked as a saving. */
function Line({ label, amount, off = false }: { label: string; amount: string; off?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
      {/* Isolated and left to right, so a right-to-left page keeps an amount, its sign and its currency in their own
          order: Arabic's own format, left to the page's direction, splits "US$" around the number. */}
      <dd className={cn("shrink-0 tabular-nums", off && "ink-success")}>
        <bdi dir="ltr">{amount}</bdi>
      </dd>
    </div>
  );
}
