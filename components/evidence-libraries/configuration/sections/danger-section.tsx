"use client";

import { Move, Trash2, TrashIcon } from "@/components/icons";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PanelRow } from "../fields";
import { SectionCard } from "../section-card";

/** Move the community to another workspace, or delete it. Not a draft section: no state chip or reset. */
export function DangerSection({ onMove, onDelete }: { onMove: () => void; onDelete: () => void }) {
  const t = useTranslations("evidenceLibraryConfiguration");
  return (
    <SectionCard
      id="sec-danger"
      icon={TrashIcon}
      tone="danger"
      title={t("sections.danger")}
      description={t("danger.description")}
    >
      <PanelRow
        title={t("danger.moveTitle")}
        hint={t("danger.moveHint")}
        action={
          <Button type="button" variant="outline" onClick={onMove}>
            <Move />
            {t("danger.moveButton")}
          </Button>
        }
      />
      <PanelRow
        tone="danger"
        title={t("danger.deleteTitle")}
        hint={t("danger.deleteHint")}
        action={
          <Button
            type="button"
            variant="outline"
            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 />
            {t("danger.deleteButton")}
          </Button>
        }
      />
    </SectionCard>
  );
}
