"use client";

import { useAction, useMutation, type Preloaded } from "convex/react";
import { OrganizationAvatar, useLibraryOrganizationChoice } from "./organization-picker";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { AdminAreaLink } from "./admin-area-link";
import { useState } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import Link from "next/link";
import {
  Building2,
  Check,
  Crown,
  ExternalLink,
  Layers,
  Mail,
  PenLine,
  Plus,
  Settings2,
  MoreHorizontal,
  ShieldCheck,
  RotateCcw,
  SearchX,
  EvidenceLibrariesIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ButtonGroup } from "@/components/ui/button-group";
import { LibraryAddressLink } from "./library-address-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LibraryPageShell } from "./library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "./configuration/panel-header";
import { LIST_FILTER, LIST_TILE, ListEmpty, ListLoading, ListSearch, ListViewTabs } from "./list-controls";
import { LibraryStatusChip, type LibraryOperation } from "./library-status-chip";
import { LibraryImage } from "./library-image";

type Role = "Owner" | "Editor" | "Creator";
type Library = {
  id: string;
  invitationId?: Id<"evidenceLibraryInvitations">;
  organizationImageUrl?: string | null;
  faviconUrl?: string | null;
  status?: "draft" | "setting_up" | "setup_failed" | "active" | "deleting";
  name: string;
  organization: string;
  role: Role;
  address: string;
  pending?: boolean;
  draft?: boolean;
  deletionFailed?: boolean;
  configuration?: string;
  /** The update or publish a live library is running. */
  operation?: LibraryOperation | null;
};
const roleIcons = { Owner: Crown, Editor: ShieldCheck, Creator: PenLine };
function LibraryTile() {
  return (
    <div className={LIST_TILE}>
      <EvidenceLibrariesIcon className="size-5" />
    </div>
  );
}

/**
 * `pending` renders the page before access is confirmed: the frame and
 * toolbar show at once and only the list waits.
 */
