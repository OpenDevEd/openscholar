"use client";

import { Pause, Play, Trash2 } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { InlineNotice } from "../section-card";
import { PanelRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const DANGER_BUTTON = "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive";

export function DangerSection({ library, onDelete }: SectionProps & { onDelete: () => void }) {
  const t = useTranslations("evidenceLibraryMock.config.danger");
  const tc = useTranslations("common");
  const togglePause = useEvidenceLibraryMockStore((s) => s.togglePause);
  const pausing = useEvidenceLibraryMockStore((s) => Boolean(s.pausing[library.id]));
  const [pauseOpen, setPauseOpen] = useState(false);
  const paused = library.paused;

  return (
    <SectionShell sectionKey="danger" icon={Trash2} tone="danger" description={t("description")} library={library}>
      {paused ? (
        <InlineNotice tone="warning" data-paused>
          {t("pausedNotice", { address: library.address })}
        </InlineNotice>
      ) : null}

      <PanelRow
        tone="danger"
        title={t("pauseTitle")}
        hint={t("pauseHint")}
        action={
          <Button
            type="button"
            variant="outline"
            className={DANGER_BUTTON}
            disabled={pausing}
            onClick={() => setPauseOpen(true)}
          >
            {pausing ? <Spinner /> : paused ? <Play /> : <Pause />}
            {paused ? t("resume") : t("pause")}
          </Button>
        }
      />

      <PanelRow
        tone="danger"
        title={t("deleteTitle")}
        hint={t("deleteHint")}
        action={
          <Button type="button" variant="outline" className={DANGER_BUTTON} onClick={onDelete}>
            <Trash2 />
            {t("deleteButton")}
          </Button>
        }
      />

      <AlertDialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{paused ? t("resumeConfirmTitle") : t("pauseConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {paused
                ? t("resumeConfirmBody", { address: library.address })
                : t("pauseConfirmBody", { address: library.address })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                togglePause(library.id);
                setPauseOpen(false);
              }}
            >
              {paused ? t("resume") : t("pause")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  );
}
