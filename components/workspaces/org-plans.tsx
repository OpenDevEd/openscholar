"use client";
"use no memo"; // try/finally in handlers

// Organization plans on the Pricing page (#652): a free organization has up to FREE_MEMBERS
// members, and Team a seat for each member, their credits in one pool.

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Building2, Minus, Plus, Users } from "@/components/icons";
import { PlanCard } from "@/components/billing/plan-card";
import { UpgradeConfirmationDialog } from "@/components/billing/upgrade-confirmation-dialog";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AnimatedNumber } from "@/components/screening/parts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { CatalogPlan } from "@/convex/billing/validators";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { findPlan } from "@/lib/billing/catalog";
import { FREE_MEMBERS, ORGANIZATION_PLAN, SEAT_PLAN, TEAM_PLAN } from "@/lib/billing/plans";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useWorkspaceAction } from "@/lib/workspaces/url";
import { Guarded, useCurrentWorkspace } from "./parts";
import { CreateOrganization } from "./switcher";

/** The seats Team's price is shown for until the person picks, and the fewest it goes down to. */
const SEATS = 8;
const FEWEST_SEATS = 2;

/** The workspace the page is in, as the server read it for the first paint. */
export type CurrentWorkspace = NonNullable<ReturnType<typeof useCurrentWorkspace>>;

