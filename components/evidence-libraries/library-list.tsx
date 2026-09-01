"use client";

import { OrganizationSwitcher, useOrganization } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, MoreHorizontal, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
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
import { shortCommit } from "@/lib/evidence-libraries/configuration/versions";
import { initialsOf } from "@/lib/evidence-libraries/initials";
import { cn } from "@/lib/utils";
import { AdminAreaLink } from "./admin-area-link";
import { DeleteLibraryDialog } from "./configuration/delete-library-dialog";
import { ActivationControl } from "./configuration/activation-control";
import { EmptyList, MetaList, type MetaItem } from "./configuration/fields";
import { OPERATION_STAGE_ICONS } from "./configuration/operation-stage-icons";
import { LibraryAddressLink } from "./library-address-link";
import { LibraryImage } from "./library-image";
import { LibraryPageShell } from "./library-page-shell";
import { LibraryStatusChip } from "./library-status-chip";
import { StatusChip } from "./configuration/status-chip";

type Overview = FunctionReturnType<
  typeof api.evidenceLibraries.queries.listLibraryOverviews
>[number];

type AddressNotice = FunctionReturnType<
  typeof api.evidenceLibraries.updates.listAddressNotices
>[number];

/** The short state word for an address that is not answering as ours. */
const ADDRESS_STATE_MESSAGE = {
  "not-ours": "addressTaken",
  unreachable: "addressSilent",
} as const;

/** How far the teardown is, by the stage it reports. */
const TEARDOWN_PERCENT: Record<NonNullable<Overview["teardownStage"]>, number> = {
  queued: 5,
  coolify: 30,
  storage: 50,
  database: 70,
  convex: 85,
  completed: 100,
};

