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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
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
import { PrototypeBadge } from "./prototype-badge";

export function LibraryList() {
  const t = useTranslations("evidenceLibraryMock.list");
  const org = useEvidenceLibraryMockStore(selectOrganization);
  const libraries = useEvidenceLibraryMockStore((s) => s.libraries);
  const deleting = useEvidenceLibraryMockStore((s) => s.deleting);
  const [deleteTarget, setDeleteTarget] = useState<MockLibrary | null>(null);

  const orgLibraries = libraries.filter((l) => l.orgId === org.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <PrototypeBadge />
        <MockOrgSwitcher />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <PageHeader
            title={t("title")}
            description={t("description", { organization: org.name })}
            icon={Layers}
          />
        </div>
        <Button asChild className="mt-1">
          <Link href="/evidence-libraries/new">
            <Plus />
            {t("newLibrary")}
          </Link>
        </Button>
      </div>

      {orgLibraries.length === 0 ? (
        <EmptyState organizationName={org.name} />
      ) : (
        <ul className="space-y-3" data-library-list>
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
      className="rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center"
      data-library-empty
    >
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10">
        <Layers className="size-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold">
        {t("emptyTitle", { organization: organizationName })}
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        {t("emptyDescription")}
      </p>
      <Button asChild className="mt-6">
        <Link href="/evidence-libraries/new">
          <Plus />
          {t("createFirst")}
        </Link>
      </Button>
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
        "flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs transition-opacity sm:flex-row sm:items-center",
        isDeleting && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ background: library.color }}
        >
          {initialsOf(library.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{library.name}</h3>
            <LibraryStatusBadge library={library} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{library.shortName}</span>
            <a
              className="font-mono hover:text-foreground hover:underline"
              href={`https://${library.address}`}
              target="_blank"
              rel="noopener noreferrer"
              title={t("opensPublic")}
            >
              {library.address}
            </a>
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
            <div className="mt-2 max-w-xs space-y-1 text-xs text-destructive">
              <span>{t("removing")}</span>
              <Progress
                value={deletePercent ?? 5}
                className="h-1.5 [&>[data-slot=progress-indicator]]:bg-destructive"
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
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
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
