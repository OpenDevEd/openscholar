"use client";

// The workspace card the rail's top button opens (#651): the workspace you're in at its head (its
// tile flies in from the rail), the others to switch to, invitations to answer, and making an
// organization. Everything on the site follows the workspace picked here: what you make goes into
// it, and what you run uses its credits and plan.

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Home, Loader2, Plus, Settings, Users, X } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { RoleLabel } from "@/components/ui/identity";
import { Input } from "@/components/ui/input";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { showStyledToast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { workspaceHref } from "@/lib/workspaces/href";
import { bareWorkspacePath } from "@/lib/workspaces/paths";
import { inWorkspace, useWorkspaceAction } from "@/lib/workspaces/url";
import { pageItem } from "./item-home";
import { Framed, PlanChip, settingsHref, usePlanOf, useWorkspaces, useCurrentWorkspace, WorkspaceTile, type WorkspaceLook, type WorkspaceRow } from "./parts";
import { FREE_MEMBERS } from "@/lib/billing/plans";

const ROW = "flex w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-foreground/[0.045]";

/** The square at the head of a rail card that the workspace tile flies into from the rail. */
const HEAD = 40;


/**
 * Where a switch to another workspace lands: the same page there, or where its section starts
 * when the page shows an item, which is in one workspace only (Slack and Linear do the same).
 */
function switchTarget(slug: string | undefined, pathname: string, search: string) {
  const path = bareWorkspacePath(pathname);
  // An organization's own settings have no page in your own workspace: its settings start there.
  if (!slug && (path === "/settings/workspace" || path.startsWith("/settings/workspace/"))) return "/settings";
  const params = new URLSearchParams(search);
  const item = pageItem(path, params);
  if (!item) return workspaceHref(slug, path) + (search ? `?${params.toString()}` : "");
  const section = { search: "/", screening: "/screening", extraction: "/extraction", collection: "/library", library: "/evidence-libraries", profile: "/authors" }[item.kind];
  return workspaceHref(slug, section);
}

/** What you are in a workspace, as an icon and a word, so it reads apart from the plan beside it. */
function RoleOf({ workspace }: { workspace: WorkspaceRow }) {
  const t = useTranslations("workspaces");
  if (workspace.kind === "personal") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Home className="size-3.5" />
        {t("personal")}
      </span>
    );
  }
  return (
    <RoleLabel role={workspace.role === "admin" ? "admin" : "member"} className="text-inherit">
      {workspace.role === "admin" ? t("admin") : t("member")}
    </RoleLabel>
  );
}

/**
 * Answers an invitation: joining is Clerk's own, whose client turns the invitation into a
 * membership, which is kept at once; declining takes it back. `answering` is the one being answered.
 */
/** Pages of someone's pending invitations Clerk is read for one to accept: 250, past which it reads as gone. */
const INVITATION_PAGES = 5;
const INVITATION_PAGE = 50;

/** Clerk's own copy of someone's pending invitation, which accepts it, read a page at a time until it turns up. */
async function pendingInClerk(user: NonNullable<ReturnType<typeof useUser>["user"]>, invitationId: string) {
  for (let page = 1; page <= INVITATION_PAGES; page++) {
    const { data, total_count } = await user.getOrganizationInvitations({ status: "pending", initialPage: page, pageSize: INVITATION_PAGE });
    const found = data.find((one) => one.id === invitationId);
    if (found || page * INVITATION_PAGE >= total_count) return found;
  }
}

