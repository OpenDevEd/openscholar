"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { RoleLabel } from "@/components/ui/identity";
import { useMutation, useQueries } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import Link from "@/components/workspace-link";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useWorkspaces, type WorkspaceRow } from "@/components/workspaces/parts";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { Check, ExternalLink, Layers, MoreHorizontal, RotateCcw, Settings2, Share2, UserRound, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { Spinner } from "@/components/ui/spinner";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageStepper } from "@/components/shared/page-stepper";
import { AdminAreaLink } from "./admin-area-link";
import { LibraryImage } from "./library-image";
import { LibraryStatusIcon, type LibraryOperation } from "./library-status-chip";
import { PUBLIC_COMMUNITIES } from "./public-communities-mock";

type Overview = FunctionReturnType<typeof api.evidenceLibraries.queries.listLibraries>["page"][number];
type Invitation = FunctionReturnType<typeof api.evidenceLibraries.invitations.listInvitations>["page"][number];
type Role = "Owner" | "Editor" | "Creator" | "Viewer";
/** Where a community is listed from: your own workspace, an organization's, or someone else's that shares it. */
type Source = { key: string; kind: "own" | "organization" | "shared"; name: string; imageUrl?: string | null; avatar: "person" | "organization" };
export type Community = {
  id: string;
  invitationId?: Id<"itemInvitations">;
  faviconUrl?: string | null;
  status?: "draft" | "setting_up" | "setup_failed" | "active" | "deleting";
  name: string;
  role: Role;
  address: string;
  from: Source;
  pending?: boolean;
  draft?: boolean;
  deletionFailed?: boolean;
  configuration?: string;
  operation?: LibraryOperation | null;
};
const ROLES = { owner: "Owner", editor: "Editor", creator: "Creator", viewer: "Viewer" } as const;
const ROLE_KINDS = { Owner: "owner", Editor: "editor", Creator: "creator", Viewer: "view" } as const;

