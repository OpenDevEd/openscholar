"use client";

import { useTranslations } from "next-intl";
import { useAction, type Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import { cloneElement, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { useCurrentWorkspace, useWorkspaces } from "@/components/workspaces/parts";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
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
import { ListSearch } from "./list-controls";
import { PublicCommunities } from "./public-communities";
import { YourCommunities, type Community, type CommunityFilter } from "./your-communities";

/**
 * The Communities page (#1090): every community you can open, in the page's sidebar, beside every
 * public one in its card. `preloadedOpens` is the server's answer to whether the person may create
 * one here, so New community is there from the first frame.
 */
export function LibraryList({ preloadedOpens }: {
  preloadedOpens?: Preloaded<typeof api.organizationFeatures.opens>;
}) {
  const t = useTranslations("libraryList");
  const live = useWorkspaceFeatures().data;
  const creates = (live ?? (preloadedOpens ? preloadedQueryResult(preloadedOpens) : undefined))?.createsCommunities === true;
  const [search, setSearch] = useState("");
  const text = useDebouncedValue(search.trim(), 300);
  // Where the sidebar's communities are from, kept in the address so a link or a reload keeps it.
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault("all"));
  // The switcher's list is read once for the whole page, so after a switch the workspace is known from the first frame; the address says which.
  const slug = useWorkspaceSlug();
  const listed = useWorkspaces().list?.find((row) => (slug ? row.slug === slug : row.kind === "personal"));
  const current = useCurrentWorkspace();
  const workspace = listed ?? current;
  const organization = workspace?.organizationId;
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
      setNotice(t("sidebar.accepted", { name: community.name }));
    } catch (error) { setNotice(getErrorMessage(error, t("unableToAcceptInvitation"))); }
    finally { setAnswering(null); }
  };
  // The sidebar on a wide screen and above the card on a narrow one: CSS shows one copy, and both read the same filter.
  // The header is there from the first frame: the address says whose workspace it is; only the list waits.
  const yours = (
    <YourCommunities
      waiting={!workspace}
      search={text}
      personal={workspace ? workspace.kind === "personal" : !slug}
      workspaceName={workspace?.name ?? ""}
      workspaceImage={workspace?.imageUrl}
      organization={organization}
      filter={from as CommunityFilter}
      onFilter={(next) => void setFrom(next === "all" ? null : next)}
      answering={answering}
      onAccept={accept}
      onDecline={setDeclining}
      notify={setNotice}
    />
  );
  return (
    <TwoColumnLayout
      leftColumn={
        <aside aria-label={t("sidebar.label")} className="relative hidden h-full w-80 bg-background lg:block">
          {cloneElement(yours, { framed: true })}
        </aside>
      }
      rightColumn={
        <PageWrapper>
          <LibraryPageShell
            title={t("evidenceLibraries")}
            above={<div className="mb-4 overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-surface lg:hidden">{yours}</div>}
            actions={creates &&
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
            <PublicCommunities search={text} workspaceId={workspace?.workspaceId as Id<"workspaces"> | undefined} />
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
