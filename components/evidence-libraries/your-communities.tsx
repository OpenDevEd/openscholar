"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import Link from "@/components/workspace-link";
import { useWorkspaces, type WorkspaceRow } from "@/components/workspaces/parts";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Layers, MoreHorizontal, RotateCcw, Settings2, Share2, UserRound, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { Spinner } from "@/components/ui/spinner";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { RoleLabel } from "@/components/ui/identity";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminAreaLink } from "./admin-area-link";
import { LibraryImage } from "./library-image";
import { LibraryStatusChip, type LibraryOperation } from "./library-status-chip";
import { LIST_FILTER } from "./list-controls";
import { PUBLIC_COMMUNITIES } from "./public-communities-mock";

type Overview = FunctionReturnType<typeof api.evidenceLibraries.queries.listLibraries>["page"][number];
type Invitation = FunctionReturnType<typeof api.evidenceLibraries.invitations.listInvitations>["page"][number];
type Role = "Owner" | "Editor" | "Creator" | "Viewer";
export type Community = {
  id: string;
  invitationId?: Id<"itemInvitations">;
  faviconUrl?: string | null;
  status?: "draft" | "setting_up" | "setup_failed" | "active" | "deleting";
  name: string;
  role: Role;
  address: string;
  pending?: boolean;
  draft?: boolean;
  deletionFailed?: boolean;
  configuration?: string;
  operation?: LibraryOperation | null;
};
const ROLES = { owner: "Owner", editor: "Editor", creator: "Creator", viewer: "Viewer" } as const;
const ROLE_KINDS = { Owner: "owner", Editor: "editor", Creator: "creator", Viewer: "view" } as const;

