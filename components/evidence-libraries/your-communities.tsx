"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { RoleLabel } from "@/components/ui/identity";
import { useMutation, type Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import { SIDEBAR_PER_PAGE } from "@/lib/evidence-libraries/directory";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import Link from "@/components/workspace-link";
import { useWorkspaces, WorkspaceTile, type WorkspaceRow } from "@/components/workspaces/parts";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Clock3, ExternalLink, Layers, MoreHorizontal, Move, RotateCcw, Settings2, Share2, UserPlus, UserRound, X, XCircle } from "@/components/icons";
import { useWorkspace } from "@/lib/workspaces/url";
import { APPLICATIONS_SHOWN } from "@/lib/evidence-libraries/applications";
import { useOpenApply, type ApplySeed } from "./applications/apply-dialog";
import { MoveDialog } from "@/components/workspaces/move-dialog";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { Spinner } from "@/components/ui/spinner";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Tooltip, TooltipContent, TooltipHint, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageStepper } from "@/components/shared/page-stepper";
import { AdminAreaLink } from "./admin-area-link";
import { LIST_FILTER } from "./list-controls";
import { LibraryImage } from "./library-image";
import { LibraryStatusIcon, type LibraryOperation } from "./library-status-chip";

type Overview = FunctionReturnType<typeof api.evidenceLibraries.queries.listLibraries>["page"][number];
/** The sidebar's first page as the page's server read it, for the filter in its address. */
export type SidebarFirstPage = {
  filter: CommunityFilter;
  list: Preloaded<typeof api.evidenceLibraries.queries.listLibraries>;
  invitations?: Preloaded<typeof api.evidenceLibraries.invitations.listInvitations>;
  /** The person's applications to join communities (OS-31), and how many wait on the ones they answer for. */
  applicationsWaiting?: Preloaded<typeof api.evidenceLibraries.applications.mine>;
  applicationsDeclined?: Preloaded<typeof api.evidenceLibraries.applications.mine>;
  waitingCounts?: Preloaded<typeof api.evidenceLibraries.applications.waitingCounts>;
};
type MyApplication = FunctionReturnType<typeof api.evidenceLibraries.applications.mine>["page"][number];

type Invitation = FunctionReturnType<typeof api.evidenceLibraries.invitations.listInvitations>["page"][number];
type Role = "owner" | "editor" | "creator" | "viewer";
/** Who a community belongs to, for the badge on its icon: an organization's logo, or a person's photo. */
type Owner = { name: string; imageUrl: string | null; kind: "person" | "organization"; workspaceId?: string };
export type Community = {
  id: string;
  invitationId?: Id<"itemInvitations">;
  faviconUrl?: string | null;
  status?: "draft" | "setting_up" | "setup_failed" | "active" | "deleting";
  name: string;
  role: Role;
  address: string;
  owner: Owner;
  pending?: boolean;
  draft?: boolean;
  deletionFailed?: boolean;
  configuration?: string;
  operation?: LibraryOperation | null;
  /** An invitation for an organization the person is an admin of, which they pick on accepting (#1091). */
  toOrganization?: boolean;
  /** The person's own application to join it, and where it stands, with what the apply dialog shows of it. */
  application?: "waiting" | "declined";
  applicationSeed?: ApplySeed;
  /** People waiting for an answer to join it, for its owners and editors. */
  toReview?: number;
};
export const ROLE_KINDS = { owner: "owner", editor: "editor", creator: "creator", viewer: "view" } as const;