export function useAnswerInvitation() {
  const t = useTranslations("workspaces");
  const { user } = useUser();
  const decline = useWorkspaceAction(api.organizations.manage.declineInvitation);
  const confirmJoin = useAction(api.organizations.manage.confirmJoin);
  const [answering, setAnswering] = useState<string | null>(null);
  return {
    answering,
    /** Joins, and says whether it did. */
    join: async (invitation: { clerkInvitationId: string; organization: { slug: string } }) => {
      setAnswering(invitation.clerkInvitationId);
      try {
        const clerkInvitation = user ? await pendingInClerk(user, invitation.clerkInvitationId) : undefined;
        if (!clerkInvitation) throw new Error(t("invitationGone"));
        await clerkInvitation.accept();
        await confirmJoin({ slug: invitation.organization.slug });
        return true;
      } catch (error) {
        showStyledToast("error", getErrorMessage(error, t("couldntJoin")));
        return false;
      } finally {
        setAnswering(null);
      }
    },
    /** Declines, and says whether it did. */
    decline: async (invitation: { invitationId: Id<"organizationInvitations">; clerkInvitationId: string }) => {
      setAnswering(invitation.clerkInvitationId);
      try {
        await decline({ invitationId: invitation.invitationId });
        return true;
      } catch (error) {
        showStyledToast("error", getErrorMessage(error, t("couldntDecline")));
        return false;
      } finally {
        setAnswering(null);
      }
    },
  };
}

/**
 * The workspace card: the one you're in, the others, invitations, and making one. `all` is read by
 * the rail, which is always there, so the list is in the card as it opens. `onPick` hears the
 * workspace picked as the card closes, so the rail shows it while its pages load.
 */