export function OrganizationPlans({ featureName, initial }: { featureName: (id: string) => string; initial?: CurrentWorkspace }) {
  const t = useTranslations("pricing.organizations");
  const tp = useTranslations("pricing");
  const ts = useTranslations("workspaces.settings");
  const tc = useTranslations("common");
  const tu = useTranslations("upgradeDialog");
  const format = useFormatter();
  const { phase } = useAuthReadiness();
  const signIn = useSignInRedirect();
  // Under an organization's address the server read it, so the cards are drawn as they'll stay.
  const workspace = useCurrentWorkspace() ?? initial;
  const organizationId = workspace?.kind === "organization" ? workspace.workspaceId : undefined;
  // In full: the switcher's count stops at a hundred and one, and a move charges for every member.
  const counts = useProtectedQuery(api.billing.seats.counts, organizationId ? { workspaceId: organizationId } : "skip").data;
  const { account, catalog } = useSubscriptionState();
  const moveToTeam = useWorkspaceAction(api.billing.actions.moveToTeam);
  const moveToFree = useWorkspaceAction(api.billing.actions.moveToFree);
  const [asking, setAsking] = useState<"team" | "free" | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [seats, setSeats] = useState(SEATS);

  const free = catalog && findPlan(catalog, ORGANIZATION_PLAN);
  const team = catalog && findPlan(catalog, TEAM_PLAN);
  const seat = catalog && findPlan(catalog, SEAT_PLAN);
  const signedIn = phase === "authenticated";
  if (!free || !team || !seat?.price) return null;

  const organization = workspace?.kind === "organization" ? workspace : undefined;
  const onTeam = organization?.plan === TEAM_PLAN;
  const members = counts?.members ?? organization?.members ?? 0;
  const seatPrice = seat.price.amount;
  const seatCredits = seat.credits?.included ?? 0;
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "USD", minimumFractionDigits: 0 });
  const notAdmin = organization && organization.role !== "admin" ? t("onlyAdmins", { organization: organization.name }) : null;

  // A limit the plan doesn't set isn't named; null is unlimited.
  const collections = ({ limits }: CatalogPlan) => (limits?.collections === undefined ? [] : [limits.collections === null ? ts("unlimitedCollections") : ts("includedCollections", { count: limits.collections })]);
  const atOnce = ({ limits }: CatalogPlan) => (limits?.concurrency == null ? [] : [ts("papersAtOnce", { count: limits.concurrency })]);
  const perJob = ({ limits }: CatalogPlan) => (limits?.request_papers === undefined ? [] : [limits.request_papers === null ? ts("anyPapersAJob") : ts("papersAJob", { count: limits.request_papers })]);

  /** Runs a move, and says what went wrong in a toast when it fails. */
  const move = async (work: () => Promise<{ url: string | null } | null>) => {
    setBusy(true);
    try {
      const result = await work();
      // Off to save a card, after which Autumn makes the move: the page stays busy until it's gone.
      if (result?.url) return void window.location.assign(result.url);
      setAsking(null);
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong")));
    }
    setBusy(false);
  };

  const action = (label: string, onClick: () => void, reason: string | null, primary = false) => (
    <Guarded reason={reason}>
      <Button className="w-full" variant={primary ? "default" : "outline"} disabled={busy || reason !== null} onClick={onClick}>
        {label}
      </Button>
    </Guarded>
  );
  const current = (
    <Button className="w-full" variant="outline" disabled>
      {tc("currentPlan")}
    </Button>
  );
  const signInButton = action(tc("signInToSubscribe"), signIn, null, true);
  const charge = members * seatPrice;

  return (
    <>
      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
        <PlanCard
          testId="pricing-plan-free-organization"
          index={0}
          current={!!organization && !onTeam}
          badges={organization && !onTeam ? [{ tone: "success", label: t("yourOrganizationsPlan") }] : []}
          icon={Building2}
          name={t("freeOrganization")}
          price={<div className="text-4xl font-bold">{tp("freePrice")}</div>}
          description={t("freeDescription")}
          features={[
            ts("upToMembers", { count: FREE_MEMBERS }),
            ...(free.credits?.interval === "month" ? [t("sharedCreditsAMonth", { credits: free.credits.included })] : []),
            ...collections(free),
            ...perJob(free),
          ]}
        >
          {!signedIn
            ? signInButton
            : !organization
              ? action(t("createOrganization"), () => setCreating(true), null)
              : !onTeam
                ? current
                : action(t("moveTo", { plan: free.name }), () => setAsking("free"), notAdmin ?? (members + (counts?.invitations ?? 0) > FREE_MEMBERS ? ts("freeUpTo", { count: FREE_MEMBERS }) : null))}
        </PlanCard>

        <PlanCard
          testId="pricing-plan-team"
          index={1}
          current={onTeam}
          badges={onTeam ? [{ tone: "success", label: t("yourOrganizationsPlan") }] : []}
          icon={Users}
          name={team.name}
          price={
            <div className="space-y-3">
              <div className="text-4xl font-bold tabular-nums">
                $<AnimatedNumber value={seatPrice * seats} />
                <span className="text-lg font-normal text-muted-foreground"> {t("aMonth")}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-full bg-inset p-1">
                  <button type="button" aria-label={t("oneSeatFewer")} disabled={seats <= FEWEST_SEATS} onClick={() => setSeats(seats - 1)} className="flex size-7 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="min-w-16 whitespace-nowrap px-1 text-center text-sm font-semibold tabular-nums">{t("seats", { count: seats })}</span>
                  <button type="button" aria-label={t("oneSeatMore")} onClick={() => setSeats(seats + 1)} className="flex size-7 items-center justify-center rounded-full hover:bg-muted">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <span className="text-xs text-muted-foreground">{t("aSeat", { price: money(seatPrice) })}</span>
              </div>
            </div>
          }
          description={t("teamDescription")}
          features={[t("sharedCreditsAMonth", { credits: seatCredits * seats }), t("capsForEachMember"), ...collections(team), ...atOnce(team), ...perJob(team), ...team.features.map(featureName)]}
        >
          {!signedIn ? signInButton : onTeam ? current : action(t("moveTo", { plan: team.name }), () => setAsking("team"), organization ? notAdmin : t("organizationsOnly"), true)}
        </PlanCard>
      </div>

      <UpgradeConfirmationDialog
        open={asking === "team" && !!organization && !onTeam && !notAdmin && !!counts}
        onOpenChange={(open) => !busy && !open && setAsking(null)}
        onConfirm={() => void move(() => moveToTeam({ seats: members }))}
        isConfirming={busy}
        preview={{
          currency: "usd",
          immediateChargeCents: Math.round(charge * 100),
          currentPlan: free.name,
          targetPlan: team.name,
          targetPlanCreditsPerMonth: members * seatCredits,
          remainingDays: 0,
          lineItems: [{ description: t("seatsAt", { count: members, price: money(seatPrice) }), amountCents: Math.round(charge * 100), currency: "usd" }],
        }}
        cardBrand={account?.card?.brand}
        cardLast4={account?.card?.last4}
      />

      <AlertDialog open={asking === "free"} onOpenChange={(open) => !busy && !open && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("moveToFreeTitle", { organization: organization?.name ?? "", plan: free.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("moveToFreeDetail", { count: members, members: FREE_MEMBERS, credits: free.credits?.included ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void move(() => moveToFree({}));
              }}
            >
              {t("moveTo", { plan: free.name })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateOrganization open={creating} onOpenChange={setCreating} />
    </>
  );
}
