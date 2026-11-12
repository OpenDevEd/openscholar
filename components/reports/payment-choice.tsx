"use client";

// How a report is paid for: from the workspace's publication balance, in dollars, or by card. Shown where its licence
// is chosen, which sets its price, and again where it is activated, where everything but the licence can still change.
// The balance pays what it can, its refilling part first, and a card pays the rest; by card, the balance is left as it
// is. A voucher code lowers what the card pays, never what the balance does.

import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { CreditCard, Tag, Wallet } from "@/components/icons";
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
  /** The field a code goes in. */
  voucher?: ReactNode;
  /** The button that pays, where the report is activated: it carries what is due. Without one, what is due is said. */
  action?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations("publishReports.flow.payment");
  const money = useMoney();
  const balance = balanceOf(parts);
  const sum = payment({ price, balance, payWith: balance > 0 ? payWith : "card", off: code?.off ?? 0 });
  return (
    <div inert={disabled || undefined} className={cn("rounded-2xl bg-inset/60 p-3 transition-opacity", disabled && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {balance > 0 ? (
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
        ) : (
          // Nothing in the balance leaves one way to pay: said, not offered as a choice of one.
          <p className="flex h-9 items-center gap-2 ps-1 text-sm font-medium">
            <CreditCard className="size-4 text-muted-foreground" />
            {t("byCard")}
          </p>
        )}
        <div className="ms-auto flex items-center gap-3">
          {action ?? (
            <p className="text-end">
              <span className="block text-xs text-muted-foreground">{t("due")}</span>
              <span className="block text-lg/6 font-semibold">{sum.due > 0 ? <RollingMoney value={sum.due} /> : t("nothing")}</span>
            </p>
          )}
        </div>
      </div>
      {/* What the amount is made of, each part with its own sign: the chips come and go as the choices change. */}
      <AutoHeight className="mt-2.5">
        <div className="flex flex-wrap items-center gap-1.5 ps-1">
          <StatusChip tone="neutral">
            {licence}
            <bdi className="tabular-nums text-foreground">{money(price)}</bdi>
          </StatusChip>
          {sum.fromBalance > 0 ? (
            <StatusChip tone="neutral" icon={Wallet}>
              {t("fromBalance")}
              <bdi className="tabular-nums text-foreground">−{money(sum.fromBalance)}</bdi>
            </StatusChip>
          ) : null}
          {code && sum.discount > 0 ? (
            <StatusChip tone="success" icon={Tag}>
              <span className="font-mono">{code.code}</span>
              <bdi className="tabular-nums">−{money(sum.discount)}</bdi>
            </StatusChip>
          ) : null}
        </div>
      </AutoHeight>
      {voucher ? <div className="mt-2 ps-1">{voucher}</div> : null}
    </div>
  );
}
