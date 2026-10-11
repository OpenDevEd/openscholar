"use client";

// An organization's settings (#651): the organization itself, its members and invitations, and
// its plan and credits. Your own workspace is just you, so its plan sits with your account.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { AlertCircle, ArrowRight, CalendarClock, Camera, Check, ChevronRight, Coins, Copy, CreditCard, EvidenceLibrariesIcon, FileSearch, Folder, Hourglass, ListFilter, LogOut, Mail, Pencil, Repeat, RotateCcw, Search, Trash2, Users, X } from "@/components/icons";
import { IconButton } from "@/components/assistant/parts";
import { EASE } from "@/components/settings/model-map";
import { Enter, LIST, Paged, Segmented, Tile, Zone } from "@/components/settings/parts";
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
import { SeatStepper } from "@/components/billing/seat-stepper";
import { UpgradeConfirmationDialog } from "@/components/billing/upgrade-confirmation-dialog";
import { SeatsMockPanel } from "@/components/seats-mock/panel";
import { seatChange, useOrganizationSeats } from "@/components/seats-mock/store";
import { AnimatedNumber } from "@/components/screening/parts";
import { AnimatePresence } from "motion/react";
import { DeleteLibraryDialog } from "@/components/evidence-libraries/configuration/delete-library-dialog";
import { EmailAvatar, IdentityRow, ROLE_ICONS, RoleLabel } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { showStyledToast } from "@/components/ui/sonner";
import { TooltipHint } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useHydrated } from "@/lib/use-hydrated";
import { findPlan, planCreditCap } from "@/lib/billing/catalog";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { ORGANIZATION_COLOURS } from "@/lib/workspaces/colours";
import { inWorkspace, useWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { Guarded, MemberFaces, Opening, PlanChip, usePlanOf, useCurrentWorkspace, WorkspaceTile, workspaceTint } from "./parts";
import { MemberSpending, useMemberSpending } from "./spending";
import { FREE_MEMBERS, ORGANIZATION_PLAN, SEAT_PLAN, TEAM_PLAN } from "@/lib/billing/plans";

/** Rows a page of members holds. */
const PER_PAGE = 10;
/** Seats the members card draws one segment for each of; past it, one bar. */
const SEAT_SEGMENTS = 20;
/** A row with a photo, and its divider. */
const ROW_HEIGHT = 61;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Role = "admin" | "member";

/** The organization the page is in, once the switcher's list has it. */
function useOrganization() {
  const workspaceId = useWorkspace();
  const current = useCurrentWorkspace();
  const organization = current?.kind === "organization" ? current : undefined;
  return { workspaceId, organization, admin: organization?.role === "admin" };
}

/** Runs `work`, and says what went wrong in a toast when it fails. */
function useAttempt() {
  const tc = useTranslations("common");
  const [busy, setBusy] = useState<string | null>(null);
  const attempt = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      return true;
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong")));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, attempt };
}

// ─── General ─────────────────────────────────────────────────────────────

/** What General shows, read on the server with the page, so it stands at its full height from the first frame. */
export type GeneralInitial = { organization: FunctionReturnType<typeof api.organizations.queries.workspace>; summary: FunctionReturnType<typeof api.organizations.queries.summary> };

export function WorkspaceGeneral({ initial }: { initial?: GeneralInitial }) {
  const t = useTranslations("workspaces.settings");
  const tw = useTranslations("workspaces");
  const tc = useTranslations("common");
  const router = useRouter();
  const live = useOrganization();
  const { workspaceId } = live;
  const organization = live.organization ?? (initial?.organization.kind === "organization" ? initial.organization : undefined);
  const admin = organization?.role === "admin";
  const summary = useProtectedQuery(api.organizations.queries.summary, inWorkspace(workspaceId, {})).data ?? initial?.summary;
  // The page shows with what the server read, a moment before the browser knows the workspace its changes go to. What
  // changes it at a click waits for that; the rest asks or opens a form first, and the workspace is known by then.
  const ready = workspaceId !== undefined;
  const hydrated = useHydrated();
  const rename = useWorkspaceAction(api.organizations.manage.rename);
  const setColour = useWorkspaceMutation(api.organizations.manage.setColour);
  const setLogo = useWorkspaceAction(api.organizations.manage.setLogo);
  const leave = useWorkspaceAction(api.organizations.manage.leave);
  const remove = useWorkspaceAction(api.organizations.manage.deleteOrganization);
  const { busy, attempt } = useAttempt();
  const [draft, setDraft] = useState<string | null>(null);
  const [logo, setLogoPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  // The organization's plan no longer includes Evidence Libraries, so the library's own pages are shut: it's deleted from here (#652).
  const [removing, setRemoving] = useState(false);
  const restartTeardown = useMutation(api.evidenceLibraries.teardown.restartDevelopmentTeardown);
  if (!organization || !summary) return <Enter ready={false}>{null}</Enter>;

  const { name, slug } = organization;
  // The page can be drawn on the server now that its data comes with it, where there is no window to ask.
  const address = `${hydrated ? window.location.host : ""}/o/${slug}`;
  const tint = workspaceTint(organization);
  const lastAdmin = admin && summary.admins === 1;
  const contents = [
    { icon: Folder, tint: "#e8890c", label: t("collections"), n: summary.collections, href: "/library" },
    { icon: Search, tint: "#60a5fa", label: t("searches"), n: summary.searches, href: "/history" },
    { icon: ListFilter, tint: "#34d399", label: t("screenings"), n: summary.screenings, href: "/screening" },
    { icon: FileSearch, tint: "#818cf8", label: t("extractions"), n: summary.extractions, href: "/extraction" },
    { icon: EvidenceLibrariesIcon, tint: "#2dd4bf", label: t("evidenceLibraries"), n: summary.libraries, href: "/evidence-libraries" },
  ];
  const saveName = () => {
    const next = draft?.trim();
    if (!next || next === name) return setDraft(null);
    void attempt("name", () => rename({ name: next })).then((done) => done && setDraft(null));
  };
  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setLogoPreview(preview);
    // The new logo shows once Clerk has it; the preview stands in until then.
    void attempt("logo", async () => setLogo({ image: await file.arrayBuffer(), contentType: file.type })).finally(() => {
      setLogoPreview(null);
      URL.revokeObjectURL(preview);
    });
  };
  const confirmed = async () => {
    const done = await attempt(confirm ?? "", () => (confirm === "delete" ? remove({}) : leave({})));
    setConfirm(null);
    if (done) router.push("/");
  };

  return (
    <Enter ready>
      <div className="space-y-8">
        {/* The same header as your profile: the organization's logo, its name and what it is. */}
        <section className="flex items-center gap-6">
          <label className={cn("group relative shrink-0 overflow-hidden rounded-3xl", admin && "cursor-pointer")}>
            {logo ? <img src={logo} alt="" className="size-24 object-cover" /> : <WorkspaceTile workspace={organization} size="xl" />}
            {admin ? (
              <>
                <span className={cn("absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-xs font-medium text-white transition-opacity group-hover:opacity-100 group-focus-within:opacity-100", busy === "logo" ? "opacity-100" : "opacity-0")}>
                  <Camera className="size-5" />
                  {t("changeLogo")}
                </span>
                <input type="file" accept="image/*" className="sr-only" aria-label={t("changeLogo")} disabled={!ready || busy === "logo"} onChange={(e) => pickLogo(e.target.files?.[0])} />
              </>
            ) : null}
          </label>

          <div className="min-w-0 flex-1 space-y-2.5">
            {draft !== null ? (
              <form
                className="flex max-w-xl items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveName();
                }}
              >
                <Input autoFocus aria-label={t("organizationName")} value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} className="h-10" />
                <Button type="submit" size="icon" className="size-10 shrink-0" aria-label={t("saveName")} disabled={!draft.trim() || busy === "name"}>
                  <Check />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={() => setDraft(null)} aria-label={tc("cancel")}>
                  <X />
                </Button>
              </form>
            ) : admin ? (
              <button type="button" onClick={() => setDraft(name)} className="group flex max-w-full items-center gap-2 text-left" aria-label={t("rename")}>
                <span className="truncate text-3xl font-semibold tracking-tight">{name}</span>
                <Pencil className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ) : (
              <p className="truncate text-3xl font-semibold tracking-tight">{name}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <PlanChip workspace={organization} />
              <Link href="/settings/workspace/members" className="flex h-7 items-center gap-2 rounded-full pl-1 pr-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <MemberFaces workspaceId={workspaceId} label={tw("members", { count: organization.members ?? 0 })} count={organization.members} />
                <span className="tabular-nums">{tw("members", { count: organization.members ?? 0 })}</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(`${window.location.origin}/o/${slug}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 font-mono text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("copyAddress", { address })}
              >
                <span className="truncate">{address}</span>
                {copied ? <Check className="size-3.5 shrink-0 text-success" /> : <Copy className="size-3.5 shrink-0" />}
              </button>
            </div>
          </div>
        </section>

        {admin ? (
          <Zone label={t("colour")}>
            <div role="radiogroup" aria-label={t("colour")} className="flex flex-wrap gap-2">
              {ORGANIZATION_COLOURS.map((swatch) => {
                const on = swatch === tint;
                return (
                  <button
                    key={swatch}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={swatch}
                    onClick={ready ? () => void attempt("colour", () => setColour({ colour: swatch })) : undefined}
                    className="relative flex size-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: `color-mix(in oklab, ${swatch} 22%, var(--background))` }}
                  >
                    <span className="size-5 rounded-full" style={{ backgroundColor: swatch }} />
                    {on ? <motion.span layoutId="workspace-colour" className="absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${swatch}` }} transition={{ duration: 0.3, ease: EASE }} /> : null}
                  </button>
                );
              })}
            </div>
          </Zone>
        ) : null}

        <Zone label={t("inName", { name })}>
          <ul className={LIST}>
            {contents.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className="flex items-center gap-3 p-3 transition-colors hover:bg-muted">
                  <Tile icon={c.icon} tint={c.tint} />
                  <span className="flex-1 text-sm font-medium">{c.label}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{c.n}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Zone>

        <Zone label={t("leaveOrDelete")}>
          <ul className={LIST}>
            <li className="flex items-center gap-3 p-3 pl-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("leaveName", { name })}</p>
                <p className="text-xs text-muted-foreground">{t("leaveDetail")}</p>
              </div>
              <Guarded reason={lastAdmin ? t("makeAdminFirst") : null}>
                <Button variant="outline" size="sm" onClick={() => setConfirm("leave")}>
                  <LogOut /> {t("leave")}
                </Button>
              </Guarded>
            </li>
            {admin ? (
              <li className="flex items-center gap-3 p-3 pl-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t("deleteName", { name })}</p>
                  <p className="text-xs text-muted-foreground">
                    {summary.removable?.state === "deleting" ? t("libraryBeingDeleted", { library: summary.removable.name })
                      : summary.removable?.state === "failed" ? t("libraryDeleteFailed", { library: summary.removable.name })
                      : summary.library ? t("stillHasLibrary", { library: summary.library })
                      : t("deleteDetail", { count: organization.members ?? 0 })}
                  </p>
                </div>
                {summary.removable?.state === "held" ? (
                  <Button variant="outline" size="sm" onClick={() => setRemoving(true)}>
                    <Trash2 /> {t("deleteLibrary")}
                  </Button>
                ) : summary.removable?.state === "failed" ? (
                  // A deletion that stopped part-way is tried again here: the libraries' own list, where it is otherwise, is shut with the plan.
                  <Button variant="outline" size="sm" disabled={!ready || busy === "library"} onClick={() => void attempt("library", () => restartTeardown({ libraryId: summary.removable!._id }))}>
                    <RotateCcw /> {tc("retry")}
                  </Button>
                ) : null}
                <Guarded reason={summary.library ? t("moveLibrariesFirst") : null}>
                  <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirm("delete")}>
                    <Trash2 /> {t("delete")}
                  </Button>
                </Guarded>
              </li>
            ) : null}
          </ul>
        </Zone>
      </div>

      {summary.removable ? (
        <DeleteLibraryDialog libraryId={summary.removable._id} name={summary.removable.name} address={summary.removable.publicAddress} open={removing} onOpenChange={setRemoving} />
      ) : null}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? t("deleteName", { name }) : t("leaveName", { name })}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "delete" ? t("deleteConfirm", { count: organization.members ?? 0 }) : t("leaveConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy !== null} onClick={(e) => {
              e.preventDefault();
              void confirmed();
            }}>
              {confirm === "delete" ? t("delete") : t("leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Enter>
  );
}

