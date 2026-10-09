"use client";

// An organization's settings (#651): the organization itself, its members and invitations, and
// its plan and credits. Your own workspace is just you, so its plan sits with your account.

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Camera, Check, ChevronRight, Coins, Copy, EvidenceLibrariesIcon, FileSearch, Folder, ListFilter, LogOut, Mail, Pencil, Repeat, Search, Trash2, Users, X } from "@/components/icons";
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
import { EmailAvatar, IdentityRow, ROLE_ICONS, RoleLabel } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { showStyledToast } from "@/components/ui/sonner";
import { TooltipHint } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { findPlan, planCreditCap } from "@/lib/billing/catalog";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { ORGANIZATION_COLOURS } from "@/lib/workspaces/colours";
import { inWorkspace, useWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { FREE_MEMBERS, PlanChip, usePlanOf, useWorkspaces, WorkspaceTile, workspaceTint } from "./parts";

/** Rows a page of members holds. */
const PER_PAGE = 10;
/** A row with a photo, and its divider. */
const ROW_HEIGHT = 61;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Role = "admin" | "member";

/** The organization the page is in, once the switcher's list has it. */
function useOrganization() {
  const workspaceId = useWorkspace();
  const { current } = useWorkspaces();
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

/** The first members' faces, which open the member list. */
function MemberFaces({ workspaceId, label }: { workspaceId: Id<"workspaces"> | undefined; label: string }) {
  const { data } = useProtectedQuery(api.organizations.queries.members, inWorkspace(workspaceId, { paginationOpts: { cursor: null, numItems: 4 } }));
  return (
    <span className="flex -space-x-1.5" aria-label={label}>
      {(data?.page ?? []).map((member) => (
        <span key={member.userId} className="flex rounded-full ring-2 ring-card">
          <IdentityAvatar name={member.name} imageUrl={member.imageUrl} className="size-5" />
        </span>
      ))}
    </span>
  );
}

// ─── General ─────────────────────────────────────────────────────────────

export function WorkspaceGeneral() {
  const t = useTranslations("workspaces.settings");
  const tw = useTranslations("workspaces");
  const tc = useTranslations("common");
  const router = useRouter();
  const { workspaceId, organization, admin } = useOrganization();
  const { data: summary } = useProtectedQuery(api.organizations.queries.summary, inWorkspace(workspaceId, {}));
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
  if (!organization || !summary) return <Enter ready={false}>{null}</Enter>;

  const { name, slug } = organization;
  const address = `${window.location.host}/o/${slug}`;
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
                <input type="file" accept="image/*" className="sr-only" aria-label={t("changeLogo")} disabled={busy === "logo"} onChange={(e) => pickLogo(e.target.files?.[0])} />
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
                <MemberFaces workspaceId={workspaceId} label={tw("members", { count: organization.members ?? 0 })} />
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
                    onClick={() => void attempt("colour", () => setColour({ colour: swatch }))}
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
                    {summary.library ? t("libraryIsLive", { library: summary.library }) : t("deleteDetail", { count: organization.members ?? 0 })}
                  </p>
                </div>
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

/** A control that is off for a reason: the reason shows on hover. */
function Guarded({ reason, children }: { reason: string | null; children: ReactElement }) {
  if (!reason) return children;
  return (
    <TooltipHint label={reason}>
      <span tabIndex={0} className="rounded-md">
        <span className="pointer-events-none opacity-50">{children}</span>
      </span>
    </TooltipHint>
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
  // ponytail: one page; a free organization has at most FREE_MEMBERS, invitations included. Team (#652) counts them.
  const { data: invitations } = useProtectedQuery(api.organizations.queries.invitations, inWorkspace(workspaceId, { paginationOpts: { cursor: null, numItems: FREE_MEMBERS } }));
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
  if (!organization || members.isLoading || !invitations) return <Enter ready={false}>{null}</Enter>;

  const roleOptions = [
    { id: "member" as const, label: tw("member"), icon: ROLE_ICONS.member },
    { id: "admin" as const, label: tw("admin"), icon: ROLE_ICONS.admin },
  ];
  const memberCount = organization.members ?? 0;
  const seats = FREE_MEMBERS;
  const used = memberCount + invitations.page.length;
  const full = used >= seats;

  return (
    <Enter ready>
      <div className="space-y-8">
        <section className="space-y-3 rounded-2xl border border-border-subtle p-5">
          <div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {used} <span className="text-lg font-normal text-muted-foreground">{t("ofSeats", { seats })}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("membersOnPlan", { plan: planName })}</p>
          </div>
          {/* A segment a seat: members, then invitations waiting for an answer. */}
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: seats }, (_, i) => (
              <span key={i} className={cn("h-2 flex-1 rounded-full", i < memberCount ? "bg-primary" : i < used ? "bg-primary/40" : "bg-muted")} />
            ))}
          </div>
        </section>

        {admin ? (
          <Zone label={t("invite")}>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void attempt("invite", () => invite({ emails: [email.trim()], role })).then((done) => done && setEmail(""));
              }}
            >
              <label className="flex h-10 min-w-56 flex-1 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailAddress")} aria-label={tw("emailToInvite")} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
              </label>
              <Segmented label={t("theirRole")} value={role} onChange={setInviteRole} options={roleOptions} size="md" />
              <Guarded reason={full ? t("freeUpTo", { count: FREE_MEMBERS }) : null}>
                <Button type="submit" className="h-10 rounded-xl" disabled={!EMAIL.test(email.trim()) || busy === "invite"}>
                  {t("invite")}
                </Button>
              </Guarded>
            </form>
          </Zone>
        ) : null}

        <Zone label={tw("membersHeading")} aside={<span className="pr-1 text-xs tabular-nums text-muted-foreground">{memberCount}</span>}>
          <Paged pager={{ list: members, size: PER_PAGE, total: memberCount }} rowHeight={ROW_HEIGHT} label={t("membersLabel")}>
            <ul key={members.page} className={LIST}>
              {members.items.map((member) => (
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

        {invitations.page.length ? (
          <Zone label={t("invitations")}>
            <ul className={LIST}>
              {invitations.page.map((invitation) => (
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
          </Zone>
        ) : null}
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeName", { name: removing?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("removeConfirm", { name: removing?.name ?? "", organization: organization.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                if (removing) void attempt("remove", () => removeMember({ userId: removing.userId })).then(() => setRemoving(null));
              }}
            >
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Enter>
  );
}

// ─── Plan and credits ────────────────────────────────────────────────────

export function WorkspaceBilling() {
  const t = useTranslations("workspaces.settings");
  const format = useFormatter();
  const { workspaceId, organization } = useOrganization();
  const { account, catalog } = useSharedSubscriptionState();
  if (!organization || !account || !catalog) return <Enter ready={false}>{null}</Enter>;

  const planId = account.plan ?? organization.plan ?? "";
  const plan = findPlan(catalog, planId);
  const cap = planCreditCap(catalog, planId);
  const monthly = plan?.credits?.interval === "month" ? plan.credits.included : 0;
  const fromPlan = Math.max(0, account.balance - account.purchased);
  const memberCount = organization.members ?? 0;
  const limits = plan?.limits;
  const date = (ms: number) => format.dateTime(new Date(ms), { month: "long", day: "numeric" });
  // A limit the plan doesn't set isn't named; null is unlimited.
  const included = [
    { icon: Users, label: t("includedMembers", { count: FREE_MEMBERS }) },
    ...(limits?.collections === undefined ? [] : [{ icon: Folder, label: limits.collections === null ? t("unlimitedCollections") : t("includedCollections", { count: limits.collections }) }]),
    ...(limits?.concurrency == null ? [] : [{ icon: ListFilter, label: t("papersAtOnce", { count: limits.concurrency }) }]),
    ...(limits?.request_papers === undefined ? [] : [{ icon: FileSearch, label: limits.request_papers === null ? t("anyPapersAJob") : t("papersAJob", { count: limits.request_papers }) }]),
  ];

  return (
    <Enter ready>
      <div className="space-y-8">
        <section className="grid overflow-hidden rounded-2xl border border-border-subtle @min-[46rem]/configuration:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-5 p-5">
            <div>
              <p className="text-4xl font-semibold tabular-nums tracking-tight">{format.number(account.balance)}</p>
              <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                <Coins className="size-4" /> {t("sharedCredits")}
                <TooltipHint label={t("membersDraw", { count: memberCount })}>
                  <span>
                    <MemberFaces workspaceId={workspaceId} label={t("membersDraw", { count: memberCount })} />
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
              <p className="text-xl font-semibold tracking-tight">{plan?.name}</p>
              <p className="text-sm tabular-nums text-muted-foreground">{t("upToMembers", { count: FREE_MEMBERS })}</p>
            </div>
          </div>
        </section>

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
    </Enter>
  );
}