const fromOverview = (library: Overview): Community => ({
  id: library._id, name: library.name, role: library.role, faviconUrl: library.faviconUrl, owner: { ...library.organization, workspaceId: library.workspaceId },
  address: library.publicAddress.replace(/^https?:\/\//, ""), status: library.status, operation: library.operation,
  deletionFailed: Boolean(library.teardownFailedStep), draft: library.status !== "active",
  ...(library.role === "owner" || library.status !== "deleting" ? { configuration: `/evidence-communities/${library._id}/configuration` } : {}),
});
const fromApplication = (application: MyApplication): Community => ({
  id: application.libraryId, name: application.name, faviconUrl: application.faviconUrl, role: "creator", address: application.address,
  owner: application.owner, application: application.state === "declined" ? "declined" : "waiting", pending: true,
  applicationSeed: {
    community: { libraryId: application.libraryId, name: application.name, faviconUrl: application.faviconUrl, address: application.address, owner: application.owner, applicationsOpen: true },
    standing: {
      libraryId: application.libraryId, member: false,
      application: { state: application.state, message: application.message, createdAt: application.createdAt, decidedAt: application.decidedAt, reason: application.reason, reasonPreset: application.reasonPreset, appliesAgainAt: application.appliesAgainAt, hidden: false },
    },
  },
});
const fromInvitation = (invitation: Invitation): Community => ({
  id: invitation.libraryId, invitationId: invitation.invitationId, name: invitation.name, role: invitation.role, address: "", pending: true, toOrganization: invitation.toOrganization,
  owner: { name: invitation.organization.name, imageUrl: invitation.organization.imageUrl, kind: invitation.organization.id ? "organization" : "person" },
});

const PER_PAGE = SIDEBAR_PER_PAGE;
/** The filter's "More workspaces" item, which is no filter of its own. */
const MORE = "more-workspaces";
/** A row's height, which every row of a page keeps, so a short last page doesn't move the pager. */
const ROW_REM = 3;

type Answer = (community: Community) => void;
/** Accepting, for one of the person's organizations when the invitation is for an organization. */
export type Accept = (community: Community, organization?: { organizationId: Id<"organizations">; name: string }) => void;
type Actions = { onAccept: Accept; onDecline: Answer; answering: string | null; notify: (text: string) => void };
type Organization = WorkspaceRow & { organizationId: Id<"organizations"> };
/** What the list shows: everything, the person's own, one workspace's, or what's shared. In an organization, `here` is its own. */
export type CommunityFilter = "all" | "own" | "here" | "shared" | Id<"workspaces">;

/**
 * Every community you can open, in one list a page at a time, filtered on the server by where it's
 * from (#1090). In your own workspace that's yours, each organization's you're in and the ones
 * shared with you, invitations first; in an organization's, its own and the ones shared with it.
 */
export function YourCommunities({ waiting = false, framed = false, search, personal, workspaceName, workspaceImage, organization, filter, onFilter, preloaded, ...actions }: Actions & {
  search: string;
  personal: boolean;
  workspaceName: string;
  workspaceImage?: string;
  organization?: Id<"organizations">;
  filter: CommunityFilter;
  onFilter: (filter: CommunityFilter) => void;
  /** Until the page knows the workspace, the list shows its spinner under the header. */
  waiting?: boolean;
  /** In the page's sidebar: the list on a card of its own, beside the page's. */
  framed?: boolean;
  /** The list's first page, and its invitations, as the server read them with the page for `filter`. */
  preloaded?: SidebarFirstPage;
}) {
  const t = useTranslations("libraryList.sidebar");
  const workspaces = useWorkspaces();
  const organizations = (workspaces.list ?? []).filter((row): row is Organization => row.kind === "organization" && row.organizationId !== undefined);
  const from = filter === "all" || filter === "here" ? undefined : filter;
  const read = useCursorPage(
    api.evidenceLibraries.queries.listLibraries,
    waiting ? "skip" : { ...(search ? { search } : {}), ...(organization ? { organization } : {}), ...(from ? { from } : {}) },
    PER_PAGE,
  );
  // Invitations are yours, in your own workspace, and wait for an answer: they come first.
  const invitations = useProtectedQuery(api.evidenceLibraries.invitations.listInvitations, personal && !waiting && (filter === "all" || filter === "shared") ? {} : "skip");
  const needle = search.toLowerCase();
  // The server's first page, until the live one arrives: the rows are there from the first frame, so the card doesn't grow when they come.
  const fromServer = preloaded && preloaded.filter === filter && !search;
  // Only a whole list stands in: the sidebar's page joins several reads, and the server's is one.
  const served = fromServer ? preloadedQueryResult(preloaded.list) : undefined;
  const firstList = served?.isDone && (waiting || read.isLoading) ? served : undefined;
  const invitationRows = invitations.data ?? (fromServer && preloaded.invitations ? preloadedQueryResult(preloaded.invitations) : undefined);
  const items = firstList?.page ?? read.items;
  const invited = read.page === 1 ? (invitationRows?.page ?? []).filter((row) => `${row.name} ${row.organization.name}`.toLowerCase().includes(needle)).map(fromInvitation) : [];
  // The person's applications to join communities (OS-31), beside their invitations, from the page's server until the live ones arrive.
  const workspaceId = useWorkspace();
  const showsApplications = personal && !waiting && (filter === "all" || filter === "shared");
  // Every waiting one (a person has at most APPLICATIONS_SHOWN), then the newest declined, so no decline hides one that waits.
  const first = { numItems: APPLICATIONS_SHOWN, cursor: null };
  const waitingLive = useProtectedQuery(api.evidenceLibraries.applications.mine, showsApplications && workspaceId ? { workspaceId, state: "waiting", paginationOpts: first } : "skip").data;
  const declinedLive = useProtectedQuery(api.evidenceLibraries.applications.mine, showsApplications && workspaceId ? { workspaceId, state: "declined", paginationOpts: first } : "skip").data;
  const waitingRows = waitingLive ?? (fromServer && preloaded.applicationsWaiting ? preloadedQueryResult(preloaded.applicationsWaiting) : undefined);
  const declinedRows = declinedLive ?? (fromServer && preloaded.applicationsDeclined ? preloadedQueryResult(preloaded.applicationsDeclined) : undefined);
  const applicationRows = waitingRows && declinedRows ? [...waitingRows.page, ...declinedRows.page] : undefined;
  const applied = read.page === 1 ? (applicationRows ?? []).filter((row) => `${row.name} ${row.owner.name}`.toLowerCase().includes(needle)).map(fromApplication) : [];
  // How many wait on the communities the person answers for: their owners' and editors'.
  const answered = items.filter((library) => (library.role === "owner" || library.role === "editor") && library.status === "active").map((library) => library._id);
  const countsLive = useProtectedQuery(api.evidenceLibraries.applications.waitingCounts, workspaceId && answered.length ? { workspaceId, libraryIds: answered } : "skip").data;
  const counts = new Map(((countsLive ?? (fromServer && preloaded.waitingCounts ? preloadedQueryResult(preloaded.waitingCounts) : undefined))?.page ?? []).map((row) => [row.libraryId as string, row.waiting]));
  const reviewing = (community: Community): Community => (counts.get(community.id) ? { ...community, toReview: counts.get(community.id) } : community);
  // ponytail: a page is sorted by name here; the server pages place by place. Sorting across pages needs an index by name across workspaces.
  const rows = [...invited, ...applied, ...items.map(fromOverview).map(reviewing).sort((a, b) => a.name.localeCompare(b.name))];
  const loading = !firstList && (waiting || read.isLoading || (invitationRows === undefined && personal && (filter === "all" || filter === "shared")) || (applicationRows === undefined && showsApplications));
  const hasPages = firstList ? !firstList.isDone : read.hasPages;
  const shared = personal ? t("sharedWithYou") : t("sharedWith", { name: workspaceName });
  const filterName = filter === "own" ? t("yours") : organizations.find((row) => row.workspaceId === filter)?.name ?? workspaceName;
  const empty = search ? t("noMatches")
    : filter === "all" ? (personal ? t("emptyAll") : t("emptyHere", { name: workspaceName }))
    : filter === "shared" ? (personal ? t("emptyShared") : t("emptySharedHere", { name: workspaceName }))
    : filter === "own" ? t("emptyOwn")
    : t("emptyWorkspace", { name: filterName });
  // In the sidebar the filter heads its card; on a phone it heads the list.
  // "More workspaces" reads the next of the person's workspaces into the list, and leaves the filter as it was.
  const filterSelect = (
    <Select value={filter} onValueChange={(value) => (value === MORE ? workspaces.loadMore() : onFilter(value as CommunityFilter))}>
      <SelectTrigger size="sm" aria-label={t("showFrom")} className={cn("w-full", framed ? LIST_FILTER : "border-transparent bg-transparent font-medium shadow-none hover:bg-muted")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all"><Layers />{personal ? t("allWorkspaces") : t("allCommunities")}</SelectItem>
        <SelectSeparator />
        {personal ? (
          <SelectGroup>
            <SelectLabel>{t("workspaces")}</SelectLabel>
            <SelectItem value="own"><UserRound />{t("yours")}</SelectItem>
            {organizations.map((row) => <SelectItem key={row.workspaceId} value={row.workspaceId}><WorkspaceTile workspace={row} size="xxs" />{row.name}</SelectItem>)}
            {workspaces.more ? <SelectItem value={MORE} disabled={workspaces.loading}><ChevronDown />{t("moreWorkspaces")}</SelectItem> : null}
          </SelectGroup>
        ) : (
          <SelectItem value="here"><IdentityAvatar name={workspaceName} imageUrl={workspaceImage} kind="organization" className="size-4 rounded-sm" />{workspaceName}</SelectItem>
        )}
        <SelectSeparator />
        <SelectItem value="shared"><Share2 />{shared}</SelectItem>
      </SelectContent>
    </Select>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* On a phone the filter heads the list; in the sidebar it heads the list's card. */}
      {framed ? null : <div className="flex h-16 shrink-0 items-center border-b border-border-subtle px-3">{filterSelect}</div>}
      {/* In the sidebar the list sits on a card like the page's own, level with it; the card takes its rows' height, up to the window's. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", framed && "py-4 ps-4 sm:py-6 sm:ps-6")}>
      <div className={cn("relative flex min-h-0 flex-col", framed && "overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-surface")}>
      {framed ? <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent" /> : null}
      {/* The filter in the search bar's look, and its row the search row's height, so the two cards' dividers line up. */}
      {framed ? <div className="relative shrink-0 border-b border-border-subtle p-4">{filterSelect}</div> : null}
      <div className="relative min-h-0 flex-1 overflow-y-auto p-2">
        {/* The list arrives after the page, and changes length with the filter: it slides to its height. */}
        <AutoHeight>
          {loading && !read.isStale ? (
            <div style={{ height: `${ROW_REM}rem` }} className="grid place-items-center"><Spinner aria-label={t("loading")} className="size-5 text-primary" /></div>
          ) : rows.length ? (
            <ul
              style={hasPages ? { minHeight: `${PER_PAGE * ROW_REM}rem` } : undefined}
              className={cn(read.isStale && "opacity-60")}
              inert={read.isStale || undefined}
            >
              {rows.map((community) => <CommunityRow key={community.invitationId ?? (community.application ? `applied:${community.id}` : community.id)} community={community} actions={actions} />)}
            </ul>
          ) : (
            <p className="fade-enter px-2 py-3 text-xs text-muted-foreground">{empty}</p>
          )}
          {!loading && hasPages && (
            <PageStepper className="px-2 pt-2" page={read.page} canPrevious={read.canPrevious} canNext={read.canNext} onPrevious={read.previous} onNext={read.next} />
          )}
        </AutoHeight>
      </div>
      </div>
      </div>
    </div>
  );
}

/** A community with no icon of its own shows Openscholar's, as its page's header does. */
function Tile() {
  // The icon fades in where its place is held, as a country flag does, in place of appearing in one frame.
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-inset">
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's own icon */}
      <img
        ref={(image) => { if (image?.complete && image.naturalWidth > 0) setLoaded(true); }}
        src="/icon.svg"
        alt=""
        onLoad={() => setLoaded(true)}
        className={cn("size-4 object-contain transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}

/** The community's icon, with who it belongs to on its corner: the organization's logo, or the person's photo. */
export function CommunityIcon({ community, fadeIn = false }: {
  community: Pick<Community, "faviconUrl" | "owner">;
  /** Fades the icon in once it loads, for a row drawn after the page, such as Your submissions. */
  fadeIn?: boolean;
}) {
  const { owner } = community;
  // The person's own workspaces, with the colours their admins picked, as the switcher has them.
  const known = new Map((useWorkspaces().list ?? []).map((row) => [row.workspaceId as string, row]));
  return (
    <div className="relative shrink-0">
      {community.faviconUrl ? <LibraryImage fadeIn={fadeIn} src={community.faviconUrl} className="flex size-8 overflow-hidden rounded-lg bg-inset" imageClassName="size-full object-cover" fallback={<Tile />} /> : <Tile />}
      {/* Its owner as the switcher draws a workspace: its logo, or the mark made for it in its colour; a person's photo. */}
      <span className="absolute -bottom-1 -end-1 flex rounded-[0.35rem] bg-background ring-2 ring-background transition-shadow group-hover/row:ring-muted group-has-[[data-state=open]]/row:ring-muted">
        <WorkspaceTile workspace={known.get(owner.workspaceId ?? "") ?? { kind: owner.kind === "organization" ? "organization" : "personal", name: owner.name, imageUrl: owner.imageUrl ?? undefined, workspaceId: owner.workspaceId }} size="xxs" />
      </span>
    </div>
  );
}

/** One community: its name opens it, and everything else it offers is in its menu. */
function CommunityRow({ community, actions }: { community: Community; actions: Actions }) {
  const t = useTranslations("libraryList");
  const ts = useTranslations("libraryList.sidebar");
  const ta = useTranslations("communityApplications");
  const role = t(community.role);
  const tm = useTranslations("workspaces.move");
  const restartTeardown = useMutation(api.evidenceLibraries.teardown.restartDevelopmentTeardown);
  const [retrying, setRetrying] = useState(false);
  const [moving, setMoving] = useState(false);
  // Its owners move it, from the workspace it's in, unless it's being deleted.
  const movesFrom = community.role === "owner" && community.status !== "deleting" ? community.owner.workspaceId : undefined;
  const live = !community.pending && !community.draft && !community.application;
  const openApplication = useOpenApply();
  // The whole row opens it: the name's link covers the row, under the buttons.
  const name = community.application
    ? <button type="button" onClick={() => { if (community.applicationSeed) openApplication(community.applicationSeed); }} className="truncate text-start text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">{community.name}</button>
    : community.configuration
    ? <Link href={community.configuration} className="truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">{community.name}</Link>
    : live ? <a href={`https://${community.address}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">{community.name}</a>
    : <span className="truncate text-sm font-medium">{community.name}</span>;
  // Every community but an invitation shows its state as an icon before its name, its word on hover, as the list always has.
  const status = community.pending || community.application ? null : community.status ?? "active";
  return (
    <li data-library-row={community.id} data-status={community.status} style={{ height: `${ROW_REM}rem` }} className="fade-enter group/row relative flex items-center gap-3 rounded-lg px-2 transition-colors hover:bg-muted has-[[data-state=open]]:bg-muted">
      <CommunityIcon community={community} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          {status && <LibraryStatusIcon status={status} operation={community.operation} className="relative z-10 [&>svg]:size-3.5" />}
          {name}
        </span>
        {/* The height of its "to review" chip, with or without it, so the row holds still when the count arrives. */}
        <span className="flex h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {community.application === "waiting" || community.application === "declined" ? <ApplicationState state={community.application} /> : (
            // Cut off beside an invitation's buttons, the role it offers shows whole on hover.
            <TooltipHint label={community.pending ? ts(community.toOrganization ? "invitedForOrganization" : "invitedAs", { role }) : role} onlyWhenClipped>
              <RoleLabel role={ROLE_KINDS[community.role]} className="min-w-0 shrink"><span className="truncate">{community.pending ? ts(community.toOrganization ? "invitedForOrganization" : "invitedAs", { role }) : role}</span></RoleLabel>
            </TooltipHint>
          )}
          {community.toReview ? (
            // Above the row's link: straight to the people waiting, on its Team card.
            <Link href={`/evidence-communities/${community.id}/configuration?section=team&team=applications`} className="relative z-10 inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 font-medium text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring">
              <UserPlus className="size-3" />{ta("toReview", { count: community.toReview })}
            </Link>
          ) : null}
        </span>
      </div>
      {community.application ? null : community.pending ? (
        <div className="relative flex shrink-0 items-center gap-1">
          <IconAction label={t("declineInvitation")} disabled={actions.answering !== null} onClick={() => actions.onDecline(community)}><X /></IconAction>
          {community.toOrganization ? <AcceptForOrganization community={community} actions={actions} /> : (
            // A text button: it leaves the row once the invitation is answered, and a tooltip would go with it.
            <Button size="sm" className="h-7 px-2.5" disabled={actions.answering !== null} onClick={() => actions.onAccept(community)}><Check />{ts("accept")}</Button>
          )}
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="absolute end-1.5 top-1/2 -translate-y-1/2 bg-muted opacity-0 hover:bg-inset group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:translate-y-0 [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100" aria-label={t("moreActionsFor", { name: community.name })}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {community.configuration && (
              <DropdownMenuItem asChild>
                <Link href={community.draft && community.status !== "draft" && community.role === "owner" && community.status !== "deleting" ? `/evidence-communities/${community.id}/setup` : community.configuration}>
                  <Settings2 />
                  {community.draft && community.status !== "draft" && community.status !== "deleting" ? t("viewSetup") : community.role === "owner" ? t("configure") : t("settings")}
                </Link>
              </DropdownMenuItem>
            )}
            {live && community.role !== "viewer" && (
              <DropdownMenuItem asChild>
                <AdminAreaLink address={`https://${community.address}`}><ExternalLink />{t("openAdmin")}</AdminAreaLink>
              </DropdownMenuItem>
            )}
            {live && (
              <DropdownMenuItem asChild>
                <a href={`https://${community.address}`} target="_blank" rel="noopener noreferrer"><ExternalLink />{t("viewPublicLibrary")}</a>
              </DropdownMenuItem>
            )}
            {community.status === "deleting" && community.deletionFailed && community.role === "owner" && (
              <DropdownMenuItem disabled={retrying} onSelect={async () => {
                setRetrying(true);
                try { await restartTeardown({ libraryId: community.id as Id<"evidenceLibraries"> }); actions.notify(t("deletionRestartedFor", { name: community.name })); }
                catch (error) { actions.notify(getErrorMessage(error, t("couldNotRestartDeletion"))); }
                finally { setRetrying(false); }
              }}><RotateCcw />{t("retryDeletion")}</DropdownMenuItem>
            )}
            {movesFrom && <DropdownMenuItem onSelect={() => setMoving(true)}><Move />{tm("toAnother")}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Mounted once asked for: a page of rows doesn't each ask whether theirs can move. */}
      {movesFrom && moving ? <MoveDialog open onOpenChange={setMoving} kind="community" id={community.id} name={community.name} from={movesFrom as Id<"workspaces">} /> : null}
    </li>
  );
}

/**
 * Accepting an invitation for an organization (#1091): for the one the person is an admin of, or, with several,
 * the one they pick. One who is an admin of none can't take it, and the button says why.
 */
function AcceptForOrganization({ community, actions }: { community: Community; actions: Actions }) {
  const ts = useTranslations("libraryList.sidebar");
  // Every organization they're an admin of, read whole: the switcher's list comes a page at a time. Off until it's read.
  const read = useProtectedQuery(api.evidenceLibraries.organizationGrants.adminOf, {}).data?.page;
  const theirs = (read ?? []).map((row) => ({ ...row, kind: "organization" as const, imageUrl: row.imageUrl ?? undefined, colour: row.colour ?? undefined, workspaceId: row.workspaceId ?? undefined }));
  const button = (props: Record<string, unknown>) => <Button size="sm" className="h-7 px-2.5" disabled={actions.answering !== null || theirs.length === 0} {...props}><Check />{ts("accept")}{theirs.length > 1 && <ChevronDown />}</Button>;
  if (!read) return button({});
  if (theirs.length === 0) {
    return (
      <Tooltip>
        {/* Focusable, so the reason it's off is there on hover and focus. */}
        <TooltipTrigger asChild><span tabIndex={0}>{button({})}</span></TooltipTrigger>
        <TooltipContent>{ts("acceptAsAnAdmin")}</TooltipContent>
      </Tooltip>
    );
  }
  if (theirs.length === 1) return button({ onClick: () => actions.onAccept(community, theirs[0]) });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button({ "aria-label": ts("acceptForWhich", { name: community.name }) })}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {theirs.map((row) => <DropdownMenuItem key={row.organizationId} onSelect={() => actions.onAccept(community, row)}><WorkspaceTile workspace={row} size="xxs" />{row.name}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Where the person's application stands, in words beside its icon. */
function ApplicationState({ state }: { state: "waiting" | "declined" }) {
  const t = useTranslations("communityApplications");
  const Icon = state === "waiting" ? Clock3 : XCircle;
  return <span className={cn("inline-flex items-center gap-1.5", state === "declined" && "text-destructive")}><Icon className="size-3.5 shrink-0" />{state === "waiting" ? t("waitingForReview") : t("notAccepted")}</span>;
}

function IconAction({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="size-7" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
