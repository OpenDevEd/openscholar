"use client";

import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { EXPORT_FORMATS, settleFeatures } from "@/lib/evidence-libraries/configuration/rules";
import { FieldGroup, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";

export function CitationsSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.citations");
  return (
    <SectionShell
      sectionKey="citations"
      icon={Quote}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <ToggleRow
        label={t("showUrl")}
        hint={t("showUrlHint")}
        checked={draft.citations.showUrl}
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
            checked={draft.exports[format]}
            onChange={(checked) =>
              patch((d) => {
                d.exports[format] = checked;
                return settleFeatures(d);
              })
            }
          />
        ))}
      </FieldGroup>
    </SectionShell>
  );
}
