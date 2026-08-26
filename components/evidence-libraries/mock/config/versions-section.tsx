"use client";

import { History, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LibraryVersion, SectionKey } from "@/lib/evidence-libraries/mock/config";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { StatusChip, type StatusTone } from "../library-status-badge";
import { EmptyList, FieldGroup, MetaList, Panel } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const VERSION_TONE: Record<LibraryVersion["status"], StatusTone> = {
  live: "success",
  previous: "neutral",
  failed: "danger",
};

export function VersionsSection({ library }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.versions");
  const tConfig = useTranslations("evidenceLibraryMock.config");
  const tc = useTranslations("common");
  const restoreVersion = useEvidenceLibraryMockStore((s) => s.restoreVersion);
  const activating = useEvidenceLibraryMockStore((s) => Boolean(s.activation[library.id]));
  const updateRuntime = useEvidenceLibraryMockStore((s) => s.updateRuntime);
  const tu = useTranslations("evidenceLibraryMock.config.runtimeUpdate");
  const runtime = library.runtime;
  const updateAvailable = runtime.running !== runtime.latest;
  const [restoring, setRestoring] = useState<string | null>(null);

  const sectionNames = (keys: string[]) =>
    keys.length === 0
      ? t("everything")
      : keys.map((key) => tConfig(`sections.${key as SectionKey}`)).join(", ");

  return (
    <SectionShell sectionKey="versions" icon={History} description={t("description")} library={library}>
      <FieldGroup
        title={tu("heading")}
        action={
          updateAvailable ? (
            <Button type="button" size="sm" disabled={activating} onClick={() => updateRuntime(library.id)}>
              <RefreshCw />
              {tu("update")}
            </Button>
          ) : null
        }
      >
        <Panel tone="muted" className="space-y-3" data-runtime-state={updateAvailable ? "update-available" : "up-to-date"}>
          <MetaList
            items={[
              { key: "running", label: tu("runningLabel"), value: <span className="font-mono">{runtime.running}</span> },
              { key: "latest", label: tu("latestLabel"), value: <span className="font-mono">{runtime.latest}</span> },
              { key: "checked", label: tu("checkedLabel"), value: runtime.checkedAt },
            ]}
          />
          {updateAvailable ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{tu("changesHeading")}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-sm">
                {runtime.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tu("upToDate")}</p>
          )}
        </Panel>
      </FieldGroup>

      <FieldGroup title={t("historyHeading")}>
      {library.versions.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <div className="rounded-lg border border-border/50 bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colVersion")}</TableHead>
                <TableHead>{t("colWhen")}</TableHead>
                <TableHead>{t("colBy")}</TableHead>
                <TableHead>{t("colChanged")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead className="w-28">
                  <span className="sr-only">{t("restore")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {library.versions.map((version) => (
                <TableRow key={version.rev} data-version-status={version.status}>
                  <TableCell className="font-mono text-xs">{version.rev}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{version.at}</TableCell>
                  <TableCell className="text-sm">{version.by}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{version.kind === "runtime" ? tu("kindRuntime") : sectionNames(version.sections)}</TableCell>
                  <TableCell>
                    <StatusChip tone={VERSION_TONE[version.status]}>{t(`status.${version.status}`)}</StatusChip>
                  </TableCell>
                  <TableCell className="text-right">
                    {version.status !== "live" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={activating}
                        onClick={() => setRestoring(version.rev)}
                      >
                        {t("restore")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      </FieldGroup>

      <AlertDialog open={restoring !== null} onOpenChange={(open) => !open && setRestoring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restoreTitle", { rev: restoring ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("restoreBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (restoring) restoreVersion(library.id, restoring);
                setRestoring(null);
              }}
            >
              {t("restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  );
}
