"use client";

import { useTranslations } from "next-intl";
import { useAction, type Preloaded } from "convex/react";
import { useState } from "react";
import { useLibraryOrganizationChoice } from "./organization-picker";
import { useCurrentWorkspace, useWorkspaces } from "@/components/workspaces/parts";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "@/components/workspace-link";
import { Check, Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
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
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { PageWrapper } from "@/components/PageWrapper";
import { LibraryPageShell } from "./library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "./configuration/panel-header";
import { ListLoading, ListSearch } from "./list-controls";
import { PublicCommunities } from "./public-communities";
import { YourCommunities, type Community } from "./your-communities";

/**
 * MOCK: the communities you can open, in the page's sidebar, beside every public one in its card.
 * `pending` renders the page before access is confirmed: the frame and toolbar show at
 * once and only the lists wait.
 */
export function LibraryList({ pending = false, preloadedOrganizations, organizationHere }: {
  pending?: boolean;
  preloadedOrganizations?: Preloaded<typeof api.organizationFeatures.listLibraryOrganizations>;
  /** The organization the page is in, read by the server, so New community is there from the first frame. */
  organizationHere?: Id<"organizations">;
}) {
  const t = useTranslations("libraryList");
  const owner = useLibraryOrganizationChoice(preloadedOrganizations);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  // The switcher's list is read once for the whole page, so after a switch the workspace is known from the first frame; the address says which.
  const slug = useWorkspaceSlug();
  const listed = useWorkspaces().list?.find((row) => (slug ? row.slug === slug : row.kind === "personal"));
  const current = useCurrentWorkspace();
  const workspace = listed ?? current;
  const organization = workspace?.organizationId ?? organizationHere;
  const respond = useAction(api.evidenceLibraries.invitationActions.respond);
  // The invitation being answered: while its answer is on its way, no invitation takes another.
  const [answering, setAnswering] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [declining, setDeclining] = useState<Community | null>(null);
  const accept = async (community: Community) => {
    if (!community.invitationId) return;
    setAnswering(community.invitationId);
    try {
      await respond({ invitationId: community.invitationId, accept: true });
      setNotice(`Accepted ${community.name}.`);
    } catch (error) { setNotice(getErrorMessage(error, t("unableToAcceptInvitation"))); }
    finally { setAnswering(null); }
  };
  // The sidebar on a wide screen and above the card on a narrow one: CSS shows one copy, and both read the same filter.
  const yours = pending || !workspace ? <ListLoading label={t("loadingLibraries")} /> : (
    <YourCommunities
      search={search.trim()}
      personal={workspace.kind === "personal"}
      workspaceName={workspace.name}
      workspaceImage={workspace.imageUrl}
      organization={organization}
      filter={filter}
      onFilter={setFilter}
      answering={answering}
      onAccept={accept}
      onDecline={setDeclining}
      notify={setNotice}
    />
  );
  return (
    <TwoColumnLayout
      leftColumn={
        <aside aria-label="Your communities" className="relative hidden h-full w-80 border-s border-border-subtle bg-background lg:block">
          {/* The same wash as the page's other side panels. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent" />
          <div className="relative h-full">{yours}</div>
        </aside>
      }
      rightColumn={
        <PageWrapper>
          <LibraryPageShell
            title={t("evidenceLibraries")}
            above={<div className="mb-4 overflow-hidden rounded-2xl border border-border-subtle bg-background lg:hidden">{yours}</div>}
            actions={owner.organizations.some((org) => org.id === organization) &&
              <Button asChild size="sm" className={BAR_ACTION}>
                <Link href="/evidence-communities/new">
                  <Plus />
                  <span className={BAR_LABEL}>{t("newLibrary")}</span>
                </Link>
              </Button>
            }
            filters={
              <ListSearch
                aria-label={t("searchLibraries")}
                placeholder={t("findALibrary")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            }
          >
            {notice && (
              <p role="status" className="flex items-center gap-2 border-b border-border-subtle bg-inset px-4 py-3 text-xs text-muted-foreground">
                <Check className="size-3.5" />
                {notice}
              </p>
            )}
            <PublicCommunities search={search} />
            <Dialog open={Boolean(declining)} onOpenChange={(open) => { if (!open) setDeclining(null); }}>
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>{t("declineInvitation")}</DialogTitle>
                  <DialogDescription>{t("declineBody", { name: declining?.name ?? "" })}</DialogDescription>
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
                        setNotice(t("invitationDeclined"));
                      } catch (error) { setNotice(getErrorMessage(error, t("unableToDeclineInvitation"))); }
                      finally { setAnswering(null); }
                    }}
                  >
                    {t("declineInvitation2")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </LibraryPageShell>
        </PageWrapper>
      }
    />
  );
}
