"use client";

import { OrganizationSwitcher, useOrganization } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, MoreHorizontal, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { initialsOf } from "@/lib/evidence-libraries/initials";
import { cn } from "@/lib/utils";
import { DeleteLibraryDialog } from "./configuration/delete-library-dialog";
import { EmptyList, MetaList, type MetaItem } from "./configuration/fields";
import { LibraryPageShell } from "./library-page-shell";
import { LibraryStatusChip } from "./library-status-chip";

type Overview = FunctionReturnType<
  typeof api.evidenceLibraries.queries.listLibraryOverviews
>[number];

/** How far the teardown is, by the stage it reports. */
const TEARDOWN_PERCENT: Record<string, number> = { coolify: 35, convex: 80 };

export function LibraryList() {
  const t = useTranslations("evidenceLibraries.list");
  const { isLoaded, membership, organization } = useOrganization();
  const overviews = useProtectedQuery(
    api.evidenceLibraries.queries.listLibraryOverviews,
    organization ? {} : "skip",
  );
  const [deleteTarget, setDeleteTarget] = useState<Overview | null>(null);

  if (!isLoaded) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }
  if (!organization) {
    return (
      <AuthStatePanel
        variant="no_access"
        title={t("noOrganizationTitle")}
        description={t("noOrganizationDescription")}
      />
    );
  }
  const isOwner = membership?.role === "org:admin";

  const newButton = (
    <Button asChild>
      <Link href="/evidence-libraries/new">
        <Plus />
        {t("newLibrary")}
      </Link>
    </Button>
  );

  return (
    <LibraryPageShell
      title={t("title")}
      eyebrow={organization.name}
      actions={
        <>
          <OrganizationSwitcher hidePersonal />
          {isOwner ? newButton : null}
        </>
      }
    >
      {overviews.data === undefined ? (
        <AuthStatePanel variant="loading" loadingStyle="spinner" />
      ) : overviews.data.length === 0 ? (
        <div className="space-y-3 p-4 md:p-6" data-library-empty>
          <EmptyList>{t("empty")}</EmptyList>
          {isOwner ? <div className="flex justify-center">{newButton}</div> : null}
        </div>
      ) : (
        <ul className="divide-y divide-border/50" data-library-list>
          {overviews.data.map((library) => (
            <LibraryRow
              key={library._id}
              library={library}
              isOwner={isOwner}
              onDelete={() => setDeleteTarget(library)}
            />
          ))}
        </ul>
      )}

      {deleteTarget ? (
        <DeleteLibraryDialog
          libraryId={deleteTarget._id}
          name={deleteTarget.name}
          address={deleteTarget.publicAddress}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      ) : null}
    </LibraryPageShell>
  );
}

function LibraryRow({
  library,
  isOwner,
  onDelete,
}: {
  library: Overview;
  isOwner: boolean;
  onDelete: () => void;
}) {
  const t = useTranslations("evidenceLibraries.list");
  const tStages = useTranslations("evidenceLibraries.stages");
  const format = useFormatter();
  const isDeleting = library.status === "deleting";
  const base = `/evidence-libraries/${library._id}`;
  const address = library.publicAddress.replace(/^https?:\/\//, "");
  // Owners land on the configuration; editors only get the admin area once it is live.
  const titleHref = isOwner
    ? `${base}/configuration`
    : library.status === "active"
      ? `${base}/admin`
      : null;

  const meta: MetaItem[] = [
    {
      key: "address",
      label: t("addressLabel"),
      value: <span className="font-mono">{address}</span>,
    },
    library.lastActivatedAt
      ? {
          key: "activated",
          label: t("lastActivatedLabel"),
          value: format.dateTime(new Date(library.lastActivatedAt), {
            dateStyle: "medium",
          }),
        }
      : { key: "activated", value: t("neverActivated") },
  ];
  if (library.setupStage) {
    meta.push({
      key: "step",
      label: library.status === "setup_failed" ? t("failedAtLabel") : t("currentStepLabel"),
      value: tStages(library.setupStage),
    });
  }

  return (
    <li
      data-library-row={library._id}
      data-status={library.status}
      className={cn("flex flex-wrap items-center gap-3 p-4", isDeleting && "bg-muted/30")}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white",
          !library.accentColor && "bg-primary",
        )}
        style={library.accentColor ? { background: library.accentColor } : undefined}
      >
        {initialsOf(library.name)}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {titleHref && !isDeleting ? (
            <Link href={titleHref} className="truncate text-sm font-medium hover:underline">
              {library.name}
            </Link>
          ) : (
            <span className={cn("truncate text-sm font-medium", isDeleting && "text-muted-foreground")}>
              {library.name}
            </span>
          )}
          <LibraryStatusChip status={library.status} />
        </div>
        <MetaList items={meta} />
        {isDeleting ? (
          <Progress
            aria-label={t("deleting")}
            value={TEARDOWN_PERCENT[library.teardownStage ?? ""] ?? 10}
            className="h-1.5 max-w-xs bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive"
          />
        ) : null}
      </div>

      {!isDeleting ? (
        <div className="flex flex-wrap items-center gap-2">
          {isOwner ? (
            <OwnerActions library={library} base={base} onDelete={onDelete} />
          ) : library.status === "active" ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/admin`}>
                {t("openAdmin")}
                <ExternalLink />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function OwnerActions({
  library,
  base,
  onDelete,
}: {
  library: Overview;
  base: string;
  onDelete: () => void;
}) {
  const t = useTranslations("evidenceLibraries.list");
  const retrySetup = useMutation(api.evidenceLibraries.mutations.retrySetup);
  const [retrying, setRetrying] = useState(false);

  function retry() {
    if (retrying) return;
    setRetrying(true);
    void retrySetup({ libraryId: library._id })
      .then(() => toast(t("retrying"), { description: library.name }))
      .catch(() => toast.error(t("retryError")))
      .finally(() => setRetrying(false));
  }

  const configure = (
    <Button asChild size="sm" variant="outline">
      <Link href={`${base}/configuration`}>{t("configure")}</Link>
    </Button>
  );
  const viewProgress = (
    <Button asChild size="sm" variant="outline">
      <Link href={`${base}/setup`}>{t("viewProgress")}</Link>
    </Button>
  );

  return (
    <>
      {library.status === "active" ? (
        <>
          {configure}
          <Button asChild size="sm" variant="ghost">
            <Link href={`${base}/admin`}>
              {t("openAdmin")}
              <ExternalLink />
            </Link>
          </Button>
        </>
      ) : null}
      {library.status === "setting_up" ? viewProgress : null}
      {library.status === "setup_failed" ? (
        <>
          <Button size="sm" onClick={retry} disabled={retrying}>
            <RotateCcw />
            {t("retry")}
          </Button>
          {viewProgress}
        </>
      ) : null}
      {library.status === "draft" ? (
        <>
          <Button asChild size="sm">
            <Link href={`${base}/configuration`}>{t("continueSetup")}</Link>
          </Button>
          {configure}
        </>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("moreActions", { name: library.name })}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onSelect={onDelete}
          >
            <Trash2 />
            {t("deleteLibrary")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
