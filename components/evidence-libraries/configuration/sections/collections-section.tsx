"use client";

import { useTranslations } from "next-intl";
import { SectionShell, type SectionProps } from "../section-shell";
import { CollectionsField } from "./collections-field";
import { CollectionsIcon } from "@/components/icons";

export function CollectionsSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.collections");
  return (
    <SectionShell
      sectionKey="collections"
      icon={CollectionsIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <CollectionsField
        libraryId={libraryId}
        value={draft.collections}
        onChange={(collections) =>
          patch((d) => {
            d.collections = collections;
            return d;
          })
        }
      />
    </SectionShell>
  );
}
