"use client";

// How a report is paid for: from the workspace's publication balance, in dollars, or by card. Shown where its licence
// is chosen, which sets its price, and again where it is activated, where everything but the licence can still change.
// The balance pays what it can, its refilling part first, and a card pays the rest; by card, the balance is left as it
// is. A voucher code lowers what the card pays, never what the balance does.

import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CreditCard, Wallet } from "@/components/icons";
import { Segmented } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import type { RefillInterval } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

export type PayWith = "balance" | "card";

/**
 * One part of a publication balance, in dollars: what refills by `interval`, back to `refillsTo` on `resetsAt`, or with
 * `once` what stays until used (given once, or bought). `left` is what remains of it now.
 */
export type BalancePart = { interval: RefillInterval | "once"; left: number; size: number; resetsAt?: number; refillsTo?: number };

export const balanceOf = (parts: BalancePart[]) => parts.reduce((sum, part) => sum + part.left, 0);

/**
 * What a price comes to, in dollars: what the balance pays, what is bought by card, what a code takes off that, and
 * what is due. What is bought is whole dollars, so a balance with cents in it keeps them.
 */
export function payment({ price, balance, payWith, off }: { price: number; balance: number; payWith: PayWith; /** The part of what is bought that a code takes off, 0 to 1. */ off: number }) {
  const bought = payWith === "balance" ? Math.ceil(price - Math.min(balance, price)) : price;
  const discount = bought * off;
  return { fromBalance: price - bought, bought, discount, due: bought - discount };
}

/** Dollars in the reader's own format, without cents when there are none: $5, $2.50. */
export function useMoney() {
  const format = useFormatter();
  return (amount: number) => format.number(amount, { style: "currency", currency: "USD", minimumFractionDigits: amount % 1 ? 2 : 0 });
}

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

export function PaymentChoice({
  licence,
  price,
  parts,
  payWith,
  onPayWith,
  code,
  voucher,
  action,
  disabled = false,
}: {
  /** The licence the price is for, by name. */
  licence: string;
  /** In dollars. */
  price: number;
  parts: BalancePart[];
  payWith: PayWith;
  onPayWith: (payWith: PayWith) => void;
  /** The code applied, with the part of what is bought it takes off. */
  code: { code: string; off: number } | null;
  /** The field a code goes in, shown while a card pays something. */
  voucher?: ReactNode;
  /** The button that pays, where the report is activated, under what is due. */
  action?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations("publishReports.flow.payment");
  const money = useMoney();
  const balance = balanceOf(parts);
  const sum = payment({ price, balance, payWith: balance > 0 ? payWith : "card", off: code?.off ?? 0 });
  return (
    <div inert={disabled || undefined} className={cn("grid gap-x-6 gap-y-3 rounded-2xl bg-inset/60 p-3 transition-opacity sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]", disabled && "opacity-60")}>
      {/* The choices: what pays, and a code. */}
      <div className="min-w-0 space-y-2">
        {balance > 0 ? (
          <>
            <p className="ps-1 text-xs font-medium text-muted-foreground">{t("payWith")}</p>
            <Segmented
              size="md"
              label={t("payWith")}
              value={payWith}
              onChange={onPayWith}
              className="bg-background"
              options={[
                { id: "balance", label: t("balance"), icon: Wallet, detail: <bdi className="tabular-nums">{money(balance)}</bdi> },
                { id: "card", label: t("card"), icon: CreditCard },
              ]}
            />
          </>
        ) : (
          // Nothing in the balance leaves one way to pay: said, not offered as a choice of one.
          <p className="flex h-9 items-center gap-2 ps-1 text-sm font-medium">
            <CreditCard className="size-4 text-muted-foreground" />
            {t("byCard")}
          </p>
        )}
        {/* A code lowers what the card pays: with nothing for a card to pay, there is nothing for one to do, so its
            field is put away. A code applied is kept, and is back when a card pays again. */}
        <AutoHeight>{voucher && sum.bought > 0 ? <div className="ps-1 pt-1">{voucher}</div> : null}</AutoHeight>
      </div>
      {/* What that comes to, as a bill reads: the price, what is taken off it, and what is left to pay. */}
      <div className="min-w-0 self-start rounded-xl border border-border-subtle bg-background text-sm">
        <AutoHeight>
          <dl className="space-y-2 px-3.5 pt-3">
            <Line label={licence} amount={money(price)} />
            {sum.fromBalance > 0 ? <Line label={t("balance")} amount={`−${money(sum.fromBalance)}`} off /> : null}
            {code && sum.discount > 0 ? <Line label={t("code", { code: code.code })} amount={`−${money(sum.discount)}`} off /> : null}
          </dl>
        </AutoHeight>
        <div className="mx-3.5 mt-2.5 flex items-center justify-between gap-3 border-t border-border-subtle py-2.5">
          <span className="font-medium">{t(action ? "dueNow" : "due")}</span>
          <bdi className="text-lg/6 font-semibold">
            <RollingMoney value={sum.due} />
          </bdi>
        </div>
        {action ? <div className="flex justify-end px-3.5 pb-3">{action}</div> : null}
      </div>
    </div>
  );
}

/** One line of the bill: what it is, and its amount at the end. What is taken off the price is marked as a saving. */
function Line({ label, amount, off = false }: { label: string; amount: string; off?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      {/* Isolated, so a right-to-left page keeps an amount and its currency in their own order. */}
      <dd className={cn("shrink-0 tabular-nums", off && "ink-success")}>
        <bdi>{amount}</bdi>
      </dd>
    </div>
  );
}