// ─── Members ─────────────────────────────────────────────────────────────

export function WorkspaceMembers() {
  const t = useTranslations("workspaces.settings");
  const tw = useTranslations("workspaces");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { workspaceId, organization, admin } = useOrganization();
  const members = useCursorPage(api.organizations.queries.members, inWorkspace(workspaceId, {}), PER_PAGE);
  const invitations = useCursorPage(api.organizations.queries.invitations, inWorkspace(workspaceId, {}), PER_PAGE);
  // Members and invitations counted in full: the switcher's count stops at a hundred and one.
  const counts = useProtectedQuery(api.billing.seats.counts, workspaceId ? { workspaceId } : "skip").data;
  const { account, catalog } = useSharedSubscriptionState();
  // What each member spent this month, which keeps a removed member's seat until the renewal (#863).
  const spending = useMemberSpending(workspaceId);
  const { mock, set: setMock, reset: resetMock, now: nowMs } = useOrganizationSeats(workspaceId, organization, counts, account?.renewsAt);
  const team = mock?.team ?? organization?.plan === TEAM_PLAN;
  const [adding, setAdding] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const invite = useWorkspaceAction(api.organizations.manage.invite);
  const setRole = useWorkspaceAction(api.organizations.manage.setRole);
  const removeMember = useWorkspaceAction(api.organizations.manage.removeMember);
  const resend = useWorkspaceAction(api.organizations.manage.resendInvitation);
  const revoke = useWorkspaceAction(api.organizations.manage.revokeInvitation);
  const { busy, attempt } = useAttempt();
  const [email, setEmail] = useState("");
  const [role, setInviteRole] = useState<Role>("member");
  const [removing, setRemoving] = useState<{ userId: Id<"users">; name: string } | null>(null);
  const tc = useTranslations("common");
  // A time Clerk set a moment after the clock last ticked reads as now, not as in a few seconds.
  const ago = (at: number) => format.relativeTime(at, Math.max(now.getTime(), at));
  const { name: planName } = usePlanOf(organization ?? { kind: "organization", name: "" });
  if (!organization || members.isLoading || invitations.isLoading || !counts || !mock) return <Enter ready={false}>{null}</Enter>;

  const roleOptions = [
    { id: "member" as const, label: tw("member"), icon: ROLE_ICONS.member },
    { id: "admin" as const, label: tw("admin"), icon: ROLE_ICONS.admin },
  ];
  // Members removed in the mock are left out, as if Clerk had them gone.
  const removed = new Set(mock.removed);
  const memberCount = counts.members - mock.removed.length;
  const invited = counts.invitations;
  // Team holds the seats bought (#862), which members, invitations and held seats fill (#863); Free has FREE_MEMBERS, invitations included.
  const held = team ? mock.held : 0;
  const used = memberCount + invited + held;
  const seats = team ? mock.seats : FREE_MEMBERS;
  const free = Math.max(0, seats - used);
  const full = used >= seats;
  const date = (ms: number) => format.dateTime(new Date(ms), { month: "short", day: "numeric" });
  const money = (amount: number, cents = false) => format.number(amount, { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0 });
  const seatPrice = (catalog && findPlan(catalog, SEAT_PLAN)?.price?.amount) ?? 0;
  const oneMore = seatChange({ price: seatPrice, from: seats, to: seats + 1, renewsAt: mock.renewsAt, now: nowMs });
  const spentBy = (userId: string) => spending.list.items.find((row) => row.userId === userId)?.spent ?? 0;
  const send = (sent: string) => void attempt("invite", () => invite({ emails: [sent.trim()], role })).then((done) => done && setEmail((now) => (now === sent ? "" : now)));
  const segment = (i: number) => (i < memberCount ? "bg-primary" : i < memberCount + held ? "bg-warning/70" : i < used ? "bg-primary/40" : "bg-muted");

  return (
    <Enter ready>
      <div className="space-y-8">
        <section className="space-y-3 rounded-2xl border border-border-subtle p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold tabular-nums tracking-tight">
                {used} <span className="text-lg font-normal text-muted-foreground">{t("ofSeats", { seats })}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{t("membersOnPlan", { plan: team ? (catalog && findPlan(catalog, TEAM_PLAN)?.name) || planName : planName })}</p>
            </div>
            {admin && team ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/billing">{t("changeSeats")}</Link>
              </Button>
            ) : null}
          </div>
          {/* A segment a seat while they're few enough to count: members, held seats, invitations waiting for an answer, then free ones; past that, one bar. */}
          {seats <= SEAT_SEGMENTS ? (
            <div className="flex gap-1" aria-hidden>
              {Array.from({ length: seats }, (_, i) => (
                <span key={i} className={cn("h-2 flex-1 rounded-full", segment(i))} />
              ))}
            </div>
          ) : (
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="h-full rounded-full bg-primary" style={{ width: `${(memberCount / seats) * 100}%` }} />
              {held > 0 ? <span className="h-full rounded-full bg-warning/70" style={{ width: `${(held / seats) * 100}%` }} /> : null}
              {invited > 0 ? <span className="h-full rounded-full bg-primary/40" style={{ width: `${(invited / seats) * 100}%` }} /> : null}
            </div>
          )}
          {/* What fills the seats, each tinted as its segments are. */}
          <div className="flex flex-wrap gap-1.5 text-xs tabular-nums">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary/12 px-2.5 text-primary">
              <Users className="size-3.5" /> {t("membersCount", { count: memberCount })}
            </span>
            {held > 0 ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning/15 px-2.5 ink-warning">
                <Hourglass className="size-3.5" /> {t("heldUntil", { count: held, date: date(mock.renewsAt) })}
              </span>
            ) : null}
            {invited > 0 ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary/8 px-2.5 text-primary/80">
                <Mail className="size-3.5" /> {t("invitedCount", { count: invited })}
              </span>
            ) : null}
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-muted-foreground">{t("freeCount", { count: free })}</span>
          </div>
        </section>

        {admin ? (
          <Zone label={t("invite")}>
            {/* One child of the zone, so its spacing doesn't jump when a step opens or closes under the form: each step's gap is inside it. */}
            <div>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                // Enter submits whatever the button looks like: a full free organization, or an invitation still going, sends nothing.
                if ((full && !team) || busy === "invite" || !EMAIL.test(email.trim())) return;
                // Team with no free seat asks to add one first (#863).
                if (full) {
                  setDeclined(false);
                  return setAdding(email.trim());
                }
                // The address that went is cleared; one typed since stays.
                send(email);
              }}
            >
              <label className="flex h-10 min-w-56 flex-1 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailAddress")} aria-label={tw("emailToInvite")} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
              </label>
              <Segmented label={t("theirRole")} value={role} onChange={setInviteRole} options={roleOptions} size="md" />
              <Button type="submit" className="h-10 rounded-xl" disabled={!EMAIL.test(email.trim()) || busy === "invite" || (full && !team) || adding !== null}>
                {t("invite")}
              </Button>
            </form>
            <AnimatePresence initial={false}>
              {full && !team ? (
                // A free organization at its limit is offered Team where it invites (#863).
                <Opening key="team">
                  <div className="pt-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-inset py-2.5 pl-4 pr-2.5 text-sm">
                    <span className="text-muted-foreground">{t("freeUpTo", { count: FREE_MEMBERS })}</span>
                    <Button asChild size="sm">
                      <Link href="/pricing">
                        {t("moveTo", { plan: (catalog && findPlan(catalog, TEAM_PLAN)?.name) || "Team" })} <ArrowRight />
                      </Link>
                    </Button>
                  </div>
                  </div>
                </Opening>
              ) : null}
              {adding ? (
                // Team with no free seat: one more, at Autumn's price, then the invitation (#863).
                <Opening key="seat">
                  <div className="pt-2.5">
                  <div className="space-y-3 rounded-2xl border border-border-subtle p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-sm font-medium">{t("noFreeSeat")}</p>
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2.5">
                            <Mail className="size-3.5 shrink-0" /> <span className="truncate">{adding}</span>
                          </span>
                          {account?.card ? (
                            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 capitalize">
                              <CreditCard className="size-3.5" /> {account.card.brand} {account.card.last4}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-semibold tabular-nums tracking-tight">{money(oneMore.amount, true)}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">{t("thenAMonthFrom", { amount: money(oneMore.monthly), date: date(mock.renewsAt) })}</p>
                      </div>
                    </div>
                    {declined ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 py-2 pl-3 pr-2 text-sm text-destructive">
                        <span className="flex items-center gap-2">
                          <AlertCircle className="size-4 shrink-0" /> {t("seatDeclined")}
                        </span>
                        <Button asChild variant="outline" size="sm">
                          <Link href="/settings/billing">{t("fixPayment")}</Link>
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>
                        {tc("cancel")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy === "invite"}
                        onClick={() => {
                          // The mock's card: declined, nothing is charged and no invitation goes out.
                          if (mock.failed) return setDeclined(true);
                          setMock({ seats: seats + 1 });
                          send(adding);
                          setAdding(null);
                        }}
                      >
                        {t("addSeatAndInvite")}
                      </Button>
                    </div>
                  </div>
                  </div>
                </Opening>
              ) : null}
            </AnimatePresence>
            </div>
          </Zone>
        ) : null}

        <Zone label={tw("membersHeading")} aside={<span className="pr-1 text-xs tabular-nums text-muted-foreground">{memberCount}</span>}>
          <Paged pager={{ list: members, size: PER_PAGE, total: memberCount }} rowHeight={ROW_HEIGHT} label={t("membersLabel")}>
            <ul key={members.page} className={LIST}>
              {members.items.filter((member) => !removed.has(member.userId)).map((member) => (
                <li key={member.userId}>
                  <IdentityRow className="p-3" avatar={<IdentityAvatar name={member.name} imageUrl={member.imageUrl} className="size-9" />} name={member.name} you={member.you} detail={member.email}>
                    <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground @min-[40rem]/configuration:inline">{t("joined", { when: ago(member.joinedAt) })}</span>
                    {admin && !member.you ? (
                      <>
                        <Segmented
                          label={t("roleOf", { name: member.name })}
                          value={member.role}
                          onChange={(next) => void attempt(`role:${member.userId}`, () => setRole({ userId: member.userId, role: next }))}
                          options={roleOptions}
                        />
                        <IconButton small label={t("removeName", { name: member.name })} icon={<X className="size-3.5" />} onClick={() => setRemoving({ userId: member.userId, name: member.name })} />
                      </>
                    ) : (
                      <RoleLabel role={member.role} className="w-[9.5rem] justify-end pr-2">
                        {member.role === "admin" ? tw("admin") : tw("member")}
                      </RoleLabel>
                    )}
                  </IdentityRow>
                </li>
              ))}
            </ul>
          </Paged>
        </Zone>

        {invitations.items.length ? (
          <Zone label={t("invitations")}>
            <Paged pager={{ list: invitations, size: PER_PAGE }} rowHeight={ROW_HEIGHT} label={t("invitationsLabel")}>
            <ul key={invitations.page} className={LIST}>
              {invitations.items.map((invitation) => (
                <li key={invitation.invitationId}>
                  <IdentityRow className="p-3" avatar={<EmailAvatar />} name={invitation.email} detail={t("invited", { when: ago(invitation.sentAt) })}>
                    <RoleLabel role={invitation.role} className="pr-1">
                      {invitation.role === "admin" ? tw("admin") : tw("member")}
                    </RoleLabel>
                    {admin ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          disabled={busy === `resend:${invitation.invitationId}`}
                          onClick={() =>
                            void attempt(`resend:${invitation.invitationId}`, () => resend({ invitationId: invitation.invitationId })).then(
                              (done) => done && toast.success(t("sentAgain", { email: invitation.email })),
                            )
                          }
                        >
                          <Repeat /> {t("resend")}
                        </Button>
                        <IconButton small label={t("cancelInvitation", { email: invitation.email })} icon={<X className="size-3.5" />} onClick={() => void attempt(`revoke:${invitation.invitationId}`, () => revoke({ invitationId: invitation.invitationId }))} />
                      </>
                    ) : null}
                  </IdentityRow>
                </li>
              ))}
            </ul>
            </Paged>
          </Zone>
        ) : null}
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeName", { name: removing?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeConfirm", { name: removing?.name ?? "", organization: organization.name })}{" "}
              {!team || !removing ? null : spentBy(removing.userId) > 0 ? t("seatHeld", { name: removing.name, credits: spentBy(removing.userId), date: date(mock.renewsAt) }) : t("seatFreed")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                // The mock leaves the member in place and only hides them; a seat they spent from is held to the renewal.
                if (removing) setMock({ removed: [...mock.removed, removing.userId], held: mock.held + (team && spentBy(removing.userId) > 0 ? 1 : 0) });
                setRemoving(null);
              }}
            >
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SeatsMockPanel mock={mock} set={setMock} reset={resetMock} />
    </Enter>
  );
}

