"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PanelRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const DANGER_BUTTON = "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive";

export function DangerSection({ library, onDelete }: SectionProps & { onDelete: () => void }) {
  const t = useTranslations("evidenceLibraryMock.config.danger");
  return (
    <SectionShell sectionKey="danger" icon={Trash2} tone="danger" description={t("description")} library={library}>
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
    </SectionShell>
  );
}
