"use client";

import { useAction, useMutation } from "convex/react";
import { OrganizationAvatar, useLibraryOrganizationChoice } from "./organization-picker";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
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
} from "lucide-react";
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
import { LibraryStatusChip } from "./library-status-chip";
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
};
const roleIcons = { Owner: Crown, Editor: ShieldCheck, Creator: PenLine };
function LibraryTile() {
  return (
    <div className={LIST_TILE}>
      <Layers className="size-5" />
    </div>
  );
}

/**
 * `pending` renders the page before access is confirmed: the frame and
 * toolbar show at once and only the list waits.
 */
export function LibraryList({ pending = false }: { pending?: boolean }) {
  const owner = useLibraryOrganizationChoice();
  const overviews = useProtectedQuery(api.evidenceLibraries.queries.listLibraryOverviews, pending ? "skip" : {});
  const invitations = useProtectedQuery(api.evidenceLibraries.invitations.listMine, pending ? "skip" : {});
  const respond = useAction(api.evidenceLibraries.invitationActions.respond);
  const restartTeardown = useMutation(api.evidenceLibraries.teardown.restartDevelopmentTeardown);
  const [retrying, setRetrying] = useState<string | null>(null);
  const roles = { owner: "Owner", editor: "Editor", creator: "Creator" } as const;
  const libraries: Library[] = [
    ...(overviews.data ?? []).map(library => ({ id: library._id, name: library.name, role: roles[library.role], organization: library.organization.name, organizationImageUrl: library.organization.imageUrl, faviconUrl: library.faviconUrl, address: library.publicAddress.replace(/^https?:\/\//, ""), status: library.status, deletionFailed: Boolean(library.teardownFailedStep), draft: library.status !== "active", ...(library.role === "owner" ? { configuration: `/evidence-libraries/${library._id}/configuration` } : {}) })),
    ...(invitations.data ?? []).map(invitation => ({ id: invitation.libraryId, invitationId: invitation.invitationId, name: invitation.name, role: roles[invitation.role], organization: invitation.organization.name, organizationImageUrl: invitation.organization.imageUrl, address: "", pending: true })),
  ];
  const [view, setView] = useQueryState("view", parseAsStringLiteral(["libraries", "invitations"]).withDefault("libraries"));
  const [organization, setOrganization] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [declining, setDeclining] = useState<Library | null>(null);
  const organizations = [
    ...new Set(libraries.map((library) => library.organization)),
  ];
  const visible = libraries.filter(
    (library) =>
      Boolean(library.pending) === (view === "invitations") &&
      (organization === "all" || library.organization === organization) &&
      `${library.name} ${library.organization}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const loading = !overviews.data || !invitations.data || !owner.isReady;
  return (
    <LibraryPageShell
      title="Evidence libraries"
      actions={owner.isReady && owner.organizations.length > 0 ?
        <span className="fade-enter inline-flex">
          <Button asChild size="sm" className={BAR_ACTION}>
            <Link href="/evidence-libraries/new">
              <Plus />
              <span className={BAR_LABEL}>New library</span>
            </Link>
          </Button>
        </span> : null
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
            count: loading ? undefined : libraries.filter((library) => Boolean(library.pending) === (tab === "invitations")).length,
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
              <SelectItem key={org} value={org}>
                <OrganizationAvatar name={org} imageUrl={libraries.find(l => l.organization === org)?.organizationImageUrl} />
                {org}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </>}
    >
      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
        >
          <Check className="size-3.5" />
          {notice}
        </p>
      )}
      {view === "invitations" && (
        <p className="border-b border-border/50 px-4 py-3 text-xs text-muted-foreground">
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
        <ul className="divide-y divide-border/50" data-library-list>
          {visible.map((library) => {
            const RoleIcon = roleIcons[library.role];
            return (
              <li
                key={library.id}
                data-library-row={library.id}
                data-status={library.status}
                className="fade-enter flex flex-wrap items-center gap-3 p-4 hover:bg-muted/15 sm:flex-nowrap"
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
                        libraryId={library.id}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {library.name}
                      </AdminAreaLink>
                    )}
                    {!library.pending && (
                      <LibraryStatusChip
                        status={library.status ?? "active"}
                      />
                    )}
                    <span
                      className="ml-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                      title={
                        library.role === "Owner"
                          ? "Inherited from organization ownership"
                          : "Assigned to this library"
                      }
                    >
                      <RoleIcon className="size-3.5" />
                      {library.role}
                    </span>
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
                <div className="ml-auto flex shrink-0 items-center gap-2">
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
                        <AdminAreaLink libraryId={library.id}>
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
