"use client";
"use no memo"; // try/finally in handlers

// Organization plans on the Pricing page (#652, #862): a free organization has up to FREE_MEMBERS
// members, and Team the seats it buys, at least one for each member and invitation, their credits in one pool.

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Building2, Library, Users } from "@/components/icons";
import { ContactButton } from "@/components/alpha-notices";
import { planIcon } from "@/components/billing/plan-icon";
import { contactPage } from "@/lib/billing/contact";
import { useSeatBilling } from "@/lib/feature-flags/hook";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { PlanCard } from "@/components/billing/plan-card";
import { SeatStepper } from "@/components/billing/seat-stepper";
import Link from "@/components/workspace-link";
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
import type { FunctionReturnType } from "convex/server";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { findPlan } from "@/lib/billing/catalog";
import { FREE_MEMBERS, ORGANIZATION_PLAN, SEAT_PLAN, SOUTHERN_PLAN, TEAM_PLAN } from "@/lib/billing/plans";
import { getErrorMessage, payOpenAction } from "@/lib/toast/use-app-toast";
import { useWorkspaceAction } from "@/lib/workspaces/url";
import { Guarded, useCurrentWorkspace } from "./parts";
import { CreateOrganization } from "./switcher";

/** The seats Team's price is shown for outside an organization until the person picks. */
const SEATS = 8;

/** The workspace the page is in, as the server read it for the first paint. */
export type CurrentWorkspace = NonNullable<ReturnType<typeof useCurrentWorkspace>>;

export function OrganizationPlans({ featureName, initial, libraries }: { featureName: (id: string) => string; initial?: CurrentWorkspace; libraries?: boolean }) {
  return useSeatBilling() ? <TeamPlans featureName={featureName} initial={initial} /> : <AlphaPlans initial={initial} libraries={libraries} />;
}

/** During the public alpha: Free has everything but Evidence Libraries, which are switched on by request and leave the plan as it is. */
function AlphaPlans({ initial, libraries }: { initial?: CurrentWorkspace; libraries?: boolean }) {
  const t = useTranslations("pricing.organizations");
  const tp = useTranslations("pricing");
  const tc = useTranslations("common");
  const tAlpha = useTranslations("alpha");
  const { phase } = useAuthReadiness();
  const signIn = useSignInRedirect();
  const workspace = useCurrentWorkspace() ?? initial;
  const organization = workspace?.kind === "organization" ? workspace : undefined;
  const { catalog, resolvedPlan } = useSubscriptionState();
  // As the server read it until the browser has, so the card is drawn as it stays.
  const features = useWorkspaceFeatures().data;
  const opened = organization !== undefined && (features?.evidenceLibraries ?? libraries) === true;
  const [creating, setCreating] = useState(false);
  const free = catalog && findPlan(catalog, ORGANIZATION_PLAN);
  const southern = catalog && findPlan(catalog, SOUTHERN_PLAN);
  if (!free) return null;
  const onSouthern = !!organization && resolvedPlan === southern?.id;
  const limits = free.limits;
  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <PlanCard
          testId="pricing-plan-free-organization"
          index={0}
          current={!!organization && !onSouthern}
          badges={organization && !onSouthern ? [{ tone: "success", label: t("yourOrganizationsPlan") }] : []}
          icon={Building2}
          name={free.name}
          price={<div className="text-4xl font-bold break-words">{tp("freePrice")}</div>}
          description={t("alphaFreeDescription")}
          features={[
            t("noMemberLimit"),
            ...(free.credits?.interval === "month" ? [t("sharedCreditsAMonth", { credits: free.credits.included })] : []),
            t("capsForEachMember"),
            tp("papersRunning", { running: limits?.concurrency ?? 0 }),
            tp("papersInRequest", { request: limits?.request_papers ?? 0 }),
            tp("unlimitedCollectionsAndGuests"),
          ]}
        >
          {phase !== "authenticated" ? (
            <Button className="w-full" onClick={signIn}>
              {tc("signIn")}
            </Button>
          ) : organization ? (
            <Button className="w-full" variant="outline" disabled>
              {tc("currentPlan")}
            </Button>
          ) : (
            <Button className="w-full" variant="outline" onClick={() => setCreating(true)}>
              {t("createOrganization")}
            </Button>
          )}
        </PlanCard>
        {southern ? (
          <PlanCard
            testId="pricing-plan-southern-organization"
            index={1}
            current={onSouthern}
            badges={onSouthern ? [{ tone: "success", label: t("yourOrganizationsPlan") }] : []}
            icon={planIcon(southern.id)}
            name={southern.name}
            price={<div className="text-4xl font-bold">{tp("onRequest")}</div>}
            description={tp("southernDescription")}
            features={[...(southern.credits?.interval === "month" ? [t("sharedCreditsAMonth", { credits: southern.credits.included })] : []), tp("southernFeature1"), t("southernFeature2")]}
          >
            {onSouthern ? (
              <Button className="w-full" variant="outline" disabled>
                {tc("currentPlan")}
              </Button>
            ) : (
              <ContactButton href={contactPage("southern")} label={tAlpha("requestSouthern")} />
            )}
          </PlanCard>
        ) : null}
        <PlanCard
          testId="pricing-plan-evidence-libraries"
          index={2}
          current={opened}
          badges={opened ? [{ tone: "success", label: t("librariesOn") }] : []}
          icon={Library}
          name={t("librariesName")}
          price={<div className="text-4xl font-bold">{tp("onRequest")}</div>}
          description={t("librariesDescription")}
          features={[t("librariesFeature1"), t("librariesFeature2")]}
        >
          {opened ? (
            <Button asChild variant="outline" className="w-full">
              <Link href="/evidence-communities">{t("openLibraries")}</Link>
            </Button>
          ) : (
            <ContactButton href={contactPage("community")} label={tAlpha("requestLibraries")} variant="outline" />
          )}
        </PlanCard>
      </div>
      <CreateOrganization open={creating} onOpenChange={setCreating} />
    </>
  );
}

