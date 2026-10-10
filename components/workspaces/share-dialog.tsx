"use client";

// Sharing one of a workspace's items with people outside it (#653), through the app's one share
// panel (components/shared/share-panel.tsx). The workspace's members have the item already, so
// only guests are added here: someone in one of your organizations at once, anyone else by an
// emailed invitation.

import { useDeferredValue, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { IconButton } from "@/components/assistant/parts";
import { Share2, X } from "@/components/icons";
import { SharePanel } from "@/components/shared/share-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, focusContent } from "@/components/ui/dialog";
import { EmailAvatar } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { showStyledToast } from "@/components/ui/sonner";
import Link from "@/components/workspace-link";
import { api } from "@/convex/_generated/api";
import type { GuestRole, SharedKind } from "@/convex/sharing/validators";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { bareWorkspacePath } from "@/lib/workspaces/paths";
import { inWorkspace, useWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { PlanChip, useCurrentWorkspace, usePlanOf, WorkspaceTile } from "./parts";
import { SHARED_KINDS } from "./shared";

type Item = { kind: SharedKind; id: string; name: string };

/** Guests and invitations the dialog reads at a time. */
const PAGE = 25;
const WEEK = 7 * 86_400_000;

/**
 * An item's guests, its waiting invitations and how many its plan allows. The button reads
 * them while the item has any, so its dialog opens with them in place.
 */
function useGuests({ kind, id }: Pick<Item, "kind" | "id">, wanted: boolean) {
  const workspaceId = useWorkspace();
  const args = inWorkspace(workspaceId, wanted ? { kind, id } : "skip");
  return {
    room: useProtectedQuery(api.sharing.guests.room, args).data,
    guests: usePaginatedQuery(api.sharing.guests.list, args, { initialNumItems: PAGE }),
    invited: usePaginatedQuery(api.sharing.guests.invited, args, { initialNumItems: PAGE }),
  };
}

/**
 * An item's Share button, and the dialog it opens. `guests` is how many the item has,
 * invitations included, as the page's own read of the item gives it, so the button is its
 * final size from its first frame.
 */
export function ShareButton({ guests, ...item }: Item & { guests: number }) {
  const t = useTranslations("workspaces.share");
  const [open, setOpen] = useState(false);
  const access = useGuests(item, open || guests > 0);
  return (
    <>
      <Button variant="outline" size="sm" className="h-8 shrink-0" aria-label={t(`shareThis.${item.kind}`)} onClick={() => setOpen(true)}>
        <Share2 />
        {t("share")}
        {guests ? <span className="ml-0.5 rounded-full bg-muted px-1.5 text-2xs tabular-nums">{guests}</span> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} onOpenAutoFocus={focusContent} className="top-[max(1rem,12dvh)] flex max-h-[min(40rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <Share close={() => setOpen(false)} access={access} {...item} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Who has an item and adding guests to it. Your own workspace's item is yours; an
 * organization's is every member's, so it lists the organization, then its guests.
 */
function Share({ close, access, kind, id, name }: Item & { close: () => void; access: ReturnType<typeof useGuests> }) {
  const t = useTranslations("workspaces.share");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow();
  const { user } = useUser();
  const workspaceId = useWorkspace();
  const workspace = useCurrentWorkspace();
  const plan = usePlanOf(workspace ?? { kind: "personal", name: "" });
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const text = useDeferredValue(query.trim());
  const candidates = usePaginatedQuery(api.sharing.guests.candidates, inWorkspace(workspaceId, { kind, id, ...(text ? { text } : {}) }), { initialNumItems: 8 });
  const add = useWorkspaceMutation(api.sharing.guests.add);
  const invite = useWorkspaceAction(api.sharing.invitations.invite);
  const setRole = useWorkspaceMutation(api.sharing.guests.setRole);
  const remove = useWorkspaceMutation(api.sharing.guests.remove);
  const failed = (error: unknown) => showStyledToast("error", getErrorMessage(error, t("failed")));

  const { room, guests, invited } = access;
  const used = room?.used ?? guests.results.length + invited.results.length;
  const limit = room?.limit ?? null;
  const roles = [
    { id: "viewer" as const, kind: "view" as const, label: t("view"), can: t("canView") },
    { id: "editor" as const, kind: "edit" as const, label: t("edit"), can: t("canEdit") },
  ].filter((role) => SHARED_KINDS[kind].roles.includes(role.id));
  // A kind with one role has nothing to pick: each guest's row says what they can do.
  const picks = roles.length > 1;
  const me = { name: user?.fullName || user?.primaryEmailAddress?.emailAddress || "", email: user?.primaryEmailAddress?.emailAddress ?? "", imageUrl: user?.imageUrl };
  const more = [guests, invited].find((list) => list.status === "CanLoadMore");

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">{t(`title.${kind}`)}</DialogTitle>
          <DialogDescription className="truncate text-xs">{name}</DialogDescription>
        </div>
        <IconButton label={tc("close")} icon={<X className="size-4" />} onClick={close} />
      </div>
      <SharePanel<GuestRole>
        adding={{
          query,
          onQuery: setQuery,
          // The ones asked for last stay while the next ones load, so the list under the box doesn't blink.
          candidates: candidates.status === "LoadingFirstPage" && !candidates.results.length ? undefined : candidates.results.map((person) => ({
            key: person.userId,
            avatar: <IdentityAvatar name={person.name || person.email} imageUrl={person.imageUrl} className="size-9" />,
            name: person.name || person.email,
            detail: person.email,
            pick: () => void add({ kind, id, userId: person.userId, role: "viewer" }).catch(failed),
          })),
          more: candidates.status === "CanLoadMore" || candidates.status === "LoadingMore" ? { loading: candidates.status === "LoadingMore", load: () => candidates.loadMore(8) } : undefined,
          invite: (email) => void invite({ kind, id, email, role: "viewer" }).catch(failed),
          has: (email) => invited.results.some((invitation) => invitation.email === email) || guests.results.some((guest) => guest.email.toLowerCase() === email),
          full: limit !== null && used >= limit ? t(`full.${kind}`, { plan: plan.name, count: limit }) : undefined,
        }}
        roles={roles}
        entries={[
          workspace?.kind === "organization"
            ? { key: "everyone", avatar: <WorkspaceTile workspace={workspace} size="row" />, name: t("everyone", { workspace: workspace.name }), detail: t("members", { count: workspace.members ?? 0 }), role: { kind: "edit" as const, label: t("canEdit") } }
            : { key: "me", avatar: <IdentityAvatar name={me.name} imageUrl={me.imageUrl} className="size-9" />, name: me.name, you: true, detail: me.email, role: { kind: "owner" as const, label: t("owner") } },
          ...guests.results.map((guest) => ({
            key: guest.userId,
            avatar: <IdentityAvatar name={guest.name || guest.email} imageUrl={guest.imageUrl} className="size-9" />,
            name: guest.name || guest.email,
            detail: guest.email,
            role: guest.role,
            ...(picks ? { onRole: (role: GuestRole) => void setRole({ kind, id, guest: { userId: guest.userId }, role }).catch(failed) } : {}),
            onRemove: () => void remove({ kind, id, guest: { userId: guest.userId } }).catch(failed),
          })),
          ...invited.results.map((invitation) => ({
            key: invitation.email,
            avatar: <EmailAvatar />,
            name: invitation.email,
            // Sent a week before it expires, by the server's clock: never later than now by this one's.
            detail: invitation.delivery === "failed" ? t("notSent") : t("invited", { when: format.relativeTime(Math.min(invitation.expiresAt - WEEK, now.getTime()), now) }),
            role: invitation.role,
            ...(picks ? { onRole: (role: GuestRole) => void setRole({ kind, id, guest: { email: invitation.email }, role }).catch(failed) } : {}),
            onRemove: () => void remove({ kind, id, guest: { email: invitation.email } }).catch(failed),
          })),
        ]}
        foot={
          <>
            {more ? (
              <Button variant="ghost" size="sm" className="h-8 w-full" onClick={() => more.loadMore(PAGE)}>
                {t("morePeople")}
              </Button>
            ) : null}
            <GuestMeter used={used} limit={limit} />
          </>
        }
        // The link without the organization in it opens for a member in the organization and for a guest in their own workspace.
        onCopy={() => navigator.clipboard.writeText(`${window.location.origin}${bareWorkspacePath(pathname)}${params.size ? `?${params}` : ""}`)}
      />
    </>
  );
}

/** Guests on this item against what the owning workspace's plan allows. */
function GuestMeter({ used, limit }: { used: number; limit: number | null }) {
  const t = useTranslations("workspaces.share");
  const workspace = useCurrentWorkspace();
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            {t("guests")}
            {workspace ? <PlanChip workspace={workspace} /> : null}
          </span>
          {limit === null ? (
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground">
              {t("guestCount", { count: used })}
              <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-success/10 px-2.5 text-xs ink-success">{t("noLimit")}</span>
            </span>
          ) : (
            <span className="shrink-0 tabular-nums text-muted-foreground">{t("usedOf", { used, limit })}</span>
          )}
        </div>
        {limit === null ? null : (
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: limit }, (_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < used ? (used >= limit ? "bg-warning" : "bg-primary") : "bg-muted")} />
            ))}
          </div>
        )}
      </div>
      {limit !== null && used >= limit ? (
        <Button asChild size="sm" variant="outline" className="h-8 shrink-0">
          <Link href="/pricing">{t("moreGuests")}</Link>
        </Button>
      ) : null}
    </div>
  );
}