const fromOverview = (library: Overview, from: Source): Community => ({
  id: library._id, name: library.name, role: ROLES[library.role], faviconUrl: library.faviconUrl, from,
  address: library.publicAddress.replace(/^https?:\/\//, ""), status: library.status, operation: library.operation,
  deletionFailed: Boolean(library.teardownFailedStep), draft: library.status !== "active",
  ...(library.role === "owner" || library.status !== "deleting" ? { configuration: `/evidence-communities/${library._id}/configuration` } : {}),
});
const fromInvitation = (invitation: Invitation): Community => ({
  id: invitation.libraryId, invitationId: invitation.invitationId, name: invitation.name, role: ROLES[invitation.role], address: "", pending: true,
  from: { key: "shared", kind: "shared", name: invitation.organization.name, imageUrl: invitation.organization.imageUrl, avatar: "organization" },
});

const PER_PAGE = 100;
/** A row's height, which every row of a page keeps, so a short last page doesn't move the pager. */
const ROW_REM = 3;
/** MOCK: every source's first rows, merged and paged here; the real query pages them all with one cursor. */
const READ = 50;

type Answer = (community: Community) => void;
type Actions = { onAccept: Answer; onDecline: Answer; answering: string | null; notify: (text: string) => void };
type Organization = WorkspaceRow & { organizationId: Id<"organizations"> };

/**
 * MOCK: every community you can open, in one list a page at a time, with a filter for where
 * it's from. In your own workspace that's yours, each organization's you're in and the ones
 * shared with you, with their invitations; in an organization's, its own and the ones shared with it.
 */
export function YourCommunities({ search, personal, workspaceName, workspaceImage, organization, filter, onFilter, ...actions }: Actions & {
  search: string;
  personal: boolean;
  workspaceName: string;
  workspaceImage?: string;
  organization?: Id<"organizations">;
  filter: string;
  onFilter: (filter: string) => void;
}) {
  const workspaces = useWorkspaces().list ?? [];
  const organizations = workspaces.filter((row): row is Organization => row.kind === "organization" && row.organizationId !== undefined);
  const photo = workspaces.find((row) => row.kind === "personal")?.imageUrl;
  const read = useEverything({ search, personal, organizations, organization, workspaceName, workspaceImage, photo });
  const list = read.list.filter((row) => filter === "all" || row.from.key === filter);
  // A new filter or search starts at the first page.
  const pageKey = `${filter}\n${search}`;
  const [paging, setPaging] = useState({ key: pageKey, page: 0 });
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const page = Math.min(paging.key === pageKey ? paging.page : 0, pages - 1);
  const shown = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const step = (to: number) => setPaging({ key: pageKey, page: to });
  const shared = personal ? "Shared with you" : `Shared with ${workspaceName}`;
  const own = personal ? "Yours" : workspaceName;
  const filterName = filter === "all" ? null : filter === "shared" ? shared : filter === "own" || filter === "here" ? own : organizations.find((row) => row.workspaceId === filter)?.name ?? "";
  const empty = search ? "None of these match this search."
    : filter === "all" ? (personal ? "Communities in your workspaces, and the ones shared with you, appear here." : `Communities ${workspaceName} owns, and the ones shared with it, appear here.`)
    : filter === "shared" ? (personal ? "Communities people share with you appear here." : `Communities shared with ${workspaceName} appear here.`)
    : filter === "own" ? "Communities you create appear here."
    : `${filterName} has no communities yet.`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* As tall as the page's bar, with its bottom line, so the bar reads as running on under the sidebar. */}
      <div className="box-content flex h-16 shrink-0 items-center border-b border-sidebar-border px-3">
        <Select value={filter} onValueChange={onFilter}>
          <SelectTrigger aria-label="Show communities from" className="w-full border-transparent bg-transparent font-medium shadow-none hover:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><Layers />{personal ? "All workspaces" : "All communities"}</SelectItem>
            <SelectSeparator />
            {personal ? (
              <SelectGroup>
                <SelectLabel>Workspaces</SelectLabel>
                <SelectItem value="own"><UserRound />Yours</SelectItem>
                {organizations.map((row) => <SelectItem key={row.workspaceId} value={row.workspaceId}><IdentityAvatar name={row.name} imageUrl={row.imageUrl} kind="organization" className="size-4 rounded-sm" />{row.name}</SelectItem>)}
              </SelectGroup>
            ) : (
              <SelectItem value="here"><IdentityAvatar name={workspaceName} imageUrl={workspaceImage} kind="organization" className="size-4 rounded-sm" />{workspaceName}</SelectItem>
            )}
            <SelectSeparator />
            <SelectItem value="shared"><Share2 />{shared}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-hide">
        {/* The list arrives after the page, and changes length with the filter: it slides to its height. */}
        <AutoHeight>
          {read.loading ? (
            <div style={{ height: `${ROW_REM}rem` }} className="grid place-items-center"><Spinner aria-label="Loading communities" className="size-5 text-primary" /></div>
          ) : shown.length ? (
            <ul
              style={pages > 1 ? { minHeight: `${PER_PAGE * ROW_REM}rem` } : undefined}
              className={cn(read.stale && "opacity-60")}
              inert={read.stale || undefined}
            >
              {shown.map((community) => <CommunityRow key={community.invitationId ?? community.id} community={community} actions={read.answer(community, actions)} />)}
            </ul>
          ) : (
            <p className="fade-enter px-2 py-3 text-xs text-muted-foreground">{empty}</p>
          )}
          {!read.loading && pages > 1 && (
            <PageStepper className="px-2 pt-2" page={page + 1} pageCount={pages} canPrevious={page > 0} canNext={page < pages - 1} onPrevious={() => step(page - 1)} onNext={() => step(page + 1)} />
          )}
        </AutoHeight>
      </div>
    </div>
  );
}

/**
 * Every community the workspace can open, invitations first, then by name. While a new search is
 * read the last list stays up, dimmed. MOCK: an organization's shared communities are a sample
 * invitation held here; accepting or declining it saves nothing.
 */
