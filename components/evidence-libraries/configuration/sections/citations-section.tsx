"use client";

import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { EXPORT_FORMATS, isExportUrl, settleFeatures } from "@/lib/evidence-libraries/configuration/rules";
import { Field } from "../section-card";
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
      <FieldGroup title={t("exportsHeading")} hint={t("exportsHint")}>
        {EXPORT_FORMATS.map((format) => {
          const url = draft.exports[format];
          const invalid = url !== "" && !isExportUrl(url, draft.identity.baseUrl);
          return (
            <Field
              key={format}
              label={t(`formats.${format}`)}
              hint={t(`formatHints.${format}`)}
              error={invalid ? t("urlError") : null}
            >
              {(id, hasError) => (
                <Input
                  id={id}
                  data-format={format}
                  type="url"
                  inputMode="url"
                  className="bg-background font-mono text-sm"
                  value={url}
                  placeholder="https://"
                  aria-invalid={hasError || undefined}
                  onChange={(e) =>
                    patch((d) => {
                      d.exports[format] = e.target.value.trim();
                      return settleFeatures(d);
                    })
                  }
                />
              )}
            </Field>
          );
        })}
      </FieldGroup>
    </SectionShell>
  );
}
