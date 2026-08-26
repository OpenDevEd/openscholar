"use client";

import {
  ExternalLink,
  Layers,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  initialsOf,
  type LibraryStatus,
  type MockLibrary,
} from "@/lib/evidence-libraries/mock/data";
import {
  selectOrganization,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { EmptyList, MetaList, type MetaItem } from "./config/fields";
import { DeleteLibraryDialog } from "./delete-library-dialog";
import { StatusChip, type StatusTone } from "./library-status-badge";
import { MockOrgSwitcher } from "./mock-org-switcher";
import { PanelHeader } from "./panel-header";

const LIBRARY_TONE: Record<LibraryStatus, StatusTone> = {
  draft: "neutral",
  setting_up: "running",
  active: "success",
  setup_failed: "danger",
  deleting: "danger",
};

export function LibraryList() {
  const t = useTranslations("evidenceLibraryMock.list");
  const org = useEvidenceLibraryMockStore(selectOrganization);
  const libraries = useEvidenceLibraryMockStore((s) => s.libraries);
  const deleting = useEvidenceLibraryMockStore((s) => s.deleting);
  const [deleteTarget, setDeleteTarget] = useState<MockLibrary | null>(null);

  const orgLibraries = libraries.filter((l) => l.orgId === org.id);

  const newButton = (
    <Button asChild>
      <Link href="/evidence-libraries/new">
        <Plus />
        {t("newLibrary")}
      </Link>
    </Button>
  );

  return (
    <div className="w-full pb-16">
      {/* Sticky header: same bar as the configuration page */}
      <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">
          <PanelHeader
            icon={Layers}
            className="border-b-0 px-0 md:px-0"
            title={t("title")}
            eyebrow={org.name}
          >
            <MockOrgSwitcher />
            {newButton}
          </PanelHeader>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer>
          {orgLibraries.length === 0 ? (
            <div className="space-y-3 p-4 md:p-6" data-library-empty>
              <EmptyList>{t("empty")}</EmptyList>
              <div className="flex justify-center">{newButton}</div>
            </div>
          ) : (
            <ul className="divide-y divide-border/50" data-library-list>
              {orgLibraries.map((library) => (
                <LibraryRow
                  key={library.id}
                  library={library}
                  deletePercent={deleting[library.id]}
                  onDelete={() => setDeleteTarget(library)}
                />
              ))}
            </ul>
          )}
        </CommandCenterContainer>
      </div>

      <DeleteLibraryDialog
        library={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function LibraryRow({
  library,
  deletePercent,
  onDelete,
}: {
  library: MockLibrary;
  deletePercent: number | undefined;
  onDelete: () => void;
}) {
  const t = useTranslations("evidenceLibraryMock.list");
  const ts = useTranslations("evidenceLibraryMock.status");
  const tSteps = useTranslations("evidenceLibraryMock.setup.steps");
  const isDeleting = library.status === "deleting";
  const base = `/evidence-libraries/${library.id}`;

  const currentStep = library.steps.find(
    (s) => s.status === "running" || s.status === "failed",
  );

  const meta: MetaItem[] = [
    {
      key: "address",
      label: t("addressLabel"),
      value: <span className="font-mono">{library.address}</span>,
    },
    library.lastActivated
      ? { key: "activated", label: t("lastActivatedLabel"), value: library.lastActivated }
      : { key: "activated", value: t("neverActivated") },
  ];
  if (library.status === "setup_failed" && currentStep) {
    meta.push({
      key: "step",
      label: t("failedAtLabel"),
      value: tSteps(`${currentStep.key}.name`),
    });
  } else if (library.status === "setting_up" && currentStep) {
    meta.push({
      key: "step",
      label: t("currentStepLabel"),
      value: tSteps(`${currentStep.key}.name`),
    });
  }

  return (
    <li
      data-library-row={library.id}
      data-status={library.status}
      className={cn(
        "flex flex-wrap items-center gap-3 p-4",
        isDeleting && "bg-muted/30",
      )}
    >
      <div
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
        style={{ background: library.color }}
      >
        {initialsOf(library.name)}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`${base}/configuration`}
            className={cn(
              "truncate text-sm font-medium hover:underline",
              isDeleting && "pointer-events-none text-muted-foreground",
            )}
          >
            {library.name}
          </Link>
          <StatusChip tone={LIBRARY_TONE[library.status]} data-status={library.status}>
            {ts(library.status)}
          </StatusChip>
        </div>
        <MetaList items={meta} />
        {isDeleting ? (
          <Progress
            aria-label={t("deleting")}
            value={deletePercent ?? 5}
            className="h-1.5 max-w-xs bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive"
          />
        ) : null}
      </div>

      {!isDeleting ? (
        <div className="flex flex-wrap items-center gap-2">
          <RowActions library={library} base={base} onDelete={onDelete} />
        </div>
      ) : null}
    </li>
  );
}

function RowActions({
  library,
  base,
  onDelete,
}: {
  library: MockLibrary;
  base: string;
  onDelete: () => void;
}) {
  const t = useTranslations("evidenceLibraryMock.list");
  const retrySetup = useEvidenceLibraryMockStore((s) => s.retrySetup);

  function retry() {
    toast(t("retrying"), { description: library.name });
    retrySetup(library.id);
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
          <Button size="sm" onClick={retry}>
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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("moreActions", { name: library.name })}
          >
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
