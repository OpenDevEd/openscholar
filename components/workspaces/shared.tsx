"use client";

// Shared with me (#653): the items people outside your workspaces gave you, and the page an
// invitation's email links to. They sit in your own workspace, and work you run on them uses
// your own credits.

import { EffectList } from "@/components/screening/effects";
import { useOpenInAddress } from "@/components/screening/address";
import { useClerk } from "@clerk/nextjs";
import { ConfirmChange } from "@/components/screening/team";
import { useWords } from "@/components/screening/words";
import { nameHas } from "@/lib/screening/rules";
import { collectionHref } from "@/lib/library/links";
import { FadeRow } from "@/components/ui/fade-row";
import { useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { Building2, Check, CircleCheck, Coins, FileSearch, Folder, ListFilter, LogOut, Mail, MessageSquare, Search, SearchX, Share2, Unlink, UserRound, X, type AppIcon } from "@/components/icons";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { Entry, EntryAction, EntryAside, ENTRY_OPEN } from "@/components/command-center/entry";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListEmpty, ListLoading } from "@/components/evidence-libraries/list-controls";
import { LIST, Tile } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { PersonTag, RoleLabel } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { toast } from "sonner";
import { showStyledToast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { GuestRole, SharedKind } from "@/convex/sharing/validators";
import { useQueryStates } from "nuqs";
import { searchHistory } from "@/components/screening/address";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { openChat } from "@/lib/assistant/place";
import { SHARED_PAGE, SHARED_PLACE } from "@/lib/sharing";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { Chip, Hero, Landing, Point } from "./join";
import { useCurrentWorkspace, WorkspaceTag, WorkspaceTile } from "./parts";
import { screeningPath } from "@/lib/screening/links";

/** Each kind's look, where one opens in your own workspace, and the roles its guests can be given (convex/sharing/items.ts). `open` opens one that has no page of its own, over whatever page the person is on. */
export const SHARED_KINDS: Record<SharedKind, { icon: AppIcon; tint: string; href: (id: string) => string; open?: (id: string) => void; roles: readonly GuestRole[] }> = {
  collection: { icon: Folder, tint: "#e8890c", href: collectionHref, roles: ["viewer", "editor"] },
  // A screening's editor votes on its papers as one of its reviewers.
  screening: { icon: ListFilter, tint: "#34d399", href: screeningPath, roles: ["viewer", "editor"] },
  extraction: { icon: FileSearch, tint: "#818cf8", href: (id) => `/extraction/${id}`, roles: ["viewer"] },
  // A search shared with you goes by its document's ID, and opens with its own query and filters.
  search: { icon: Search, tint: "#60a5fa", href: (id) => `/results/${id}`, roles: ["viewer", "editor"] },
  // An author profile is public: what's shared is editing it, from its own page.
  author: { icon: UserRound, tint: "#f472b6", href: (id) => `/authors/${id}`, roles: ["editor"] },
  // A chat opens in the assistant's panel. The panel reads the address once a page load, so its address only opens it from outside the app or in a new tab.
  chat: { icon: MessageSquare, tint: "#a78bfa", href: (id) => `/?chat=${id}`, open: openChat, roles: ["viewer", "editor"] },
};

type Sort = "recent" | "name";
type Counts = FunctionReturnType<typeof api.sharing.shared.counts>;

/** `initial` is what the page's route read on the server: the counts, and the first page newest first. */
export function SharedWithMe({ initial }: { initial?: { counts: Counts; rows: SharedItem[]; invitations: WaitingInvitation[] } }) {
  const t = useTranslations("workspaces.shared");
  const workspaceId = useWorkspace();
  const workspace = useCurrentWorkspace();
  // The kind, the order and the search are in the address: Back undoes a change, and coming back keeps them.
  const [{ kind, q: text, sort }, setPlace] = useQueryStates(SHARED_PLACE, { history: "push", scroll: false });
  const setKind = (next: SharedKind | null) => void setPlace({ kind: next });
  const setSort = (next: Sort) => void setPlace({ sort: next === "recent" ? null : next });
  const setText = (next: string) => void setPlace({ q: next || null }, searchHistory(text, next));
  const needle = useDeferredValue(text.trim());
  const counts = useProtectedQuery(api.sharing.shared.counts, inWorkspace(workspaceId, {})).data ?? initial?.counts;
  const { results, status, loadMore } = usePaginatedQuery(api.sharing.shared.list, inWorkspace(workspaceId, { sort, ...(kind ? { kind } : {}), ...(needle ? { text: needle } : {}) }), { initialNumItems: SHARED_PAGE });
  // The rows shown: the view asked for once it's read, and until then the ones shown last, which at first are the page's own.
  const loading = status === "LoadingFirstPage";
  const [kept, keep] = useState(initial?.rows);
  if (!loading && kept !== results) keep(results);
  const rows = loading ? kept : results;
  // The invitations come with the page, from the first frame: the rows never move down for them.
  const invitations = useWaitingInvitations(initial?.invitations);
  const invited = (invitations ?? []).some((row) => (!kind || row.kind === kind) && nameHas(row.name, needle));
  const kinds = (Object.keys(SHARED_KINDS) as SharedKind[]).filter((one) => counts?.[one]);

  return (
    <LibraryPageShell
      icon={Share2}
      title={t("title")}
      filters={
        <CommandCenterFilters
          sortOptions={[
            { value: "recent", label: t("sortRecent") },
            { value: "name", label: t("sortName") },
          ]}
          currentSort={sort}
          onSortChange={setSort}
          searchFilter={text}
          onSearchChange={setText}
          placeholder={t("search")}
        />
      }
      intro={
        <div className="space-y-3 px-4 py-3">
          <FadeRow scrolls scrollbar="none" className="flex h-8 gap-1.5 pe-8">
            {counts ? (
              <>
                <KindChip on={kind === null} onClick={() => setKind(null)} count={counts.total}>
                  {t("all")}
                </KindChip>
                {kinds.map((one) => {
                  const Icon = SHARED_KINDS[one].icon;
                  return (
                    <KindChip key={one} on={kind === one} onClick={() => setKind(kind === one ? null : one)} count={counts[one]}>
                      <Icon className="size-3.5" style={{ color: SHARED_KINDS[one].tint }} />
                      {t(`kinds.${one}`)}
                    </KindChip>
                  );
                })}
              </>
            ) : null}
          </FadeRow>
          <p className="flex h-6 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t("runUses")}
            {workspace ? (
              <WorkspaceTag workspace={workspace} size="sm" strong>
                {t("yourCredits")}
              </WorkspaceTag>
            ) : null}
          </p>
        </div>
      }
    >
      <WaitingInvitations rows={invitations} {...(kind ? { kind } : {})} text={needle} />
      {rows?.length ? (
        // Rows of the view before stay, dimmed and still, until the one asked for arrives.
        <div className={cn("divide-y divide-border-subtle", loading && "pointer-events-none opacity-60")}>
          {rows.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </div>
      ) : !rows ? (
        <ListLoading label={t("loading")} />
      ) : (
        // Under an invitation, the empty list says how what it shares comes here.
        <ListEmpty icon={needle ? SearchX : Share2}>{invited ? t("emptyInvited") : needle ? t("emptySearch") : kind ? t("emptyKind") : t("empty")}</ListEmpty>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="flex justify-center border-t border-border-subtle p-3">
          <Button variant="ghost" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(SHARED_PAGE)}>
            {t("more")}
          </Button>
        </div>
      ) : null}
    </LibraryPageShell>
  );
}

function KindChip({ on, onClick, count, children }: { on: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
        on ? "border-primary/40 bg-primary/10 text-primary" : "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

type SharedItem = { kind: SharedKind; id: string; name: string; role: "viewer" | "editor"; at: number; by: { name: string; imageUrl?: string }; from: From; size?: number };

export type From = { name: string; organization: boolean };

/**
 * What a guest is told of an item wherever they see it: the organization it's in, and what they
 * may do with it. One in a person's own workspace names them with `person`, where nothing beside
 * it says who shared it.
 */
export function GuestChips({ from, role, person = false, votes = false }: { from: From; role: "viewer" | "editor"; person?: boolean; /** A screening: whoever may change other things votes on it, and changes nothing else. */ votes?: boolean }) {
  const t = useTranslations("workspaces.share");
  const Icon = from.organization ? Building2 : UserRound;
  return (
    <>
      {from.organization || person ? (
        <span className="inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{from.name}</span>
        </span>
      ) : null}
      <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-primary/10 px-2.5">
        <RoleLabel role={role === "viewer" ? "view" : "edit"} className="text-primary">
          {t(roleWord(role, votes ? "screening" : "collection"))}
        </RoleLabel>
      </span>
    </>
  );
}

function Row({ item }: { item: SharedItem }) {
  const t = useTranslations("workspaces.shared");
  const words = useWords();
  const frame = useTranslations("screening.frame");
  const leave = useWorkspaceMutation(api.sharing.guests.leave);
  // Leaving can't be undone from here: it asks first, as the screening's own menu does, and the question is a step Back closes.
  const [leaving, setLeaving] = useOpenInAddress("leave", null);
  const asking = leaving === item.id;
  const setAsking = (open: boolean) => setLeaving(open ? item.id : null);
  const kind = SHARED_KINDS[item.kind];
  return (
    <Entry viewMode="list-detail">
      {/* A screening's says what its own menu's Leave says: the votes stay and the papers waiting go to others. */}
      <ConfirmChange open={asking} title={item.kind === "screening" ? frame("leave.title") : t("leaveTitle", { name: item.name })} confirm={t("leave")} onClose={() => setAsking(false)} onConfirm={() => { setAsking(false); void leave({ id: item.id }).catch((error) => showStyledToast("error", getErrorMessage(error, t("leaveFailed")))); }}>
        <EffectList lines={item.kind === "screening" ? [...(item.role === "editor" ? [t("leaveVotes")] : []), frame("leave.fromList")] : [t("leaveSays")]} />
      </ConfirmChange>
      <Tile icon={kind.icon} tint={kind.tint} className="size-10 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <Link
          href={kind.href(item.id)}
          onClick={(event) => {
            // A click asking for a new tab or window follows the address, which loads a page that opens it there.
            if (!kind.open || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            kind.open(item.id);
          }}
          className={cn(ENTRY_OPEN, "line-clamp-2")}
        >
          {item.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <PersonTag name={item.by.name} imageUrl={item.by.imageUrl} />
          <GuestChips from={item.from} role={item.role} votes={item.kind === "screening"} />
          {/* A kind that keeps no count of what it holds, an author profile, has none to show. */}
          {item.size === undefined ? null : <span className="inline-flex h-6 items-center rounded-full border border-border-subtle px-2.5 text-xs tabular-nums text-muted-foreground">{t(`size.${item.kind}`, { count: item.size })}</span>}
        </div>
      </div>
      <EntryAside className="h-7 self-start" meta={<time>{words.ago(item.at)}</time>}>
        <EntryAction label={t("leave")} icon={LogOut} danger onClick={() => setAsking(true)} />
      </EntryAside>
    </Entry>
  );
}

/** A page for something that isn't there to open: an invitation that's gone, or a record that was deleted or isn't shared with the person. */
export function Gone({ title }: { title: string }) {
  const t = useTranslations("workspaces.shared");
  const tw = useTranslations("workspaces");
  return (
    <Landing hero={<Hero icon={Unlink} />} title={title} chips={<p className="text-sm text-muted-foreground">{t("goneDetail")}</p>}>
      <Button variant="outline" className="w-full" asChild>
        <Link href="/">{tw("goToSearch")}</Link>
      </Button>
    </Landing>
  );
}

/** Where an invitation's email links: who shared what, and opening it, which takes the invitation up. */
export function OpenShared({ invitationId }: { invitationId: string }) {
  const t = useTranslations("workspaces.shared");
  const tw = useTranslations("workspaces");
  const ts = useTranslations("workspaces.share");
  const router = useRouter();
  const workspaceId = useWorkspace();
  const personal = useCurrentWorkspace();
  const { data: invitation } = useProtectedQuery(api.sharing.invitations.get, inWorkspace(workspaceId, { invitationId }));
  const respond = useWorkspaceAction(api.sharing.invitations.respond);
  const { signOut } = useClerk();
  const [opening, setOpening] = useState(false);
  if (invitation === undefined) return <Landing />;
  if (invitation === null) {
    return <Gone title={t("goneTitle")} />;
  }
  const open = () => {
    setOpening(true);
    // One taken up already opens as it is; accepting one says what it was to.
    void (invitation.state === "accepted" ? Promise.resolve({ kind: invitation.kind, id: invitation.id }) : respond({ invitationId: invitationId as Id<"itemInvitations">, accept: true })).then(
      (item) => {
        if (!item) return;
        SHARED_KINDS[item.kind].open?.(item.id);
        router.push(SHARED_KINDS[item.kind].href(item.id));
      },
      (error) => {
        setOpening(false);
        showStyledToast("error", getErrorMessage(error, t("openFailed")));
      },
    );
  };
  const decline = () => {
    setOpening(true);
    void respond({ invitationId: invitationId as Id<"itemInvitations">, accept: false }).then(
      () => {
        toast(t("declined", { name: "name" in invitation ? invitation.name : "" }));
        router.replace("/shared");
      },
      (error) => {
        setOpening(false);
        showStyledToast("error", getErrorMessage(error, t("answerFailed")));
      },
    );
  };
  // Sent to another address than this account's own: it says nothing of the item, and opens only if that address is this account's too.
  if (invitation.state === "other") {
    return (
      <Landing hero={<Hero icon={Mail} />} title={t("otherTitle")} chips={<p className="text-sm text-muted-foreground">{t("otherDetail")}</p>}>
        <Button className="w-full" disabled={opening} onClick={open}>
          {t("open")}
        </Button>
        {/* Signed out, they sign in with the address it was sent to and come back to it. */}
        <Button variant="ghost" className="w-full" disabled={opening} onClick={() => void signOut({ redirectUrl: `/sign-in?redirect_url=${encodeURIComponent(`/shared/${invitationId}`)}` })}>
          {t("otherAccount")}
        </Button>
      </Landing>
    );
  }
  const kind = SHARED_KINDS[invitation.kind];
  return (
    <Landing
      hero={<Tile icon={kind.icon} tint={kind.tint} className="size-24 rounded-3xl [&>svg]:size-10" />}
      lead={<Chip lead={<IdentityAvatar name={invitation.by.name} imageUrl={invitation.by.imageUrl} className="size-5" />}>{t(`sharedOne.${invitation.kind}`, { name: invitation.by.name })}</Chip>}
      title={invitation.name}
      chips={
        <>
          {invitation.from.organization ? (
            <Chip>
              <Building2 className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{invitation.from.name}</span>
            </Chip>
          ) : null}
          <Chip tone="primary">
            <RoleLabel role={invitation.role === "viewer" ? "view" : "edit"} className="text-primary">
              {ts(roleWord(invitation.role, invitation.kind))}
            </RoleLabel>
          </Chip>
          {invitation.size === undefined ? null : (
            <Chip>
              <span className="tabular-nums">{t(`size.${invitation.kind}`, { count: invitation.size })}</span>
            </Chip>
          )}
        </>
      }
    >
      <ul className={LIST}>
        <Point lead={personal ? <WorkspaceTile workspace={personal} /> : <span className="size-8" />}>{invitation.kind === "screening" ? t("pointOwnScreening") : t("pointOwn")}</Point>
        {/* A screening's reviewers vote for nothing: its models are its workspace's to pay for. */}
        <Point lead={<Tile icon={Coins} tint="#facc15" className="size-8" />}>{invitation.kind === "screening" ? (invitation.role === "editor" ? t("pointScreening", { name: invitation.from.name, models: String(invitation.models) }) : t("pointLooking")) : t("pointCredits")}</Point>
        {invitation.kind === "screening" && invitation.role === "editor" && invitation.finished ? <Point lead={<Tile icon={CircleCheck} tint="#34d399" className="size-8" />}>{t("finishedVote")}</Point> : null}
      </ul>
      <Button className="w-full" disabled={opening} onClick={open}>
        {t("open")}
      </Button>
      {/* One not taken up yet can be turned down here, as from the lists of invitations. */}
      {invitation.state === "accepted" ? null : (
        <Button variant="ghost" className="w-full" disabled={opening} onClick={decline}>
          {t("declineIt")}
        </Button>
      )}
    </Landing>
  );
}

/** The invitations waiting for the person, of every kind and sent to any address of theirs: one read, shared by every list that shows them and by the rail. Undefined until read, and none for someone signed out, so a page open signed out never waits for them. */
export function useWaitingInvitations(initial?: WaitingInvitation[]) {
  const read = useProtectedQuery(api.sharing.invitations.waiting, inWorkspace(useWorkspace(), {}));
  return read.isAnonymous ? [] : (read.data?.page ?? initial);
}
export type WaitingInvitation = FunctionReturnType<typeof api.sharing.invitations.waiting>["page"][number];

/** The word for what a guest may do with an item: a screening's editor votes on its papers, and changes nothing else. */
export const roleWord = (role: GuestRole, kind: SharedKind) => (role === "viewer" ? "canView" : kind === "screening" ? "canVote" : "canEdit");

/**
 * The invitations to items that wait for the person's answer, as the Evidence Communities list shows its own: above
 * the list, each with who sent it, where from, what it lets them do, Decline and Accept. Accepting opens the item in
 * the person's own workspace, wherever they are. Given a `kind`, only those to it, as a list of that kind shows them,
 * and `text` narrows them by name as the list's search does.
 */
export function WaitingInvitations({ rows, kind, text = "" }: { rows: WaitingInvitation[] | undefined; kind?: SharedKind; text?: string }) {
  const t = useTranslations("workspaces.shared");
  const router = useRouter();
  const respond = useWorkspaceAction(api.sharing.invitations.respond);
  const [answering, setAnswering] = useState<string | null>(null);
  // Matched as the lists match their own rows: every word, in any order.
  const shown = (rows ?? []).filter((row) => (!kind || row.kind === kind) && nameHas(row.name, text.trim()));
  if (!shown.length) return null;
  const answer = (row: WaitingInvitation, accept: boolean) => {
    setAnswering(row.invitationId);
    void respond({ invitationId: row.invitationId, accept }).then(
      (item) => {
        setAnswering(null);
        if (!accept || !item) return void toast(t("declined", { name: row.name }));
        // A chat opens in the assistant's panel over the page; anything else is a page of its own.
        const opens = SHARED_KINDS[item.kind].open;
        if (opens) opens(item.id);
        else router.push(SHARED_KINDS[item.kind].href(item.id));
      },
      (error) => {
        setAnswering(null);
        showStyledToast("error", getErrorMessage(error, t("answerFailed")));
      },
    );
  };
  return (
    <ul aria-label={t("invitations")} className="divide-y divide-border-subtle border-b border-border-subtle">
      <li className="flex items-baseline gap-2 bg-inset px-4 py-2 text-xs font-medium sm:px-6">
        <span>{t("invitations")}</span>
        <span className="tabular-nums text-muted-foreground">{shown.length}</span>
      </li>
      {shown.map((row) => (
        <li key={row.invitationId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <Tile icon={SHARED_KINDS[row.kind].icon} tint={SHARED_KINDS[row.kind].tint} className="size-8 self-start" />
          {/* The name is read whole: on a phone the buttons go under it. */}
          <div className="flex min-w-0 flex-1 basis-52 flex-col gap-1">
            <span dir="auto" className="text-sm font-semibold [overflow-wrap:anywhere]">{row.name}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5"><IdentityAvatar name={row.by.name} imageUrl={row.by.imageUrl} className="size-4" /><span>{t(`sharedOne.${row.kind}`, { name: row.by.name })}</span></span>
              <GuestChips from={row.from} role={row.role} votes={row.kind === "screening"} />
              {/* As its email says: a finished screening takes votes once it is reopened. */}
              {row.kind === "screening" && row.role === "editor" && row.finished ? <span>{t("finishedVote")}</span> : null}
            </span>
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="size-7" aria-label={t("decline", { name: row.name })} disabled={answering !== null} onClick={() => answer(row, false)}><X /></Button>
              </TooltipTrigger>
              <TooltipContent>{t("decline", { name: row.name })}</TooltipContent>
            </Tooltip>
            {/* A text button: it leaves with the row once the invitation is answered, and a tooltip would go with it. */}
            <Button size="sm" className="h-7 px-2.5" disabled={answering !== null} onClick={() => answer(row, true)}><Check />{t("accept")}</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