function useEverything({ search, personal, organizations, organization, workspaceName, workspaceImage, photo }: { search: string; personal: boolean; organizations: Organization[]; organization?: Id<"organizations">; workspaceName: string; workspaceImage?: string; photo?: string }) {
  const { canRunProtectedQueries } = useAuthReadiness();
  const sources = personal
    ? [{ key: "own" }, ...organizations.map((row) => ({ key: row.workspaceId as string, organization: row.organizationId as string }))]
    : organization ? [{ key: "here", organization: organization as string }] : [];
  // useQueries subscribes again whenever its request object changes, so it changes only with what's read.
  const signature = JSON.stringify([sources, search, canRunProtectedQueries]);
  const requests = useMemo(() => {
    const [wanted, needle, run] = JSON.parse(signature) as [Array<{ key: string; organization?: Id<"organizations"> }>, string, boolean];
    if (!run) return {};
    return Object.fromEntries(wanted.map((source) => [source.key, {
      query: api.evidenceLibraries.queries.listLibraries,
      args: { paginationOpts: { numItems: READ, cursor: null }, ...(needle ? { search: needle } : {}), ...(source.organization ? { organization: source.organization } : {}) },
    }]));
  }, [signature]);
  const results = useQueries(requests) as Record<string, { page: Overview[] } | Error | undefined>;
  const invitations = useProtectedQuery(api.evidenceLibraries.invitations.listInvitations, personal ? {} : "skip");
  const [sample, setSample] = useState<"invited" | "accepted" | "declined">("invited");

  const rows = (key: string) => { const result = results[key]; return result && !(result instanceof Error) ? result.page : []; };
  const loading = !canRunProtectedQueries || sources.some((source) => results[source.key] === undefined) || (personal && !invitations.data);
  const needle = search.toLowerCase();
  const list: Community[] = [];
  if (personal) {
    list.push(...(invitations.data?.page ?? []).filter((row) => `${row.name} ${row.organization.name}`.toLowerCase().includes(needle)).map(fromInvitation));
    for (const row of rows("own")) list.push(fromOverview(row, row.role === "owner" ? { key: "own", kind: "own", name: "Yours", imageUrl: photo, avatar: "person" } : { key: "shared", kind: "shared", name: row.organization.name, imageUrl: row.organization.imageUrl, avatar: "organization" }));
    for (const org of organizations) for (const row of rows(org.workspaceId)) list.push(fromOverview(row, { key: org.workspaceId, kind: "organization", name: org.name, imageUrl: org.imageUrl, avatar: "organization" }));
  } else {
    const example = PUBLIC_COMMUNITIES.find((row) => row.id === "p13")!;
    if (sample !== "declined" && example.name.toLowerCase().includes(needle)) {
      list.push({ id: example.id, name: example.name, faviconUrl: example.faviconUrl, role: "Editor", address: example.address, status: "active", pending: sample === "invited", draft: false, from: { key: "shared", kind: "shared", name: example.owner.name, avatar: example.owner.kind } });
    }
    for (const row of rows("here")) list.push(fromOverview(row, { key: "here", kind: "organization", name: workspaceName, imageUrl: workspaceImage, avatar: "organization" }));
  }
  // MOCK: sample rows shared with you, so the list is long enough to page.
  if (personal) list.push(...SAMPLE_SHARED.filter((row) => row.name.toLowerCase().includes(needle)));
  list.sort((a, b) => Number(Boolean(b.pending)) - Number(Boolean(a.pending)) || a.name.localeCompare(b.name));

  const [kept, keep] = useState<{ key: string; list: Community[] } | null>(null);
  if (!loading && kept?.key !== signature) keep({ key: signature, list });
  const stale = loading && kept !== null;
  // The sample answers itself; every other row's answer goes to the page.
  const answer = (community: Community, actions: Actions): Actions => community.id === "p13" && !personal
    ? { answering: null, onAccept: () => setSample("accepted"), onDecline: () => setSample("declined"), notify: actions.notify }
    : actions;
  return { list: stale && kept ? kept.list : list, loading: loading && !stale, stale, answer };
}

