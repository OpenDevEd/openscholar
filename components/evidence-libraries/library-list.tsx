"use client";

import { useTranslations } from "next-intl";
import { useAction, useMutation, type Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import { OrganizationAvatar } from "./organization-picker";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { useCurrentWorkspace } from "@/components/workspaces/parts";
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
import Link from "@/components/workspace-link";
import {
  Check,
  ExternalLink,
  Layers,
  Mail,
  Plus,
  Settings2,
  MoreHorizontal,
  RotateCcw,
  SearchX,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { RoleLabel } from "@/components/ui/identity";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { LibraryPageShell } from "./library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "./configuration/panel-header";
import { LIST_TILE, ListEmpty, ListLoading, ListSearch, ListViewTabs } from "./list-controls";
import { LibraryStatusChip, type LibraryOperation } from "./library-status-chip";
import { LibraryImage } from "./library-image";

/** A viewer is any other member of the library's organization (#653): they see it here, and have no role in its admin. */
type Role = "Owner" | "Editor" | "Creator" | "Viewer";
type Library = {
  id: string;
  invitationId?: Id<"itemInvitations">;
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
const roleKinds = { Owner: "owner", Editor: "editor", Creator: "creator", Viewer: "view" } as const;
/** A library with no icon of its own shows OpenScholar's, as its page's header does. */
function LibraryTile() {
  return (
    <div className={LIST_TILE}>
      <img src="/icon.svg" alt="" className="size-5 object-contain" />
    </div>
  );
}

/**
 * Every workspace's communities. `preloadedOpens` is the server's answer to whether the person may
 * create one here, so New community is there from the first frame.
 */
export function LibraryList({ preloadedOpens }: {
  preloadedOpens?: Preloaded<typeof api.organizationFeatures.opens>;
}) {
  const tLabels = useTranslations("libraryList");
  const t = useTranslations("libraryList");
  const live = useWorkspaceFeatures().data;
  const creates = (live ?? (preloadedOpens ? preloadedQueryResult(preloadedOpens) : undefined))?.createsCommunities === true;
  const [tab, setView] = useQueryState("view", parseAsStringLiteral(["libraries", "invitations"]).withDefault("libraries"));
  const [search, setSearch] = useState("");
  const text = useDebouncedValue(search.trim(), 300);
  // The workspace you're in is the list (#651): an organization lists its own libraries, your own
  // workspace yours and the ones shared with you, with their invitations.
  const workspace = useCurrentWorkspace();
  const personal = workspace?.kind === "personal";
  const organization = workspace?.organizationId;
  const view = personal ? tab : "libraries";
  // The libraries are read a page at a time, filtered on the server.
  const overviews = useCursorPage(
    api.evidenceLibraries.queries.listLibraries,
    !workspace ? "skip" : { ...(text ? { search: text } : {}), ...(organization ? { organization } : {}) },
    COMMAND_CENTER_ITEMS_PER_PAGE,
  );
  const invitations = useProtectedQuery(api.evidenceLibraries.invitations.listInvitations, {});
  const respond = useAction(api.evidenceLibraries.invitationActions.respond);
  const restartTeardown = useMutation(api.evidenceLibraries.teardown.restartDevelopmentTeardown);
  const [retrying, setRetrying] = useState<string | null>(null);
  // The invitation being answered: while its answer is on its way, no invitation takes another.
  const [answering, setAnswering] = useState<string | null>(null);
  const roles = { owner: "Owner", editor: "Editor", creator: "Creator", viewer: "Viewer" } as const;
  const roleNames = { Owner: tLabels("owner"), Editor: tLabels("editor"), Creator: tLabels("creator"), Viewer: tLabels("viewer") } as const;
  // An address has at most a page of invitations waiting, so they are filtered here.
  const invited = (invitations.data?.page ?? []).filter((invitation) => `${invitation.name} ${invitation.organization.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const visible: Library[] = view === "libraries"
    ? overviews.items.map(library => ({ id: library._id, name: library.name, role: roles[library.role], organization: library.organization.name, organizationImageUrl: library.organization.imageUrl, faviconUrl: library.faviconUrl, address: library.publicAddress.replace(/^https?:\/\//, ""), status: library.status, operation: library.operation, deletionFailed: Boolean(library.teardownFailedStep), draft: library.status !== "active", ...(library.role === "owner" || library.status !== "deleting" ? { configuration: `/evidence-communities/${library._id}/configuration` } : {}) }))
    : invited.map(invitation => ({ id: invitation.libraryId, invitationId: invitation.invitationId, name: invitation.name, role: roles[invitation.role], organization: invitation.organization.name, organizationImageUrl: invitation.organization.imageUrl, address: "", pending: true }));
  const [notice, setNotice] = useState("");
  const [declining, setDeclining] = useState<Library | null>(null);
  const loading = !workspace || overviews.isLoading || !invitations.data;
  return (
    <LibraryPageShell
      title={t("evidenceLibraries")}
      actions={creates &&
        <Button asChild size="sm" className={BAR_ACTION}>
          <Link href="/evidence-communities/new">
            <Plus />
            <span className={BAR_LABEL}>{t("newLibrary")}</span>
          </Link>
        </Button>
      }
      // Invitations to a library are yours, so they're in your own workspace.
      tabs={personal &&
        <ListViewTabs
          label={t("libraryView")}
          value={view}
          onChange={setView}
          tabs={(["libraries", "invitations"] as const).map((each) => ({
            value: each,
            label: each === "libraries" ? t("sharedWithYou") : t("invitations"),
            icon: each === "libraries" ? <Layers className="size-3.5" /> : <Mail className="size-3.5" />,
            count: loading ? undefined : each === "libraries" ? (overviews.hasPages ? undefined : overviews.items.length) : invited.length,
          }))}
        />
      }
      filters={<>
        <ListSearch
          aria-label={t("searchLibraries")}
          placeholder={t("findALibrary")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
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
            {t("acceptAccessToALibraryWithout")}
          </p>
        )}
        {loading ? (
          <ListLoading label={t("loadingLibraries")} />
        ) : !visible.length ? (
          <ListEmpty icon={search ? SearchX : view === "invitations" ? Mail : Layers}>
              {search
                ? t("noLibrariesMatchTheseFilters")
                : view === "invitations"
                  ? t("noPendingInvitations")
                  : personal
                    ? t("librariesPeopleShareWithYouAppear")
                    : t("hasNoLibrariesYet", { name: workspace?.name ?? "" })}
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
              return (
                <li
                  key={library.id}
                  data-library-row={library.id}
                  data-status={library.status}
                  className="fade-enter flex flex-wrap items-center gap-3 p-4 hover:bg-muted sm:flex-nowrap"
                >
                  <div className="relative me-1 shrink-0">
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
                    {/* In an organization every library is its own, so only your own workspace names the owner. */}
                    {personal && <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("organization", { organization: library.organization })}
                          className="absolute -bottom-1 -end-1 rounded-md bg-background ring-2 ring-background outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <OrganizationAvatar name={library.organization} imageUrl={library.organizationImageUrl} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{library.organization}</TooltipContent>
                    </Tooltip>}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {library.pending || library.draft ? (
                        library.configuration ? <Link href={library.configuration} className="text-sm font-medium">
                          {library.name}
                        </Link> : <span className="text-sm font-medium">{library.name}</span>
                      ) : (
                        // Every role opens the settings: owners change them, everyone else reads them (#653).
                        <Link
                          href={library.configuration!}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {library.name}
                        </Link>
                      )}
                      {!library.pending && (
                        <LibraryStatusChip
                          status={library.status ?? "active"}
                          operation={library.operation}
                        />
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <RoleLabel role={roleKinds[library.role]} className="ms-1">
                            {roleNames[library.role]}
                          </RoleLabel>
                        </TooltipTrigger>
                        <TooltipContent>
                          {library.role === "Owner"
                            ? t("inheritedFromOrganizationOwnership")
                            : library.role === "Viewer"
                              ? t("everyoneInTheOrganizationViewsIts")
                              : t("assignedToThisLibrary")}
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
                  <div className="flex w-full shrink-0 flex-wrap items-center gap-2 ps-[min(3.5rem,20%)] sm:ms-auto sm:w-auto sm:ps-0">
                    {library.pending ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={answering !== null}
                          onClick={() => setDeclining(library)}
                        >
                          {t("decline")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={answering !== null}
                          onClick={async () => {
                            if (!library.invitationId) return;
                            setAnswering(library.invitationId);
                            try {
                              await respond({ invitationId: library.invitationId, accept: true });
                              setNotice(`Accepted ${library.name}.`);
                              setView("libraries");
                            } catch (error) { setNotice(getErrorMessage(error, tLabels("unableToAcceptInvitation"))); }
                            finally { setAnswering(null); }
                          }}
                        >
                          <Check />
                          {t("acceptInvitation")}
                        </Button>
                      </>
                    ) : library.draft ? (
                      library.role !== "Owner" || (library.status === "deleting" && !library.deletionFailed) ? (
                        <span className="text-xs text-muted-foreground">{library.status === "deleting" ? t("deleting") : t("setupPending")}</span>
                      ) : library.status === "deleting" ? (
                        <Button size="sm" variant="outline" disabled={retrying === library.id} onClick={async () => {
                          setRetrying(library.id);
                          try { await restartTeardown({libraryId: library.id as Id<"evidenceLibraries">}); setNotice(tLabels("deletionRestartedFor", { name: library.name })); }
                          catch (error) { setNotice(getErrorMessage(error, tLabels("couldNotRestartDeletion"))); }
                          finally { setRetrying(null); }
                        }}><RotateCcw />{t("retryDeletion")}</Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={library.status === "draft" ? library.configuration! : `/evidence-communities/${library.id}/setup`}>
                            <Settings2 />{library.status === "draft" ? t("configure") : t("viewSetup")}
                          </Link>
                        </Button>
                      )
                    ) : library.role === "Viewer" ? (
                      // A viewer has no role in the library's admin: its settings are theirs to read (#653), and its public address theirs to open.
                      <ButtonGroup className="max-w-full flex-wrap" aria-label={t("actionsFor", { name: library.name })}>
                        <Button asChild size="sm" variant="outline">
                          <Link href={library.configuration!}>
                            <Settings2 />
                            {t("settings")}
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <a href={`https://${library.address}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink />
                            {t("viewPublicLibrary")}
                          </a>
                        </Button>
                      </ButtonGroup>
                    ) : (
                      <ButtonGroup className="max-w-full flex-wrap" aria-label={t("actionsFor", { name: library.name })}>
                        {library.configuration && (
                          <Button asChild size="sm" variant="outline">
                            <Link href={library.configuration}>
                              <Settings2 />
                              {/* Owners change the settings; editors and creators read them (#653). */}
                              {library.role === "Owner" ? t("configure") : t("settings")}
                            </Link>
                          </Button>
                        )}
                        <Button asChild size="sm" variant="outline">
                          <AdminAreaLink address={`https://${library.address}`}>
                            <ExternalLink />
                            {t("openAdmin")}
                          </AdminAreaLink>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="outline"
                              aria-label={t("moreActionsFor", { name: library.name })}
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
                                {t("viewPublicLibrary")}
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
                // A workspace's libraries aren't counted, so its pager shows the page alone.
                total: undefined,
                pageCount: undefined,
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
            <DialogTitle>{t("declineInvitation")}</DialogTitle>
            <DialogDescription>
              {t("declineBody", { name: declining?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("keepInvitation")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={answering !== null}
              onClick={async () => {
                if (!declining?.invitationId) return;
                setAnswering(declining.invitationId);
                try {
                  await respond({ invitationId: declining.invitationId, accept: false });
                  setDeclining(null);
                  setNotice(tLabels("invitationDeclined"));
                } catch (error) { setNotice(getErrorMessage(error, tLabels("unableToDeclineInvitation"))); }
                finally { setAnswering(null); }
              }}
            >
              {t("declineInvitation2")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LibraryPageShell>
  );
}
