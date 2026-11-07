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
import { LibraryPageShell } from "./library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "./configuration/panel-header";
import { ListLoading, ListSearch } from "./list-controls";
import { PublicCommunities } from "./public-communities";
import { YourCommunities, type Community } from "./your-communities";

/**
 * MOCK: the communities you can open, in a column of their own beside every public one.
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
  return (
    <LibraryPageShell
      // The column of your own stays in view beside the public cards, which a clipped card would stop.
      allowOverflow
      title={t("evidenceLibraries")}
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
      <div className="grid @4xl:grid-cols-[19rem_minmax(0,1fr)]">
        <aside aria-label="Your communities" className="border-b border-border-subtle pb-2 @4xl:border-b-0 @4xl:border-e">
          <div className="@4xl:sticky @4xl:top-20">
            {pending || !workspace ? <ListLoading label={t("loadingLibraries")} /> : (
              <YourCommunities
                search={search.trim()}
                personal={workspace.kind === "personal"}
                workspaceName={workspace.name}
                workspaceImage={workspace.imageUrl}
                organization={organization}
                answering={answering}
                onAccept={accept}
                onDecline={setDeclining}
                notify={setNotice}
              />
            )}
          </div>
        </aside>
        <PublicCommunities search={search} />
      </div>
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
  );
}
