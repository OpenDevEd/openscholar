"use client";

import { History } from "lucide-react";
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
import { EmptyList } from "./fields";
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
  const [restoring, setRestoring] = useState<string | null>(null);

  const sectionNames = (keys: string[]) =>
    keys.length === 0
      ? t("everything")
      : keys.map((key) => tConfig(`sections.${key as SectionKey}`)).join(", ");

  return (
    <SectionShell sectionKey="versions" icon={History} description={t("description")} library={library}>
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
                  <TableCell className="text-xs text-muted-foreground">{sectionNames(version.sections)}</TableCell>
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
