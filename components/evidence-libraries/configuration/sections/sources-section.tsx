"use client";

import { useTranslations } from "next-intl";
import { SectionShell, type SectionProps } from "../section-shell";
import { SourcesField } from "./sources-field";
import { SourcesIcon } from "@/components/icons";

export function SourcesSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  return (
    <SectionShell
      sectionKey="sources"
      icon={SourcesIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <SourcesField
        libraryId={libraryId}
        value={draft.sources}
        onChange={(sources) =>
          patch((d) => {
            d.sources = sources;
            return d;
          })
        }
        tags={draft.content.tags}
        onTagsChange={(tags) =>
          patch((d) => {
            d.content.tags = tags;
            return d;
          })
        }
      />
    </SectionShell>
  );
}