const fromOverview = (library: Overview): Community => ({
  id: library._id, name: library.name, role: ROLES[library.role], faviconUrl: library.faviconUrl,
  address: library.publicAddress.replace(/^https?:\/\//, ""), status: library.status, operation: library.operation,
  deletionFailed: Boolean(library.teardownFailedStep), draft: library.status !== "active",
  ...(library.role === "owner" || library.status !== "deleting" ? { configuration: `/evidence-communities/${library._id}/configuration` } : {}),
});
const fromInvitation = (invitation: Invitation): Community => ({
  id: invitation.libraryId, invitationId: invitation.invitationId, name: invitation.name, role: ROLES[invitation.role], address: "", pending: true,
});

/** Rows a section shows with the others beside it, and alone once the filter picks it. */
const ROWS_BESIDE = 4;
const ROWS_ALONE = 10;
/** A row's height, which a paged section keeps for every row of its page so the pager doesn't move. */
const ROW = "h-14";
const ROW_REM = 3.5;

type Answer = (community: Community) => void;
type Actions = { onAccept: Answer; onDecline: Answer; answering: string | null; notify: (text: string) => void };

/**
 * MOCK: the communities you can open, each workspace's in its own section, beside the public
 * ones. In your own workspace that's yours, each organization's you're in and the ones shared
 * with you, with their invitations; in an organization's, its own and the ones shared with it.
 */
export function YourCommunities({ search, personal, workspaceName, workspaceImage, organization, ...actions }: Actions & {
  search: string;
  personal: boolean;
  workspaceName: string;
  workspaceImage?: string;
  organization?: Id<"organizations">;
}) {
  const [filter, setFilter] = useState("all");
  const organizations = (useWorkspaces().list ?? []).filter((row): row is WorkspaceRow & { organizationId: Id<"organizations"> } => row.kind === "organization" && row.organizationId !== undefined);
  if (!personal) {
    return (
      <div className="flex flex-col">
        <OrganizationSection name={workspaceName} imageUrl={workspaceImage} organization={organization} search={search} actions={actions} />
        <SharedWithOrganization name={workspaceName} search={search} />
      </div>
    );
  }
  const beside = filter === "all";
  const shows = (key: string) => beside || filter === key;
  // With every workspace shown, a section shows its first rows and a way to the rest: the filter, set to it.
  const showAll = (key: string) => (beside ? () => setFilter(key) : undefined);
  return (
    <div className="group/col flex flex-col">
      <div className="p-3 pb-1">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger size="sm" aria-label="Show communities from" className={cn("w-full", LIST_FILTER)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><Layers />All workspaces</SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Workspaces</SelectLabel>
              <SelectItem value="own"><UserRound />Yours</SelectItem>
              {organizations.map((row) => <SelectItem key={row.workspaceId} value={row.workspaceId}><IdentityAvatar name={row.name} imageUrl={row.imageUrl} kind="organization" className="size-4 rounded-sm" />{row.name}</SelectItem>)}
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="shared"><Share2 />Shared with you</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <OwnAndShared search={search} beside={beside} own={shows("own")} shared={shows("shared")} showAll={showAll} actions={actions} />
      {/* Every section stays read while the filter hides it, so going back shows it at once. */}
      {organizations.map((row) => (
        <OrganizationSection key={row.workspaceId} name={row.name} imageUrl={row.imageUrl} organization={row.organizationId} search={search} shown={shows(row.workspaceId)} beside={beside} showAll={showAll(row.workspaceId)} actions={actions} />
      ))}
      {/* With every workspace shown, a section with nothing in it is left out; this says so once they're all read and none has any. */}
      {beside && (
        <p className="fade-enter px-5 py-3 text-xs text-muted-foreground group-has-[li]/col:hidden group-has-[[data-loading]]/col:hidden">
          {search ? "None of your communities match this search." : "Communities in your workspaces, and the ones shared with you, appear here."}
        </p>
      )}
    </div>
  );
}

/**
 * Your own workspace's communities and the ones shared with you. MOCK: both come from the one
 * list the server sends your own workspace today, split by role and paged here; the real
 * query takes which of the two to read.
 */
function OwnAndShared({ search, beside, own, shared, showAll, actions }: { search: string; beside: boolean; own: boolean; shared: boolean; showAll: (key: string) => (() => void) | undefined; actions: Actions }) {
  const read = useCursorPage(api.evidenceLibraries.queries.listLibraries, search ? { search } : {}, 50);
  const invitations = useProtectedQuery(api.evidenceLibraries.invitations.listInvitations, {});
  const needle = search.toLowerCase();
  const invited = (invitations.data?.page ?? []).filter((row) => `${row.name} ${row.organization.name}`.toLowerCase().includes(needle)).map(fromInvitation);
  const mine = read.items.filter((row) => row.role === "owner").map(fromOverview);
  const others = read.items.filter((row) => row.role !== "owner").map(fromOverview);
  const loading = read.isLoading || !invitations.data;
  const sharedList = [...invited, ...others];
  return (
    <>
      <Section title="Yours" loading={own && loading} hidden={!own || (beside && (loading || !mine.length))}>
        <LocalPages list={mine} loading={loading} stale={read.isStale} showAll={showAll("own")} empty="Communities you create appear here." actions={actions} />
      </Section>
      <Section title="Shared with you" loading={shared && loading} hidden={!shared || (beside && (loading || !sharedList.length))}>
        <LocalPages list={sharedList} loading={loading} stale={read.isStale} showAll={showAll("shared")} empty="Communities people share with you appear here." actions={actions} />
      </Section>
    </>
  );
}

/** One organization's communities, read a page at a time. The page size stays the same when the filter changes, so nothing is read again. */
function OrganizationSection({ name, imageUrl, organization, search, shown = true, beside = false, showAll, actions }: { name: string; imageUrl?: string; organization?: Id<"organizations">; search: string; shown?: boolean; beside?: boolean; showAll?: () => void; actions: Actions }) {
  const read = useCursorPage(api.evidenceLibraries.queries.listLibraries, organization ? { ...(search ? { search } : {}), organization } : "skip", ROWS_ALONE);
  const list = read.items.map(fromOverview);
  const body = read.isLoading ? <SectionLoading /> : !list.length ? <SectionEmpty>{search ? "None match this search." : `${name} has no communities yet.`}</SectionEmpty> : showAll ? (
    <>
      <Rows list={list.slice(0, ROWS_BESIDE)} rows={0} stale={read.isStale} actions={actions} />
      {(list.length > ROWS_BESIDE || read.hasPages) && <ShowAll onClick={showAll} />}
    </>
  ) : (
    <>
      <Rows list={list} rows={read.hasPages ? ROWS_ALONE : 0} stale={read.isStale} actions={actions} />
      {read.hasPages && <Pager from={read.offset + 1} to={read.offset + list.length} canPrevious={read.canPrevious} canNext={read.canNext} onPrevious={read.previous} onNext={read.next} />}
    </>
  );
  return <Section title={name} avatar={<IdentityAvatar name={name} imageUrl={imageUrl} kind="organization" className="size-4 rounded-sm" />} loading={shown && read.isLoading} hidden={!shown || (beside && (read.isLoading || !list.length))}>{body}</Section>;
}

/** A list the page already holds: its first rows and a way to the rest beside the others, a page at a time alone. */
function LocalPages({ list, loading, stale, empty, showAll, actions }: { list: Community[]; loading: boolean; stale: boolean; empty: string; showAll?: () => void; actions: Actions }) {
  const [page, setPage] = useState(0);
  if (loading) return <SectionLoading />;
  if (!list.length) return <SectionEmpty>{empty}</SectionEmpty>;
  if (showAll) {
    return (
      <>
        <Rows list={list.slice(0, ROWS_BESIDE)} rows={0} stale={stale} actions={actions} />
        {list.length > ROWS_BESIDE && <ShowAll onClick={showAll} />}
      </>
    );
  }
  const rows = ROWS_ALONE;
  const last = Math.ceil(list.length / rows) - 1;
  const at = Math.min(page, last);
  const shown = list.slice(at * rows, (at + 1) * rows);
  return (
    <>
      <Rows list={shown} rows={last > 0 ? rows : 0} stale={stale} actions={actions} />
      {last > 0 && <Pager from={at * rows + 1} to={at * rows + shown.length} total={list.length} canPrevious={at > 0} canNext={at < last} onPrevious={() => setPage(at - 1)} onNext={() => setPage(at + 1)} />}
    </>
  );
}

/**
 * A workspace's communities under its name. `hidden` leaves it out (with every workspace shown, one
 * still loading or with nothing in it) and slides the ones below up or down in place of moving them
 * in one frame; `loading` marks it for the column's empty line.
 */
function Section({ title, avatar, hidden = false, loading = false, children }: { title: string; avatar?: ReactNode; hidden?: boolean; loading?: boolean; children: ReactNode }) {
  return (
    <AutoHeight>
      {loading && <span data-loading hidden />}
      {!hidden && (
        <section aria-label={title} className="fade-enter px-3 py-2">
          <h3 className="flex items-center gap-2 px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
            {avatar}
            <span className="truncate">{title}</span>
          </h3>
          {/* A section that finds its rows, or finds none, slides to its height instead of moving the sections below in one frame. */}
          <AutoHeight>{children}</AutoHeight>
        </section>
      )}
    </AutoHeight>
  );
}

function SectionEmpty({ children }: { children: ReactNode }) {
  return <p className="fade-enter px-2 py-3 text-xs text-muted-foreground">{children}</p>;
}

/** A section's spinner, in one row's space; what it finds slides the section to its height. */
function SectionLoading() {
  return <div style={{ height: `${ROW_REM}rem` }} className="grid place-items-center"><Spinner aria-label="Loading communities" className="size-5 text-primary" /></div>;
}

/** The rows of one page; `rows` keeps the height of a full page when the section has more than one. */
function Rows({ list, rows, stale = false, actions }: { list: Community[]; rows: number; stale?: boolean; actions: Actions }) {
  return (
    <ul style={rows ? { minHeight: `${rows * ROW_REM}rem` } : undefined} className={cn(stale && "opacity-60")} inert={stale || undefined}>
      {list.map((community) => <CommunityRow key={community.invitationId ?? community.id} community={community} actions={actions} />)}
    </ul>
  );
}

/** The way from a section's first rows to all of them. */
function ShowAll({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" className="mt-1 w-full justify-between text-xs text-muted-foreground" onClick={onClick}>
      Show all
      <ChevronRight />
    </Button>
  );
}

function Pager({ from, to, total, canPrevious, canNext, onPrevious, onNext }: { from: number; to: number; total?: number; canPrevious: boolean; canNext: boolean; onPrevious: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 pt-1">
      <span className="text-xs tabular-nums text-muted-foreground">{total === undefined ? `${from} to ${to}` : `${from} to ${to} of ${total}`}</span>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={!canPrevious} onClick={onPrevious}><ChevronLeft /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={!canNext} onClick={onNext}><ChevronRight /></Button>
      </div>
    </div>
  );
}

/** A community with no icon of its own shows Openscholar's, as its page's header does. */
function Tile() {
  // The icon fades in where its place is held, as a country flag does, in place of appearing in one frame.
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-inset">
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's own icon */}
      <img
        ref={(image) => { if (image?.complete && image.naturalWidth > 0) setLoaded(true); }}
        src="/icon.svg"
        alt=""
        onLoad={() => setLoaded(true)}
        className={cn("size-4.5 object-contain transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}

/** One community: its name opens it, and everything else it offers is in its menu. */
function CommunityRow({ community, actions }: { community: Community; actions: Actions }) {
  const t = useTranslations("libraryList");
  const restartTeardown = useMutation(api.evidenceLibraries.teardown.restartDevelopmentTeardown);
  const [retrying, setRetrying] = useState(false);
  const live = !community.pending && !community.draft;
  const name = community.configuration
    ? <Link href={community.configuration} className="truncate text-sm font-medium hover:underline">{community.name}</Link>
    : <span className="truncate text-sm font-medium">{community.name}</span>;
  return (
    <li data-library-row={community.id} data-status={community.status} className={cn("fade-enter group/row flex items-center gap-3 rounded-lg px-2 hover:bg-muted", ROW)}>
      {community.faviconUrl ? <LibraryImage src={community.faviconUrl} className="flex size-9 shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-inset" imageClassName="size-full object-cover" fallback={<Tile />} /> : <Tile />}
      <div className="flex min-w-0 flex-1 flex-col">
        {name}
        <div className="flex min-w-0 items-center gap-2">
          <RoleLabel role={ROLE_KINDS[community.role]}>{community.pending ? "Invited as " + community.role.toLowerCase() : community.role}</RoleLabel>
          {!community.pending && community.status !== "active" && <LibraryStatusChip status={community.status ?? "active"} operation={community.operation} />}
        </div>
      </div>
      {community.pending ? (
        <div className="flex shrink-0 items-center gap-1">
          <IconAction label={t("declineInvitation")} disabled={actions.answering !== null} onClick={() => actions.onDecline(community)}><X /></IconAction>
          {/* A text button: it leaves the row once the invitation is answered, and a tooltip would go with it. */}
          <Button size="sm" disabled={actions.answering !== null} onClick={() => actions.onAccept(community)}><Check />Accept</Button>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label={t("moreActionsFor", { name: community.name })}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {community.configuration && (
              <DropdownMenuItem asChild>
                <Link href={community.draft && community.status !== "draft" && community.role === "Owner" && community.status !== "deleting" ? `/evidence-communities/${community.id}/setup` : community.configuration}>
                  <Settings2 />
                  {community.draft && community.status !== "draft" && community.status !== "deleting" ? t("viewSetup") : community.role === "Owner" ? t("configure") : t("settings")}
                </Link>
              </DropdownMenuItem>
            )}
            {live && community.role !== "Viewer" && (
              <DropdownMenuItem asChild>
                <AdminAreaLink address={`https://${community.address}`}><ExternalLink />{t("openAdmin")}</AdminAreaLink>
              </DropdownMenuItem>
            )}
            {live && (
              <DropdownMenuItem asChild>
                <a href={`https://${community.address}`} target="_blank" rel="noopener noreferrer"><ExternalLink />{t("viewPublicLibrary")}</a>
              </DropdownMenuItem>
            )}
            {community.status === "deleting" && community.deletionFailed && community.role === "Owner" && (
              <DropdownMenuItem disabled={retrying} onSelect={async () => {
                setRetrying(true);
                try { await restartTeardown({ libraryId: community.id as Id<"evidenceLibraries"> }); actions.notify(t("deletionRestartedFor", { name: community.name })); }
                catch (error) { actions.notify(getErrorMessage(error, t("couldNotRestartDeletion"))); }
                finally { setRetrying(false); }
              }}><RotateCcw />{t("retryDeletion")}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function IconAction({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="outline" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * MOCK: what's shared with an organization (option B), with a sample invitation its admins
 * answer for it. Accepting gives every member the role; nothing is saved.
 */
function SharedWithOrganization({ name, search }: { name: string; search: string }) {
  const sample = PUBLIC_COMMUNITIES.find((row) => row.id === "p13")!;
  const [state, setState] = useState<"invited" | "accepted" | "declined">("invited");
  const community: Community = { id: sample.id, name: sample.name, faviconUrl: sample.faviconUrl, role: "Editor", address: sample.address, status: "active", pending: state === "invited", draft: false };
  const shown = state !== "declined" && sample.name.toLowerCase().includes(search.toLowerCase());
  const answer = (accept: boolean) => setState(accept ? "accepted" : "declined");
  return (
    <Section title={`Shared with ${name}`}>
      {shown ? (
        <ul>
          <CommunityRow community={community} actions={{ answering: null, onAccept: () => answer(true), onDecline: () => answer(false), notify: () => {} }} />
        </ul>
      ) : <SectionEmpty>Communities shared with {name} appear here.</SectionEmpty>}
    </Section>
  );
}