export function LibraryList({ pending = false, preloadedOrganizations }: {
  pending?: boolean;
  preloadedOrganizations?: Preloaded<typeof api.organizationFeatures.listLibraryOrganizations>;
}) {
  const owner = useLibraryOrganizationChoice(preloadedOrganizations);
  const [view, setView] = useQueryState("view", parseAsStringLiteral(["libraries", "invitations"]).withDefault("libraries"));
  const [organization, setOrganization] = useState("all");
  const [search, setSearch] = useState("");
  const text = useDebouncedValue(search.trim(), 300);
  // The libraries are read a page at a time, filtered on the server; the organizations they belong to name the filter.
  const owners = useProtectedQuery(api.evidenceLibraries.queries.listLibraryOwners, pending ? "skip" : {});
  const overviews = useCursorPage(
    api.evidenceLibraries.queries.listLibraries,
    pending ? "skip" : { ...(text ? { search: text } : {}), ...(organization !== "all" ? { organization: organization as Id<"organizations"> } : {}) },
    COMMAND_CENTER_ITEMS_PER_PAGE,
  );
  const libraryCount = useProtectedQuery(api.evidenceLibraries.queries.countLibraries, pending ? "skip" : {});
  const invitations = useProtectedQuery(api.evidenceLibraries.invitations.listInvitations, pending ? "skip" : {});
  const respond = useAction(api.evidenceLibraries.invitationActions.respond);
  const restartTeardown = useMutation(api.evidenceLibraries.teardown.restartDevelopmentTeardown);
  const [retrying, setRetrying] = useState<string | null>(null);
  const roles = { owner: "Owner", editor: "Editor", creator: "Creator" } as const;
  // The filter offers the organizations of the libraries and of the invitations, each once.
  const organizations = [...new Map([...(owners.data?.page ?? []), ...(invitations.data?.page ?? []).map((invitation) => invitation.organization)].map((entry) => [entry.id, entry])).values()].sort((a, b) => a.name.localeCompare(b.name));
  // An address has at most a page of invitations waiting, so they are filtered here.
  const invited = (invitations.data?.page ?? []).filter(
    (invitation) =>
      (organization === "all" || invitation.organization.id === organization) &&
      `${invitation.name} ${invitation.organization.name}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const visible: Library[] = view === "libraries"
    ? overviews.items.map(library => ({ id: library._id, name: library.name, role: roles[library.role], organization: library.organization.name, organizationImageUrl: library.organization.imageUrl, faviconUrl: library.faviconUrl, address: library.publicAddress.replace(/^https?:\/\//, ""), status: library.status, operation: library.operation, deletionFailed: Boolean(library.teardownFailedStep), draft: library.status !== "active", ...(library.role === "owner" ? { configuration: `/evidence-libraries/${library._id}/configuration` } : {}) }))
    : invited.map(invitation => ({ id: invitation.libraryId, invitationId: invitation.invitationId, name: invitation.name, role: roles[invitation.role], organization: invitation.organization.name, organizationImageUrl: invitation.organization.imageUrl, address: "", pending: true }));
  const [notice, setNotice] = useState("");
  const [declining, setDeclining] = useState<Library | null>(null);
  const filtered = Boolean(text) || organization !== "all";
  const loading = overviews.isLoading || !invitations.data || !owners.data || libraryCount.data === undefined || !owner.isReady;
  return (
    <LibraryPageShell
      title="Evidence libraries"
      actions={owner.organizations.length > 0 &&
        <Button asChild size="sm" className={BAR_ACTION}>
          <Link href="/evidence-libraries/new">
            <Plus />
            <span className={BAR_LABEL}>New library</span>
          </Link>
        </Button>
      }
      tabs={
        <ListViewTabs
          label="Library view"
          value={view}
          onChange={setView}
          tabs={(["libraries", "invitations"] as const).map((tab) => ({
            value: tab,
            label: tab === "libraries" ? "Your libraries" : "Invitations",
            icon: tab === "libraries" ? <Layers className="size-3.5" /> : <Mail className="size-3.5" />,
            count: loading ? undefined : tab === "libraries" ? libraryCount.data : invitations.data?.page.length,
          }))}
        />
      }
      filters={<>
        <ListSearch
          aria-label="Search libraries"
          placeholder="Find a library…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={organization} onValueChange={setOrganization}>
          <SelectTrigger
            size="sm"
            aria-label="Filter by owning organization"
            className={cn("w-48", LIST_FILTER)}
          >
            {organization === "all" && <Building2 className="size-3.5" />}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All organizations</SelectItem>
            {organizations.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                <OrganizationAvatar name={org.name} imageUrl={org.imageUrl} />
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </>}
    >
      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 border-b border-border-subtle bg-inset px-4 py-3 text-xs text-muted-foreground"
        >
          <Check className="size-3.5" />
          {notice}
        </p>
      )}
      {/* Keyed by tab, so switching fades the new list in instead of jumping. */}
      <div key={view} className="fade-enter">
        {view === "invitations" && (
          <p className="border-b border-border-subtle px-4 py-3 text-xs text-muted-foreground">
            Accept access to a library without joining its organization.
          </p>
        )}
        {loading ? (
          <ListLoading label="Loading libraries" />
        ) : !visible.length ? (
          <ListEmpty icon={search || organization !== "all" ? SearchX : view === "invitations" ? Mail : Layers}>
              {search || organization !== "all"
                ? "No libraries match these filters."
                : view === "invitations"
                  ? "No pending invitations."
                  : "Your libraries will appear here when you receive access."}
          </ListEmpty>
        ) : (
          // The page shown stays up, dimmed and inert, while the one it steps or filters to loads.
          <ul
            // A paged list keeps a full page of rows with their addresses, so a short last page, or a page of shorter rows, doesn't move the pager: 75px a row with its divider where it sits on one line, 119px on a phone, where its actions take a second.
            className={cn("divide-y divide-border-subtle", view === "libraries" && overviews.hasPages && "min-h-[1427px] sm:min-h-[899px]", view === "libraries" && overviews.isStale && "opacity-60")}
            inert={(view === "libraries" && overviews.isStale) || undefined}
            data-library-list
          >
            {visible.map((library) => {
              const RoleIcon = roleIcons[library.role];
              return (
                <li
                  key={library.id}
                  data-library-row={library.id}
                  data-status={library.status}
                  className="fade-enter flex flex-wrap items-center gap-3 p-4 hover:bg-muted sm:flex-nowrap"
                >
                  <div className="relative mr-1 shrink-0">
                    {library.faviconUrl ? (
                      <LibraryImage
                        src={library.faviconUrl}
                        className={LIST_TILE}
                        imageClassName="size-full object-cover"
                        fallback={<LibraryTile />}
                      />
                    ) : (
                      <LibraryTile />
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Organization: ${library.organization}`}
                          className="absolute -bottom-1 -right-1 rounded-md bg-background ring-2 ring-background outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <OrganizationAvatar name={library.organization} imageUrl={library.organizationImageUrl} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{library.organization}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {library.pending || library.draft ? (
                        library.configuration ? <Link href={library.configuration} className="text-sm font-medium">
                          {library.name}
                        </Link> : <span className="text-sm font-medium">{library.name}</span>
                      ) : library.configuration ? (
                        <Link
                          href={library.configuration}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {library.name}
                        </Link>
                      ) : (
                        <AdminAreaLink
                          address={`https://${library.address}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {library.name}
                        </AdminAreaLink>
                      )}
                      {!library.pending && (
                        <LibraryStatusChip
                          status={library.status ?? "active"}
                          operation={library.operation}
                        />
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <RoleIcon className="size-3.5" />
                            {library.role}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {library.role === "Owner"
                            ? "Inherited from organization ownership"
                            : "Assigned to this library"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {library.address && (
                        <LibraryAddressLink
                          address={`https://${library.address}`}
                          className="max-w-full [&_button]:size-5"
                        />
                      )}
                    </div>
                  </div>
                  {/* On phones the actions take their own line under the name, lined up with it, so the name keeps the row's width. */}
                  <div className="flex w-full shrink-0 items-center gap-2 pl-14 sm:ml-auto sm:w-auto sm:pl-0">
                    {library.pending ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeclining(library)}
                        >
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (!library.invitationId) return;
                            try {
                              await respond({ invitationId: library.invitationId, accept: true });
                              setNotice(`Accepted ${library.name}.`);
                              setView("libraries");
                            } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to accept invitation"); }
                          }}
                        >
                          <Check />
                          Accept invitation
                        </Button>
                      </>
                    ) : library.draft ? (
                      library.role !== "Owner" || (library.status === "deleting" && !library.deletionFailed) ? (
                        <span className="text-xs text-muted-foreground">{library.status === "deleting" ? "Deleting" : "Setup pending"}</span>
                      ) : library.status === "deleting" ? (
                        <Button size="sm" variant="outline" disabled={retrying === library.id} onClick={async () => {
                          setRetrying(library.id);
                          try { await restartTeardown({libraryId: library.id as Id<"evidenceLibraries">}); setNotice(`Deletion restarted for ${library.name}.`); }
                          catch (error) { setNotice(error instanceof Error ? error.message : "Could not restart deletion"); }
                          finally { setRetrying(null); }
                        }}><RotateCcw />Retry deletion</Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={library.status === "draft" ? library.configuration! : `/evidence-libraries/${library.id}/setup`}>
                            <Settings2 />{library.status === "draft" ? "Configure" : "View setup"}
                          </Link>
                        </Button>
                      )
                    ) : (
                      <ButtonGroup aria-label={`Actions for ${library.name}`}>
                        {library.configuration && (
                          <Button asChild size="sm" variant="outline">
                            <Link href={library.configuration}>
                              <Settings2 />
                              Configure
                            </Link>
                          </Button>
                        )}
                        <Button asChild size="sm" variant="outline">
                          <AdminAreaLink address={`https://${library.address}`}>
                            <ExternalLink />
                            Open admin
                          </AdminAreaLink>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="outline"
                              aria-label={`More actions for ${library.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <a
                                href={`https://${library.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink />
                                View public library
                              </a>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ButtonGroup>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {view === "libraries" && !loading && overviews.hasPages && (
          <div className="border-t border-border-subtle px-4 pb-4">
            <CommandCenterPagination
              currentPage={overviews.page}
              itemLabel="libraries"
              steps={{
                canPrevious: overviews.canPrevious,
                canNext: overviews.canNext,
                onPrevious: overviews.previous,
                onNext: overviews.next,
                offset: overviews.offset,
                shown: overviews.items.length,
                // A search's or an organization's matches aren't counted, so its pager shows the page alone.
                total: filtered ? undefined : libraryCount.data,
                pageCount: filtered || libraryCount.data === undefined ? undefined : Math.max(1, Math.ceil(libraryCount.data / COMMAND_CENTER_ITEMS_PER_PAGE)),
              }}
            />
          </div>
        )}
      </div>
      <Dialog
        open={Boolean(declining)}
        onOpenChange={(open) => {
          if (!open) setDeclining(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Decline invitation?</DialogTitle>
            <DialogDescription>
              You won’t receive access to {declining?.name}. Your other
              libraries are unaffected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep invitation</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!declining?.invitationId) return;
                try {
                  await respond({ invitationId: declining.invitationId, accept: false });
                  setDeclining(null);
                  setNotice("Invitation declined.");
                } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to decline invitation"); }
              }}
            >
              Decline invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LibraryPageShell>
  );
}
