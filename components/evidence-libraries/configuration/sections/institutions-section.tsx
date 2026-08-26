"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { newId, SCHEMA_LIMITS } from "@/lib/evidence-libraries/configuration/rules";
import { Field } from "../section-card";
import {
  AddButton,
  EmptyList,
  ListRow,
  move,
  SortableList,
  UploadField,
} from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";

const LIMITS = SCHEMA_LIMITS.institutions;

// The name is a text input until plan 07 adds the picker fed by the
// library's records (`listRecordInstitutions`).
export function InstitutionsSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.institutions");
  const institutions = draft.institutions;

  return (
    <SectionShell
      sectionKey="institutions"
      icon={Building2}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      {institutions.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <SortableList
          ids={institutions.map((i) => i.id)}
          onMove={(from, to) =>
            patch((d) => {
              d.institutions = move(d.institutions, from, to);
              return d;
            })
          }
        >
          {institutions.map((institution) => (
            <ListRow
              key={institution.id}
              id={institution.id}
              removeLabel={t("remove")}
              onRemove={() =>
                patch((d) => {
                  d.institutions = d.institutions.filter((i) => i.id !== institution.id);
                  return d;
                })
              }
            >
              <Field
                label={t("nameLabel")}
                error={!institution.name.trim() ? t("nameError") : null}
              >
                {(id, invalid) => (
                  <Input
                    id={id}
                    className="bg-background"
                    maxLength={LIMITS.name}
                    value={institution.name}
                    placeholder={t("namePlaceholder")}
                    aria-invalid={invalid || undefined}
                    onChange={(e) =>
                      patch((d) => {
                        const row = d.institutions.find((i) => i.id === institution.id);
                        if (row) row.name = e.target.value;
                        return d;
                      })
                    }
                  />
                )}
              </Field>
              <UploadField
                label={t("logoLabel")}
                kind="image"
                optional
                value={institution.logoUrl || null}
                onChange={(url) =>
                  patch((d) => {
                    const row = d.institutions.find((i) => i.id === institution.id);
                    if (row) row.logoUrl = url ?? "";
                    return d;
                  })
                }
              />
            </ListRow>
          ))}
        </SortableList>
      )}
      <div className="flex items-center justify-end gap-2">
        <AddButton
          disabled={institutions.length >= LIMITS.items}
          onClick={() =>
            patch((d) => {
              d.institutions.push({ id: newId("inst"), name: "", logoUrl: "" });
              return d;
            })
          }
        >
          {t("add")}
        </AddButton>
      </div>
    </SectionShell>
  );
}
