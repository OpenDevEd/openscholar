"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import { useAction, useQuery } from "convex/react";
import { useQueryState } from "nuqs";
import posthog from "posthog-js";
import { useFormatter, useNow, useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Coins,
  CreditCard,
  FileSearch,
  KeyRound,
  ListFilter,
  Loader2,
  MessageSquare,
  Repeat,
  Search,
  Undo2,
  type AppIcon,
  TranslateIcon,
} from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { PaymentReceived, TopUpBundles, useTopUps } from "@/components/billing/top-up-bundles";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { useAppToast } from "@/lib/toast";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useFeatureFlagForPlan } from "@/lib/feature-flags/hook";
import { defaultPlanId, findPlan, planCreditCap } from "@/lib/billing/catalog";
import { DAYS_TO_PAY, type RefillInterval } from "@/lib/billing/plans";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { Enter, LIST, Paged, Tile, Zone } from "@/components/settings/parts";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

type Kind = "chat" | "extraction" | "screening" | "search" | "translation" | "wallet_api" | "refund";
const KINDS: Record<Kind, { icon: AppIcon; tint: string }> = {
  chat: { icon: MessageSquare, tint: "#a78bfa" },
  extraction: { icon: FileSearch, tint: "#60a5fa" },
  screening: { icon: ListFilter, tint: "#34d399" },
  search: { icon: Search, tint: "#d9a27c" },
  translation: { icon: TranslateIcon, tint: "#f472b6" },
  wallet_api: { icon: KeyRound, tint: "#2dd4bf" },
  refund: { icon: Undo2, tint: "#94a3b8" },
};
const DAY = 86_400_000;
const DAYS = 30;
const CHARGES_PER_PAGE = 8;