/** MOCK: a state for some of the samples, so every one the list shows is there to see. */
const operation = (stage: string, update: boolean) => ({ stage, runtimeUpdate: update ? {} : null }) as unknown as LibraryOperation;
const SAMPLE_STATES: Partial<Record<number, { status?: Community["status"]; operation?: LibraryOperation }>> = {
  1: { status: "setting_up" },
  3: { status: "setup_failed" },
  5: { status: "deleting" },
  6: { operation: operation("running", true) },
  8: { operation: operation("running", false) },
  9: { operation: operation("queued", false) },
};

/** MOCK: communities other people share with you, from the public samples, with a role each. */
const SAMPLE_SHARED: Community[] = PUBLIC_COMMUNITIES.slice(0, 10).map((row, at): Community => {
  const state = SAMPLE_STATES[at] ?? {};
  return {
    id: `sample-${row.id}`, name: row.name, faviconUrl: row.faviconUrl, address: row.address, status: state.status ?? "active", draft: (state.status ?? "active") !== "active",
    operation: state.operation ?? null,
    role: (["Editor", "Viewer", "Creator", "Viewer", "Editor"] as const)[at % 5],
    from: { key: "shared", kind: "shared", name: row.owner.name, avatar: row.owner.kind },
  };
});

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

/** The community's icon, with where it's from on its corner: the organization's logo, your photo, or the owner's for one shared with you. */
function CommunityIcon({ community }: { community: Community }) {
  const { from } = community;
  return (
    <div className="relative shrink-0">
      {community.faviconUrl ? <LibraryImage src={community.faviconUrl} className="flex size-8 overflow-hidden rounded-lg bg-inset" imageClassName="size-full object-cover" fallback={<Tile />} /> : <Tile />}
      <IdentityAvatar
        name={from.name}
        imageUrl={from.imageUrl}
        kind={from.avatar}
        className={cn("absolute -bottom-1 -end-1 size-4 bg-background ring-2 ring-background transition-shadow group-hover/row:ring-muted group-has-[[data-state=open]]/row:ring-muted", from.avatar === "organization" && "rounded-[0.3rem]")}
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
  // The whole row opens it: the name's link covers the row, under the buttons.
  const name = community.configuration
    ? <Link href={community.configuration} className="truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">{community.name}</Link>
    : live ? <a href={`https://${community.address}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">{community.name}</a>
    : <span className="truncate text-sm font-medium">{community.name}</span>;
  // Every community but an invitation shows its state as an icon before its name, its word on hover, as the list always has.
  const status = community.pending ? null : community.status ?? "active";
  return (
    <li data-library-row={community.id} data-status={community.status} style={{ height: `${ROW_REM}rem` }} className="fade-enter group/row relative flex items-center gap-3 rounded-lg px-2 transition-colors hover:bg-muted has-[[data-state=open]]:bg-muted">
      <CommunityIcon community={community} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          {status && <LibraryStatusIcon status={status} operation={community.operation} className="relative z-10 [&>svg]:size-3.5" />}
          {name}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <RoleLabel role={ROLE_KINDS[community.role]}>{community.pending ? `Invited as ${community.role.toLowerCase()}` : community.role}</RoleLabel>
        </span>
      </div>
      {community.pending ? (
        <div className="relative flex shrink-0 items-center gap-1">
          <IconAction label={t("declineInvitation")} disabled={actions.answering !== null} onClick={() => actions.onDecline(community)}><X /></IconAction>
          {/* A text button: it leaves the row once the invitation is answered, and a tooltip would go with it. */}
          <Button size="sm" className="h-7 px-2.5" disabled={actions.answering !== null} onClick={() => actions.onAccept(community)}><Check />Accept</Button>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="absolute end-1.5 top-1/2 -translate-y-1/2 bg-muted opacity-0 hover:bg-inset group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:translate-y-0 [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100" aria-label={t("moreActionsFor", { name: community.name })}><MoreHorizontal /></Button>
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
        <Button size="icon-sm" variant="ghost" className="size-7" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