// ─── Plan and credits ────────────────────────────────────────────────────

export function WorkspaceBilling() {
  const t = useTranslations("workspaces.settings");
  const format = useFormatter();
  const { workspaceId, organization, admin } = useOrganization();
  const { account, catalog } = useSharedSubscriptionState();
  const spending = useMemberSpending(workspaceId);
  // The seats it pays for, counted in full.
  const counts = useProtectedQuery(api.billing.seats.counts, workspaceId ? { workspaceId } : "skip").data;
  const openPortal = useWorkspaceAction(api.billing.actions.openPortal);
  const { busy, attempt } = useAttempt();
  const { mock, set: setMock, reset: resetMock, now: nowMs } = useOrganizationSeats(workspaceId, organization, counts, account?.renewsAt);
  const [picked, setPicked] = useState<number>();
  const [reviewing, setReviewing] = useState(false);
  if (!organization || !account || !catalog || !spending.ready || counts === undefined || !mock) return <Enter ready={false}>{null}</Enter>;

  const realPlan = account.plan ?? organization.plan ?? "";
  // The mock's move to Team, or back, stands in for the real plan.
  const planId = mock.team ? TEAM_PLAN : realPlan === TEAM_PLAN ? ORGANIZATION_PLAN : realPlan;
  const plan = findPlan(catalog, planId);
  const fromPlan = Math.max(0, account.balance - account.purchased);
  const memberCount = organization.members ?? 0;
  const team = planId === TEAM_PLAN;
  const teamPlan = findPlan(catalog, TEAM_PLAN);
  const seat = findPlan(catalog, SEAT_PLAN);
  const seatPrice = seat?.price?.amount;
  // Team's credits are its seats' (#862): the seats bought, which members, invitations and held seats fill.
  const seats = mock.seats;
  const inUse = (counts?.members ?? 0) - mock.removed.length + (counts?.invitations ?? 0) + mock.held;
  const next = Math.max(inUse, picked ?? seats);
  const change = seatChange({ price: seatPrice ?? 0, from: seats, to: next, renewsAt: mock.renewsAt, now: nowMs });
  const added = next - seats;
  const short = (ms: number) => format.dateTime(new Date(ms), { year: "numeric", month: "short", day: "numeric" });
  const cents = (amount: number) => format.number(amount, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  // When an unpaid Team ends: the mock's stand-in for Stripe's last retry.
  const endsAt = nowMs + 21 * 86_400_000;
  const monthly = team ? seats * (seat?.credits?.included ?? 0) : plan?.credits?.interval === "month" ? plan.credits.included : 0;
  const cap = team ? monthly : planCreditCap(catalog, planId);
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "USD", minimumFractionDigits: 0 });
  const limits = plan?.limits;
  const date = (ms: number) => format.dateTime(new Date(ms), { month: "long", day: "numeric" });
  // A limit the plan doesn't set isn't named; null is unlimited.
  const included = [
    // Team's members are its seats, which the card above counts.
    ...(team ? [] : [{ icon: Users, label: t("includedMembers", { count: FREE_MEMBERS }) }]),
    ...(limits?.collections === undefined ? [] : [{ icon: Folder, label: limits.collections === null ? t("unlimitedCollections") : t("includedCollections", { count: limits.collections }) }]),
    ...(limits?.concurrency == null ? [] : [{ icon: ListFilter, label: t("papersAtOnce", { count: limits.concurrency }) }]),
    ...(limits?.request_papers === undefined ? [] : [{ icon: FileSearch, label: limits.request_papers === null ? t("anyPapersAJob") : t("papersAJob", { count: limits.request_papers }) }]),
  ];

  return (
    <Enter ready>
      <div className="space-y-8">
        {mock.failed || account.pastDue ? (
          // A failed payment, the day the plan ends if it isn't fixed, and where to fix it (#40), as a person's billing page has it.
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 py-2 pl-3 pr-2 text-sm text-destructive">
            <span className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              {t("paymentFailedEnds", { plan: plan?.name ?? "", date: date(endsAt) })}
            </span>
            {admin ? (
              <Button variant="outline" size="sm" disabled={busy === "portal"} onClick={() => void attempt("portal", async () => window.location.assign(await openPortal({})))}>
                {t("fixPayment")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <section className="grid overflow-hidden rounded-2xl border border-border-subtle @min-[46rem]/configuration:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-5 p-5">
            <div>
              <p className="text-4xl font-semibold tabular-nums tracking-tight">{format.number(account.balance)}</p>
              <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                <Coins className="size-4" /> {t("sharedCredits")}
                <TooltipHint label={t("membersDraw", { count: memberCount })}>
                  <span>
                    <MemberFaces workspaceId={workspaceId} label={t("membersDraw", { count: memberCount })} count={memberCount} />
                  </span>
                </TooltipHint>
              </div>
            </div>
            {cap > 0 ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium">{plan?.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {format.number(fromPlan)} / {format.number(cap)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (fromPlan / cap) * 100)}%` }} />
                </div>
                {monthly > 0 && account.renewsAt !== undefined ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Repeat className="size-3.5" /> {t("refillOn", { amount: format.number(monthly), date: date(account.renewsAt) })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col justify-between gap-4 border-t border-border-subtle bg-inset p-5 @min-[46rem]/configuration:border-l @min-[46rem]/configuration:border-t-0">
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                {plan?.name}
                {team && seatPrice !== undefined ? <span className="text-sm font-normal text-muted-foreground">{t("aSeat", { price: money(seatPrice) })}</span> : null}
              </p>
              {team ? (
                // The seats bought (#862): an admin changes how many, down to those in use.
                <div className="space-y-2 pt-1">
                  {admin && !mock.toFree ? (
                    <SeatStepper seats={next} fewest={inUse} why={t("seatsInUse", { count: inUse })} onChange={setPicked} />
                  ) : (
                    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 text-xs tabular-nums text-muted-foreground">
                      <Users className="size-3.5" />
                      {t("seats", { count: seats })}
                    </span>
                  )}
                  {seatPrice !== undefined ? (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      $<AnimatedNumber value={seatPrice * next} /> {t("aMonthShort")}
                    </p>
                  ) : null}
                  {mock.toFree ? (
                    <span className="inline-flex items-center gap-1.5 text-xs ink-info">
                      <CalendarClock className="size-3.5" /> {t("changesOn", { plan: findPlan(catalog, ORGANIZATION_PLAN)?.name ?? "", date: date(mock.renewsAt) })}
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm tabular-nums text-muted-foreground">{t("upToMembers", { count: FREE_MEMBERS })}</p>
              )}
            </div>
            {admin ? (
              team ? (
                // The gap under each button is inside it, so it opens and closes with the button.
                <div className="flex flex-col">
                  <AnimatePresence initial={false}>
                    {added !== 0 ? (
                      <Opening key="review">
                        <div className="pb-2">
                          <Button size="sm" className="w-full" onClick={() => setReviewing(true)}>
                            {added > 0 ? t("addSeats", { count: added }) : t("removeSeats", { count: -added })}
                          </Button>
                        </div>
                      </Opening>
                    ) : null}
                  </AnimatePresence>
                  {mock.toFree ? (
                    <div className="pb-2">
                      <Button size="sm" className="w-full" onClick={() => setMock({ toFree: false })}>
                        {t("keepPlan", { plan: plan?.name ?? "" })}
                      </Button>
                    </div>
                  ) : null}
                  <Button variant="outline" size="sm" disabled={busy === "portal"} onClick={() => void attempt("portal", async () => window.location.assign(await openPortal({})))}>
                    {t("manageBilling")}
                  </Button>
                </div>
              ) : (
                <Button asChild size="sm">
                  <Link href="/pricing">
                    {t("moveTo", { plan: teamPlan?.name ?? "" })} <ArrowRight />
                  </Link>
                </Button>
              )
            ) : null}
          </div>
        </section>

        <MemberSpending spending={spending} admin={admin} team={team} members={memberCount} />

        <UpgradeConfirmationDialog
          open={reviewing && added !== 0}
          onOpenChange={setReviewing}
          title={added > 0 ? t("addSeats", { count: added }) : t("removeSeats", { count: -added })}
          description={t("thenAMonthFrom", { amount: money(change.monthly), date: date(mock.renewsAt) })}
          confirmLabel={added > 0 ? t("addSeats", { count: added }) : t("removeSeats", { count: -added })}
          totalLabel={added > 0 ? t("dueNow") : t("offNextBill")}
          labels={{ from: t("seatsNow"), to: t("seatsAfter") }}
          isConfirming={false}
          onConfirm={() => {
            // The mock's card declines an added seat: nothing changes, and the admin is told why.
            if (added > 0 && mock.failed) return showStyledToast("error", t("seatsDeclined"));
            setMock({ seats: next });
            setPicked(undefined);
            setReviewing(false);
          }}
          preview={{
            currency: "usd",
            immediateChargeCents: Math.round(Math.abs(change.amount) * 100),
            currentPlan: t("seats", { count: seats }),
            targetPlan: t("seats", { count: next }),
            targetPlanCreditsPerMonth: 0,
            remainingDays: 0,
            lineItems: [
              {
                description: added > 0 ? t("seatLine", { count: added, from: short(nowMs), to: short(mock.renewsAt) }) : t("unusedSeatLine", { count: -added, from: short(nowMs), to: short(mock.renewsAt) }),
                amountCents: Math.round(change.amount * 100),
                currency: "usd",
              },
            ],
          }}
          cardBrand={account.card?.brand}
          cardLast4={account.card?.last4}
        />

        <Zone label={t("included")}>
          <div className="flex flex-wrap gap-1.5">
            {included.map((f) => (
              <span key={f.label} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-subtle px-3 text-xs">
                <Check className="size-3.5 text-success" />
                <f.icon className="size-3.5 text-muted-foreground" />
                {f.label}
              </span>
            ))}
          </div>
        </Zone>
      </div>
      <SeatsMockPanel mock={mock} set={setMock} reset={resetMock} />
    </Enter>
  );
}
