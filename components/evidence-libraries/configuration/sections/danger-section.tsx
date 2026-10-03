"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PanelRow } from "../fields";
import { SectionCard } from "../section-card";
import { TrashIcon } from "@/components/section-icons";

/** Delete the development library. Not a draft section: no state chip or reset. */
export function DangerSection({ onDelete }: { onDelete: () => void }) {
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