export function LibraryList() {
  const t = useTranslations("evidenceLibraries.list");
  const tGate = useTranslations("evidenceLibraries.gate");
  const { isLoaded, membership, organization } = useOrganization();
  const access = useProtectedQuery(
    api.evidenceLibraries.queries.getEvidenceLibrariesAccess,
    organization ? {} : "skip",
  );
  const overviews = useProtectedQuery(
    api.evidenceLibraries.queries.listLibraryOverviews,
    organization ? {} : "skip",
  );
  const addressNotices = useProtectedQuery(
    api.evidenceLibraries.updates.listAddressNotices,
    organization ? {} : "skip",
  );
  const [deleteTarget, setDeleteTarget] = useState<Overview | null>(null);
  const notices = new Map(
    (addressNotices.data ?? []).map((notice) => [notice.libraryId, notice]),
  );

  if (!isLoaded) {
    return <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />;
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
  if (access.data === undefined) {
    return <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />;
  }
  // Evidence Libraries are switched on per organisation in Clerk.
  if (!access.data.enabled) {
    return (
      <AuthStatePanel
        variant="no_access"
        title={tGate("title")}
        description={tGate("description")}
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
      description={t("description")}
      actions={
        <>
          <OrganisationPill />
          {isOwner ? newButton : null}
        </>
      }
    >
      {overviews.data === undefined ? (
        <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
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
              notice={notices.get(library._id) ?? null}
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

/**
 * Clerk owns both the organisation switcher behaviour and its current image.
 */
function OrganisationPill() {
  return (
    <div className="inline-flex h-9 items-center rounded-md border border-input bg-background shadow-xs">
      <OrganizationSwitcher
        hidePersonal
        appearance={{
          elements: {
            rootBox: "flex",
            organizationSwitcherTrigger:
              "h-9 rounded-md px-2 text-sm font-medium text-foreground hover:bg-accent focus:shadow-none",
            organizationPreviewAvatarBox: "size-5 rounded-md",
            organizationPreviewMainIdentifier: "text-sm font-medium text-foreground",
            organizationSwitcherTriggerIcon: "text-muted-foreground",
          },
        }}
      />
    </div>
  );
}

function LibraryRow({
  library,
  isOwner,
  notice,
  onDelete,
}: {
  library: Overview;
  isOwner: boolean;
  /** What the last address check found for this library, if anything. */
  notice: AddressNotice | null;
  onDelete: () => void;
}) {
  const t = useTranslations("evidenceLibraries.list");
  const tConfiguration = useTranslations("evidenceLibraryConfiguration");
  const restartTeardown = useMutation(
    api.evidenceLibraries.teardown.restartDevelopmentTeardown,
  );
  const tStages = useTranslations("evidenceLibraries.stages");
  const format = useFormatter();
  const isDeleting = library.status === "deleting";
  const base = `/evidence-libraries/${library._id}`;
  // Owners land on the configuration; editors only get the admin area once it is live.
  const titleGoesToAdmin = !isOwner && library.status === "active";
  const titleHref = isOwner ? `${base}/configuration` : null;
  const operationLabel = library.operation
    ? `${library.operation.runtimeUpdate
        ? tConfiguration("updatingSoftware", {
            rev: shortCommit(library.operation.runtimeUpdate.to),
          })
        : tConfiguration("applying")} · ${tConfiguration(
        `stages.${library.operation.stage}`,
      )}`
    : null;

  const meta: MetaItem[] = [
    {
      key: "address",
      label: t("addressLabel"),
      value: (
        <LibraryAddressLink
          address={library.publicAddress}
          className="font-mono"
        />
      ),
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
  if (notice?.movedFrom) {
    meta.push({
      key: "moved",
      label: t("movedFromLabel"),
      value: (
        <span className="font-mono" data-moved-from={notice.movedFrom}>
          {notice.movedFrom.replace(/^https?:\/\//, "")}
        </span>
      ),
    });
  }
  if (library.setupStage) {
    meta.push({
      key: "step",
      label: library.status === "setup_failed" ? t("failedAtLabel") : t("currentStepLabel"),
      value: tStages(library.setupStage),
    });
  }
  const operationControl =
    library.operation && operationLabel ? (
      <ActivationControl
        busy={{
          accessibleLabel: operationLabel,
          icon: OPERATION_STAGE_ICONS[library.operation.stage],
          label: tConfiguration(`operationFlow.${library.operation.stage}`),
        }}
        className="w-auto bg-background shadow-xs dark:bg-input/30"
        disabled
        idleLabel=""
        onActivate={() => undefined}
        size="sm"
      />
    ) : null;

  return (
    <li
      data-library-row={library._id}
      data-status={library.status}
      className={cn("flex flex-wrap items-center gap-3 p-4", isDeleting && "bg-muted/30")}
    >
      <LibraryImage
        src={library.faviconUrl ?? "/icon.svg"}
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/40"
        imageClassName="size-6 object-contain"
        fallback={<InitialsTile library={library} />}
      />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {titleHref && !isDeleting ? (
            <Link href={titleHref} className="truncate text-sm font-medium hover:underline">
              {library.name}
            </Link>
          ) : titleGoesToAdmin && !isDeleting ? (
            <AdminAreaLink
              libraryId={library._id}
              className="truncate text-sm font-medium hover:underline"
            >
              {library.name}
            </AdminAreaLink>
          ) : (
            <span className={cn("truncate text-sm font-medium", isDeleting && "text-muted-foreground")}>
              {library.name}
            </span>
          )}
          <LibraryStatusChip status={library.status} />
          {notice?.addressState ? (
            <StatusChip tone="danger" data-address-state={notice.addressState}>
              {t(ADDRESS_STATE_MESSAGE[notice.addressState])}
            </StatusChip>
          ) : null}
        </div>
        <MetaList items={meta} />
        {isDeleting && !library.teardownFailedStep ? (
          <Progress
            aria-label={t("deleting")}
            // The part being removed, so the page can be checked on meaning
            // rather than on how far along a bar looks.
            data-teardown-stage={library.teardownStage ?? "queued"}
            value={library.teardownStage ? TEARDOWN_PERCENT[library.teardownStage] : 5}
            className="h-1.5 max-w-xs bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive"
          />
        ) : null}
        {isDeleting && library.teardownFailedStep ? (
          <div className="space-y-2" data-teardown-error>
            <p className="max-w-xl text-sm text-destructive" role="status">
              {t(`deleteFailed.${library.teardownFailedStep}`)}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                restartTeardown({ libraryId: library._id })
                  .then(() => toast.success(t("deleteRetryStarted")))
                  .catch(() => toast.error(t("deleteRetryError")));
              }}
            >
              {t("deleteRetry")}
            </Button>
          </div>
        ) : null}
      </div>

      {!isDeleting ? (
        <div className="flex flex-wrap items-center gap-2">
          {isOwner ? (
            <OwnerActions
              library={library}
              base={base}
              onDelete={onDelete}
              operationControl={operationControl}
            />
          ) : library.status === "active" ? (
            operationControl ?? (
              <Button asChild size="sm" variant="outline">
                <AdminAreaLink libraryId={library._id}>
                  {t("openAdmin")}
                  <ExternalLink />
                </AdminAreaLink>
              </Button>
            )
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
  operationControl,
}: {
  library: Overview;
  base: string;
  onDelete: () => void;
  operationControl: ReactNode;
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
          {operationControl ?? (
            <Button asChild size="sm" variant="ghost">
              <AdminAreaLink libraryId={library._id}>
                {t("openAdmin")}
                <ExternalLink />
              </AdminAreaLink>
            </Button>
          )}
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

/** The coloured initials tile, shown only when the favicon image fails to load. */
function InitialsTile({ library }: { library: Pick<Overview, "name" | "accentColor"> }) {
  return (
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
  );
}
