"use client";

import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  Settings,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  doneStepCount,
  initialsOf,
  type MockLibrary,
} from "@/lib/evidence-libraries/mock/data";
import {
  selectOrganization,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { DeleteLibraryDialog } from "./delete-library-dialog";
import { LibraryStatusBadge } from "./library-status-badge";
import { MockOrgSwitcher } from "./mock-org-switcher";
import { PanelHeader } from "./panel-header";
import { PrototypeBadge } from "./prototype-badge";

export function LibraryList() {
  const t = useTranslations("evidenceLibraryMock.list");
  const org = useEvidenceLibraryMockStore(selectOrganization);
  const libraries = useEvidenceLibraryMockStore((s) => s.libraries);
  const deleting = useEvidenceLibraryMockStore((s) => s.deleting);
  const [deleteTarget, setDeleteTarget] = useState<MockLibrary | null>(null);

  const orgLibraries = libraries.filter((l) => l.orgId === org.id);

  return (
    <div className="container mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <PrototypeBadge />
        <MockOrgSwitcher />
      </div>
      <CommandCenterContainer>
        <PanelHeader
          icon={Layers}
          title={t("title")}
          description={t("description", { organization: org.name })}
        >
          <Button asChild>
            <Link href="/evidence-libraries/new">
              <Plus />
              {t("newLibrary")}
            </Link>
          </Button>
        </PanelHeader>

        {orgLibraries.length === 0 ? (
          <EmptyState organizationName={org.name} />
        ) : (
          <ul className="space-y-2 p-4 md:p-6" data-library-list>
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

function EmptyState({ organizationName }: { organizationName: string }) {
  const t = useTranslations("evidenceLibraryMock.list");
  return (
    <div
      className="relative flex flex-col items-center justify-center px-6 py-14 text-center sm:px-10"
      data-library-empty
    >
      <div className="mb-5 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm">
        <Layers className="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">
        {t("emptyTitle", { organization: organizationName })}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {t("emptyDescription")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button asChild className="rounded-xl">
          <Link href="/evidence-libraries/new">
            <Plus />
            {t("createFirst")}
          </Link>
        </Button>
      </div>
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
  const isDeleting = library.status === "deleting";
  const base = `/evidence-libraries/${library.id}`;

  function copyAddress() {
    const url = `https://${library.address}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast.success(t("copied"), { description: url });
  }

  return (
    <li
      data-library-row={library.id}
      data-status={library.status}
      className={cn(
        "group flex flex-col gap-4 rounded-xl border border-border/50 bg-background p-4 transition-colors hover:border-primary/20 hover:bg-sidebar-accent/30 sm:flex-row sm:items-center",
        isDeleting && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
          style={{ background: library.color }}
        >
          {initialsOf(library.name)}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary">
              {library.name}
            </h3>
            <LibraryStatusBadge library={library} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <code className="font-mono">{library.shortName}</code>
            <span className="h-1 w-1 rounded-full bg-border" aria-hidden="true" />
            <a
              className="font-mono transition-colors hover:text-foreground hover:underline"
              href={`https://${library.address}`}
              target="_blank"
              rel="noopener noreferrer"
              title={t("opensPublic")}
            >
              {library.address}
            </a>
            <span className="h-1 w-1 rounded-full bg-border" aria-hidden="true" />
            <span>
              {library.lastActivated
                ? t("lastActivated", { when: library.lastActivated })
                : t("neverActivated")}
            </span>
          </div>
          {library.status === "setting_up" ? (
            <Progress
              aria-label={t("setupProgress")}
              value={doneStepCount(library) * 20}
              className="mt-2 h-1.5 max-w-xs"
            />
          ) : null}
          {isDeleting ? (
            <div className="mt-2 max-w-xs space-y-1.5 text-xs text-destructive">
              <span>{t("removing")}</span>
              <Progress
                value={deletePercent ?? 5}
                className="h-1.5 bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {library.status === "draft" ? (
          <Button asChild size="sm">
            <Link href={`${base}/configuration`}>
              <Play />
              {t("continueSetup")}
            </Link>
          </Button>
        ) : null}
        {library.status === "setting_up" || library.status === "setup_failed" ? (
          <Button
            asChild
            size="sm"
            variant={library.status === "setup_failed" ? "outline" : "default"}
          >
            <Link href={`${base}/setup`}>
              {library.status === "setup_failed" ? <AlertTriangle /> : <Spinner />}
              {t("viewProgress")}
            </Link>
          </Button>
        ) : null}
        {!isDeleting && library.status !== "draft" ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}/configuration`}>
              <Settings />
              {t("configure")}
            </Link>
          </Button>
        ) : null}
        {library.status === "active" ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}/admin`}>
              <ExternalLink />
              {t("openAdmin")}
            </Link>
          </Button>
        ) : null}
        {!isDeleting ? (
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
              <DropdownMenuItem onSelect={copyAddress}>
                <Copy />
                {t("copyAddress")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`${base}/setup`}>
                  <Play />
                  {t("setupProgress")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onSelect={onDelete}
              >
                <Trash2 />
                {t("deleteLibrary")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}