function TeamPlans({ featureName, initial }: { featureName: (id: string) => string; initial?: CurrentWorkspace }) {
  const t = useTranslations("pricing.organizations");
  const tp = useTranslations("pricing");
  const ts = useTranslations("workspaces.settings");
  const tc = useTranslations("common");
  const format = useFormatter();
  const { phase } = useAuthReadiness();
  const signIn = useSignInRedirect();
  // Under an organization's address the server read it, so the cards are drawn as they'll stay.
  const workspace = useCurrentWorkspace() ?? initial;
  const organizationId = workspace?.kind === "organization" ? workspace.workspaceId : undefined;
  // In full: the switcher's count stops at a hundred and one, and every member and invitation takes a seat.
  const counts = useProtectedQuery(api.billing.seats.counts, organizationId ? { workspaceId: organizationId } : "skip").data;
  // Free has no Evidence Libraries: the move waits on them, as deleting the organization does (workspaces/settings.tsx).
  const holdsLibrary = useProtectedQuery(api.organizations.queries.summary, organizationId ? { workspaceId: organizationId } : "skip").data?.library !== undefined;
  const { account, catalog } = useSubscriptionState();
  const moveToTeam = useWorkspaceAction(api.billing.actions.moveToTeam);
  const previewTeam = useWorkspaceAction(api.billing.actions.previewTeam);
  const moveToFree = useWorkspaceAction(api.billing.actions.moveToFree);
  const keepPlan = useWorkspaceAction(api.billing.actions.keepPlan);
  const [asking, setAsking] = useState<"team" | "free" | null>(null);
  // Autumn's own figure for the seats picked, read before the confirmation opens; the move is for the seats it was read for.
  const [preview, setPreview] = useState<(FunctionReturnType<typeof api.billing.actions.previewTeam> & { seats: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [picked, setSeats] = useState<number>();

  const free = catalog && findPlan(catalog, ORGANIZATION_PLAN);
  const team = catalog && findPlan(catalog, TEAM_PLAN);
  const seat = catalog && findPlan(catalog, SEAT_PLAN);
  const signedIn = phase === "authenticated";
  if (!free || !team || !seat?.price) return null;

  const organization = workspace?.kind === "organization" ? workspace : undefined;
  const onTeam = organization?.plan === TEAM_PLAN;
  const members = counts?.members ?? organization?.members ?? 0;
  const invitations = counts?.invitations ?? 0;
  // Each member and pending invitation takes a seat (#863): an organization buys at least that many, and is shown that many until the person picks.
  const fewest = organization ? Math.max(1, members + invitations) : 1;
  // On Team, the seats bought, read with the page so the card is drawn as it stays.
  const seats = onTeam ? (counts?.seats ?? organization?.seats ?? 0) : Math.max(fewest, picked ?? (organization ? fewest : SEATS));
  // Team waits for its renewal to become Free (#862).
  const toFree = onTeam && account?.changesAt !== undefined ? account.changesAt : undefined;
  const date = (at: number) => format.dateTime(new Date(at), { year: "numeric", month: "short", day: "numeric" });
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
      showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong")), { action: payOpenAction(error, tc("payNow")) });
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
  /** Reads Autumn's figure for the seats picked, then asks to confirm it. */
  const askTeam = async () => {
    setBusy(true);
    try {
      setPreview({ ...(await previewTeam({ seats })), seats });
      setAsking("team");
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong")), { action: payOpenAction(error, tc("payNow")) });
    }
    setBusy(false);
  };

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
          price={<div className="text-4xl font-bold break-words">{tp("freePrice")}</div>}
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
                : toFree !== undefined
                  ? action(t("movesOn", { date: date(toFree) }), () => {}, notAdmin ?? t("movesOn", { date: date(toFree) }))
                  : action(t("moveTo", { plan: free.name }), () => setAsking("free"), notAdmin ?? (members + invitations > FREE_MEMBERS ? ts("freeUpTo", { count: FREE_MEMBERS }) : holdsLibrary ? ts("moveLibrariesFirst") : null))}
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
                {onTeam ? (
                  // Bought: the count changes on the billing page.
                  <span className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-inset px-3 text-sm font-semibold tabular-nums">
                    <Users className="size-3.5 text-muted-foreground" />
                    {t("seats", { count: seats })}
                  </span>
                ) : (
                  <SeatStepper seats={seats} fewest={fewest} why={organization ? t("seatsInUse", { members, invitations }) : null} onChange={(next) => !busy && setSeats(next)} />
                )}
                <span className="text-xs text-muted-foreground">{t("aSeat", { price: money(seatPrice) })}</span>
              </div>
            </div>
          }
          description={t("teamDescription")}
          features={[t("sharedCreditsAMonth", { credits: seatCredits * seats }), t("capsForEachMember"), ...collections(team), ...atOnce(team), ...perJob(team), ...team.features.map(featureName)]}
        >
          {!signedIn ? (
            signInButton
          ) : !onTeam ? (
            action(t("moveTo", { plan: team.name }), () => void askTeam(), organization ? notAdmin : t("organizationsOnly"), true)
          ) : notAdmin ? (
            current
          ) : toFree !== undefined ? (
            action(t("keepTeam", { plan: team.name }), () => void move(() => keepPlan({}).then(() => null)), null)
          ) : (
            <Button asChild variant="outline" className="w-full">
              <Link href="/settings/billing">{t("changeSeats")}</Link>
            </Button>
          )}
        </PlanCard>
      </div>

      <UpgradeConfirmationDialog
        open={asking === "team" && !!organization && !onTeam && !notAdmin && preview !== null}
        onOpenChange={(open) => !busy && !open && setAsking(null)}
        onConfirm={() => preview && void move(() => moveToTeam({ seats: preview.seats }))}
        isConfirming={busy}
        preview={
          preview && {
            currency: preview.currency,
            immediateChargeCents: Math.round(preview.dueNow * 100),
            currentPlan: free.name,
            targetPlan: team.name,
            targetPlanCreditsPerMonth: preview.seats * seatCredits,
            renewsAt: preview.renewsAt,
            lineItems: preview.lineItems.map((item) => ({ description: item.description, amountCents: Math.round(item.amount * 100), currency: preview.currency })),
          }
        }
        cardBrand={preview?.card?.brand}
        cardLast4={preview?.card?.last4}
      />

      <AlertDialog open={asking === "free"} onOpenChange={(open) => !busy && !open && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("moveToFreeTitle", { organization: organization?.name ?? "", plan: free.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("moveToFreeAtRenewal", { organization: organization?.name ?? "", date: account?.renewsAt ? date(account.renewsAt) : "", plan: free.name, members: FREE_MEMBERS, credits: free.credits?.included ?? 0 })}</AlertDialogDescription>
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