export default function BillingPage() {
  const workspaceId = useWorkspace();
  const t = useTranslations("billingPage");
  const tu = useTranslations("billingPage.usage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const toast = useAppToast();
  const [jobId, setJobId] = useQueryState("jobId");
  const state = useSharedSubscriptionState();
  const account = state.account;
  const catalog = state.catalog;
  const creditsEnabled = useFeatureFlagForPlan("credits.enabled", state.planFeatures);
  const subscriptionsEnabled = useFeatureFlagForPlan("subscriptions.enabled", state.planFeatures);
  const keepPlan = useAction(api.billing.actions.keepPlan);
  const topUps = useTopUps();
  const openPortal = useAction(api.billing.actions.openPortal);
  const [keeping, setKeeping] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [hover, setHover] = useState<Kind | null>(null);
  const [day, setDay] = useState<number | null>(null);

  // The chart's window starts at midnight 29 days ago, so its query only changes once a day. UTC midnight:
  // the app shows dates in UTC, so each bar's day is the date it's labelled with.
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const start = today.getTime() - (DAYS - 1) * DAY;
  const { data: spending } = useProtectedQuery(api.billing.usage.spending, inWorkspace(workspaceId, { since: start, days: DAYS }));
  // Charges are read a page at a time, newest first; the count totals the pages.
  const ofJob = jobId ? { jobId: jobId as Id<"extractionJobs"> } : {};
  const charges = useCursorPageAt("charges", api.billing.usage.listCharges, inWorkspace(workspaceId, ofJob), CHARGES_PER_PAGE, { scroll: false });
  const { data: counted } = useProtectedQuery(api.billing.usage.countCharges, inWorkspace(workspaceId, ofJob));
  // The last count stays up while another job's charges are counted.
  const [chargeCount, setChargeCount] = useState(counted);
  if (counted !== undefined && counted !== chargeCount) setChargeCount(counted);

  // Whether reports can be published, so the workspace's activations for them are worth a row.
  const publishing = useQuery(api.reports.settings.open, {});

  const ready = Boolean(account && catalog) && spending !== undefined && !charges.isLoading && chargeCount !== undefined && publishing !== undefined;
  if (!account || !catalog) return <Enter ready={false}>{null}</Enter>;

  const plan = state.resolvedPlan ?? "";
  const planInfo = findPlan(catalog, plan);
  const planName = (id: string) => findPlan(catalog, id)?.name || id;
  const onPaidPlan = state.onDefaultPlan === false;
  const price = onPaidPlan ? planInfo?.price : undefined;
  const monthly = planInfo?.credits?.interval === "month" ? planInfo.credits.included : 0;
  const cap = planCreditCap(catalog, plan);
  const fromPlan = Math.max(0, account.balance - account.purchased);
  const endsWithoutRenewal = account.nextPlan !== undefined && account.nextPlan === defaultPlanId(catalog);
  const change = account.changesAt !== undefined && account.nextPlan !== undefined && account.nextPlan !== plan;
  const date = (ms: number) => format.dateTime(new Date(ms), { month: "short", day: "numeric" });
  const money = (amount: number) =>
    format.number(amount, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", trailingZeroDisplay: "stripIfInteger" });

  // The current billing period, as Autumn reports it.
  const periodEnd = account.renewsAt ?? account.changesAt;
  const periodStart = account.periodStart;

  // Spending per day, stacked by kind.
  const days = Array.from({ length: DAYS }, (_, i) => ({ at: start + i * DAY, byKind: {} as Partial<Record<Kind, number>>, total: 0 }));
  const totals: Partial<Record<Kind, number>> = {};
  for (const s of spending?.page ?? []) {
    const d = days[s.day];
    if (!d) continue;
    d.byKind[s.kind] = (d.byKind[s.kind] ?? 0) + s.credits;
    d.total += s.credits;
    totals[s.kind] = (totals[s.kind] ?? 0) + s.credits;
  }
  const peak = Math.max(1, ...days.map((d) => d.total));
  const kinds = (Object.keys(totals) as Kind[]).sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  const spent = kinds.reduce((sum, k) => sum + (totals[k] ?? 0), 0);

  const keep = async () => {
    setKeeping(true);
    try {
      posthog.capture("pending_change_canceled", { current_plan: plan, context: "billing_page" });
      await keepPlan({});
    } catch (error) {
      console.error(error);
      toast.error(tc("somethingWentWrong"), t("failedToLoadDetails"));
    } finally {
      setKeeping(false);
    }
  };

  const updatePayment = async () => {
    setOpeningPortal(true);
    try {
      posthog.capture("billing_portal_opened", { current_plan: plan, context: "billing_page" });
      window.location.href = await openPortal({});
    } catch (error) {
      console.error("[BILLING] Error:", error);
      toast.billing.portalFailed(error);
      setOpeningPortal(false);
    }
  };

  return (
    <Enter ready={ready}>
      <div className="space-y-8">
        <PaymentReceived />

        {creditsEnabled ? (
          <section className="grid overflow-hidden rounded-2xl border border-border-subtle @min-[46rem]/configuration:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="space-y-5 p-5">
              <div>
                <p className="text-4xl font-semibold tabular-nums tracking-tight">{format.number(account.balance)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("credits")}</p>
              </div>
              {cap > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium">{planName(plan)}</span>
                    <span className="tabular-nums text-muted-foreground" data-testid="billing-free-credits">
                      {format.number(fromPlan)} / {format.number(cap)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (fromPlan / cap) * 100)}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {monthly > 0 && account.renewsAt !== undefined ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Repeat className="size-3.5" />
                        {t("refillOn", { amount: format.number(monthly), date: date(account.renewsAt) })}
                      </span>
                    ) : null}
                    {account.purchased > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Coins className="size-3.5" />
                        {t("bought", { amount: format.number(account.purchased) })}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {publishing ? <Activations left={account.activations === undefined ? 0 : account.activations} refill={account.activationsRefill ?? null} /> : null}
            </div>
            {topUps.bundles.length > 0 ? <TopUpBundles topUps={topUps} className="border-t border-border-subtle bg-inset @min-[46rem]/configuration:border-s @min-[46rem]/configuration:border-t-0" /> : null}
          </section>
        ) : null}

        {creditsEnabled ? (
          <Zone label={t("spendingLast30Days")}>
            <div className="rounded-2xl bg-inset px-4 pb-3 pt-4">
              <div className="flex h-28 items-end gap-1" onMouseLeave={() => setDay(null)} role="img" aria-label={t("spendingSummary", { credits: format.number(spent) })}>
                {days.map((d, i) => (
                  <div key={d.at} onMouseEnter={() => setDay(i)} className="flex h-full flex-1 flex-col justify-end">
                    <div
                      className={cn(
                        "flex min-h-[3px] flex-col-reverse overflow-hidden rounded-[3px] transition-opacity",
                        day !== null && day !== i && "opacity-35",
                      )}
                      style={{ height: `${(d.total / peak) * 100}%` }}
                    >
                      {d.total === 0 ? (
                        <span className="h-[3px] bg-foreground/10" />
                      ) : (
                        (Object.keys(d.byKind) as Kind[]).map((k) => (
                          <span
                            key={k}
                            className="transition-opacity"
                            style={{
                              height: `${((d.byKind[k] ?? 0) / d.total) * 100}%`,
                              backgroundColor: KINDS[k].tint,
                              opacity: hover && hover !== k ? 0.25 : 1,
                            }}
                          />
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-2xs tabular-nums text-muted-foreground">
                <span>{date(start)}</span>
                <span>{day !== null ? t("onDay", { credits: format.number(days[day]!.total), date: date(days[day]!.at) }) : t("today")}</span>
              </div>
            </div>
            {kinds.length > 0 ? (
              <div className="flex gap-1" onMouseLeave={() => setHover(null)}>
                {kinds.map((k) => (
                  <div
                    key={k}
                    onMouseEnter={() => setHover(k)}
                    className="flex min-w-[5.5rem] flex-col gap-1"
                    style={{ flexGrow: totals[k] ?? 0, flexBasis: 0 }}
                  >
                    <span className="h-1.5 rounded-full transition-opacity" style={{ backgroundColor: KINDS[k].tint, opacity: hover && hover !== k ? 0.25 : 1 }} />
                    <span className={cn("truncate text-2xs transition-colors", hover && hover !== k ? "text-muted-foreground/40" : "text-muted-foreground")}>
                      {tu(`kinds.${k}`)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ps-1 text-xs text-muted-foreground">{tu("empty")}</p>
            )}
          </Zone>
        ) : null}

        {subscriptionsEnabled || onPaidPlan ? (
          <Zone
            label={t("plan")}
            aside={
              subscriptionsEnabled ? (
                <Button asChild variant="ghost" size="sm" className="h-7">
                  <Link href="/pricing">
                    {t("comparePlans")} <ArrowRight />
                  </Link>
                </Button>
              ) : null
            }
          >
            <div className="space-y-4 rounded-2xl border border-border-subtle px-5 py-4">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-baseline gap-2">
                    <span data-testid="billing-plan-name" className="text-xl font-semibold tracking-tight">{planName(plan)}</span>
                    {price ? (
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {money(price.amount)} {t("perInterval", { interval: price.interval === "year" ? t("intervalYear") : t("intervalMonth") })}
                      </span>
                    ) : null}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {monthly > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Coins className="size-3.5" />
                        {t("creditsAMonth", { amount: format.number(monthly) })}
                      </span>
                    ) : null}
                    {account.card ? (
                      <span className="inline-flex items-center gap-1.5 capitalize">
                        <CreditCard className="size-3.5" />
                        {account.card.brand} {account.card.last4}
                      </span>
                    ) : null}
                  </p>
                </div>
                {change ? (
                  <Button data-testid="billing-keep-plan-button" variant="outline" size="sm" onClick={keep} disabled={keeping}>
                    {keeping && <Loader2 className="animate-spin" />}
                    {tc("keepCurrentPlan")}
                  </Button>
                ) : null}
              </div>
              {account.pastDue ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 py-2 ps-3 pe-2 text-sm text-destructive">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="size-4 shrink-0" />
                    {/* The payment that failed, and the day Stripe stops retrying and the plan ends (#40). */}
                    {account.unpaid ? t("paymentFailedEnds", { amount: money(account.unpaid.amount), plan: planName(plan), date: date(account.unpaid.since + DAYS_TO_PAY * 86_400_000) }) : t("paymentFailedNotice")}
                  </span>
                  {account.unpaid?.url ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={account.unpaid.url}>{t("fixPayment")}</a>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={updatePayment} disabled={openingPortal}>
                      {openingPortal && <Loader2 className="animate-spin" />}
                      {t("fixPayment")}
                    </Button>
                  )}
                </div>
              ) : null}
              {periodEnd !== undefined && periodStart !== undefined ? (
                <div className="space-y-1.5">
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="absolute inset-y-0 start-0 rounded-full bg-primary"
                      style={{ width: `${Math.min(100, Math.max(0, ((now.getTime() - periodStart) / (periodEnd - periodStart)) * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                    <span>{date(periodStart)}</span>
                    {change ? (
                      <span data-testid="billing-pending-change-banner" className="inline-flex items-center gap-1.5 ink-info">
                        <CalendarClock className="size-3.5" />
                        {endsWithoutRenewal
                          ? t("endsOn", { date: date(periodEnd) })
                          : t("changesOn", { plan: planName(account.nextPlan!), date: date(periodEnd) })}
                      </span>
                    ) : (
                      <span data-testid="billing-renewal-date" className="inline-flex items-center gap-1.5">
                        <Repeat className="size-3.5" />
                        {t("renewsOnDate", { date: date(periodEnd) })}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </Zone>
        ) : null}

        {creditsEnabled && charges.items.length > 0 ? (
          <Zone
            label={jobId ? t("jobCharges") : t("charges")}
            aside={
              jobId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => void setJobId(null)}
                >
                  {tu("showAll")}
                </Button>
              ) : null
            }
          >
            <Paged pager={{ list: charges, size: CHARGES_PER_PAGE, total: chargeCount }} rowHeight={61} label={t("chargesLabel")}>
              <ul className={LIST}>
                {charges.items.map((c) => {
                  const kind = KINDS[c.kind];
                  return (
                    <li
                      key={c._id}
                      onMouseEnter={() => setHover(c.kind)}
                      onMouseLeave={() => setHover(null)}
                      className={cn("flex items-center gap-3 p-3 transition-opacity", hover && hover !== c.kind && "opacity-40")}
                    >
                      <Tile icon={kind.icon} tint={kind.tint} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {c.jobId ? (
                            <Link href={`/extraction/${c.jobId}`} className="hover:underline">
                              {c.description}
                            </Link>
                          ) : (
                            c.description
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{tu(`kinds.${c.kind}`)}</p>
                      </div>
                      <time dateTime={new Date(c.createdAt).toISOString()} className="text-xs tabular-nums text-muted-foreground">
                        {/* `now` ticks once a minute: a charge made since is just now, not in the future. */}
                        {format.relativeTime(c.createdAt, Math.max(now.getTime(), c.createdAt))}
                      </time>
                      <span className="w-20 text-end font-mono text-sm tabular-nums">
                        −{format.number(c.credits)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Paged>
          </Zone>
        ) : null}
      </div>
    </Enter>
  );
}

/**
 * The workspace's activations for Openscholar Reports, beside its credits: how many are left and what they refill by.
 * Each makes a report live with nothing to pay; past them, activating one buys it.
 */
function Activations({ left, refill }: { /** Null for no limit. */ left: number | null; refill: RefillInterval | null }) {
  const t = useTranslations("billingPage.activations");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset text-muted-foreground">
        <BadgeCheck className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          {t("title")}
          <StatusChip tone={left === 0 ? "neutral" : "success"}>
            {/* A balance that refills says so even when it's empty: more are on the way. */}
            {left === null ? t("unlimited") : refill ? t("leftRefills", { count: left, interval: refill }) : left === 0 ? t("none") : t("left", { count: left })}
          </StatusChip>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>
      </div>
      <Button asChild variant="ghost" size="sm" className="h-7">
        <Link href="/publish">
          {t("publish")} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}