export function WorkspaceMenu({ all, onDone, onPick, onCreate }: { all: ReturnType<typeof useWorkspaces>; onDone: () => void; onPick: (workspace: WorkspaceRow) => void; onCreate: () => void }) {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const router = useRouter();
  const current = useCurrentWorkspace();
  const { data: invitations } = useProtectedQuery(api.organizations.queries.myInvitations, inWorkspace(current?.workspaceId, { paginationOpts: { cursor: null, numItems: 10 } }));
  const { answering, join, decline } = useAnswerInvitation();
  const others = (all.list ?? []).filter((workspace) => workspace.workspaceId !== current?.workspaceId);
  const go = (slug: string | undefined) => {
    onDone();
    router.push(switchTarget(slug, window.location.pathname, window.location.search.slice(1)));
  };
  return (
    <div>
      <div className="flex items-center gap-3 px-2.5 pb-3 pt-2.5">
        <span aria-hidden className="shrink-0 rounded-xl" style={{ width: HEAD, height: HEAD }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight tracking-tight">{current?.name}</span>
          <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {current ? <PlanChip workspace={current} /> : null}
            {current?.kind === "organization" ? <span className="tabular-nums">{t("members", { count: current.members ?? 0 })}</span> : null}
            {current ? <RoleOf workspace={current} /> : null}
          </span>
        </span>
      </div>

      {others.length ? (
        <>
          <p className="flex h-6 items-center border-t border-border/60 px-2.5 pt-2 text-[11px] font-medium text-muted-foreground">{t("switchTo")}</p>
          <ul role="listbox" aria-label={t("otherWorkspaces")} className="space-y-px pt-1">
            {others.map((workspace) => (
              <li key={workspace.workspaceId} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(workspace);
                    go(workspace.slug);
                  }}
                  className={cn(ROW, "h-11")}
                >
                  <Framed>
                    <WorkspaceTile workspace={workspace} size="md" home />
                  </Framed>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold leading-tight">{workspace.name}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-medium">
                        <PlanName workspace={workspace} />
                      </span>
                      <RoleOf workspace={workspace} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {all.more ? (
              <li>
                <button type="button" disabled={all.loading} onClick={all.loadMore} className={cn(ROW, "h-9 justify-center text-xs font-medium text-muted-foreground disabled:opacity-60")}>
                  {tc("showMore")}
                </button>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}

      <AnimatePresence initial={false}>
        {(invitations?.page ?? []).map((invitation) => (
          <motion.div
            key={invitation.invitationId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-2 border-t border-border/60 px-2 pb-1 pt-2.5">
              <div className="flex items-center gap-2.5">
                {/* The organization's logo and whoever invited you, as its page shows them. */}
                <WorkspaceTile workspace={{ kind: "organization", name: invitation.organization.name, imageUrl: invitation.organization.imageUrl }} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight">{invitation.organization.name}</span>
                  {invitation.invitedBy ? (
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                      {t("from")} <IdentityAvatar name={invitation.invitedBy.name} imageUrl={invitation.invitedBy.imageUrl} className="size-4" />{" "}
                      <span className="min-w-0 truncate">{invitation.invitedBy.name}</span>
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={answering !== null}
                  onClick={() => void decline(invitation)}
                >
                  {t("decline")}
                </Button>
                <Button size="sm" className="h-7 text-xs" disabled={answering !== null} onClick={() => void join(invitation).then((joined) => joined && go(invitation.organization.slug))}>
                  {answering === invitation.clerkInvitationId ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {t("join")}
                </Button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="mt-1 space-y-px border-t border-border/60 pt-1">
        <button type="button" onClick={onCreate} className={cn(ROW, "h-8 text-[13px]")}>
          <Plus className="size-4 text-muted-foreground" />
          {t("newOrganization")}
        </button>
        <button
          type="button"
          onClick={() => {
            onDone();
            router.push(settingsHref(current));
          }}
          className={cn(ROW, "h-8 text-[13px]")}
        >
          <Settings className="size-4 text-muted-foreground" />
          {t("workspaceSettings")}
        </button>
      </div>
    </div>
  );
}

/** A workspace's plan by name, where the list says each one's. */
function PlanName({ workspace }: { workspace: WorkspaceLook }) {
  return <>{usePlanOf(workspace).name}</>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CreateOrganization({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        {/* Inside the content, so it starts blank each time and reads nothing while it's shut. */}
        <NewOrganization close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewOrganization({ close }: { close: () => void }) {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const router = useRouter();
  const create = useWorkspaceAction(api.organizations.manage.create);
  // The invitations go out from the organization just made, not the workspace the page is in.
  const inviteThere = useAction(api.organizations.manage.invite);
  const { name: freePlan } = usePlanOf({ kind: "organization", name: "" });
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const seats = 1 + emails.length;
  const full = seats >= FREE_MEMBERS;
  const add = () => {
    const email = draft.trim().replace(/,$/, "");
    if (!EMAIL.test(email) || emails.includes(email) || full) return;
    setEmails([...emails, email]);
    setDraft("");
  };
  const done = async () => {
    setBusy(true);
    let made: { workspaceId: Id<"workspaces">; slug: string };
    try {
      made = await create({ name: name.trim() });
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, t("couldntCreate")));
      setBusy(false);
      return;
    }
    // It's made: trying again would make another. Invitations that fail are sent again from its Members settings.
    if (emails.length) await inviteThere({ workspaceId: made.workspaceId, emails, role: "member" }).catch((error) => showStyledToast("error", getErrorMessage(error, t("couldntInvite"))));
    close();
    router.push(workspaceHref(made.slug, "/library"));
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("newOrganization")}</DialogTitle>
        <DialogDescription>{t("newOrganizationShares")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("name")}</span>
          <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
        </label>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("inviteMembers")}</span>
          <label className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
            {emails.map((email) => (
              <span key={email} className="flex h-7 items-center gap-1 rounded-full bg-muted pl-2.5 pr-1 text-xs">
                {email}
                <button type="button" aria-label={t("removeEmail", { email })} onClick={() => setEmails(emails.filter((e) => e !== email))} className="flex size-5 items-center justify-center rounded-full hover:bg-background">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              value={draft}
              disabled={full}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === " ") {
                  e.preventDefault();
                  add();
                }
              }}
              onBlur={add}
              placeholder={full ? "" : emails.length ? t("addAnother") : t("emailPlaceholder")}
              aria-label={t("emailToInvite")}
              className="min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
          </label>
        </div>
        <div className="space-y-2 rounded-xl bg-inset p-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <Users className="size-3.5" /> {t("membersHeading")}
            </span>
            <span className="tabular-nums text-muted-foreground">{t("seatsOf", { seats, limit: FREE_MEMBERS, plan: freePlan })}</span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: FREE_MEMBERS }, (_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < seats ? "bg-primary" : "bg-muted")} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={close} disabled={busy}>
          {tc("cancel")}
        </Button>
        <Button disabled={!name.trim() || busy} onClick={() => void done()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("createOrganization")}
        </Button>
      </div>
    </>
  );
}
