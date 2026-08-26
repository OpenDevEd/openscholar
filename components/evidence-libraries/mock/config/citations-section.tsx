"use client";

import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { FieldGroup, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const EXPORT_FORMATS = ["ris", "bibtex", "atom"] as const;

export function CitationsSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.citations");
  const citations = library.draft.citations;

  return (
    <SectionShell sectionKey="citations" icon={Quote} description={t("description")} library={library}>
      <ToggleRow
        label={t("showUrl")}
        hint={t("showUrlHint")}
        checked={citations.showUrl}
        onChange={(checked) =>
          patch((d) => {
            d.citations.showUrl = checked;
            return d;
          })
        }
      />
      <FieldGroup title={t("exportsHeading")}>
        {EXPORT_FORMATS.map((format) => (
          <ToggleRow
            key={format}
            data-format={format}
            label={t(`formats.${format}`)}
            hint={t(`formatHints.${format}`)}
            checked={citations[format]}
            onChange={(checked) =>
              patch((d) => {
                d.citations[format] = checked;
                return d;
              })
            }
          />
        ))}
      </FieldGroup>
    </SectionShell>
  );
}
