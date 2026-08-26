"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import { AddButton, EmptyList, ListRow, move, UploadField } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const INSTITUTIONS_MAX = 200;

export function InstitutionsSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.institutions");
  const institutions = library.draft.institutions;

  return (
    <SectionShell
      sectionKey="institutions"
      icon={Building2}
      description={t("description")}
      library={library}
    >
      {institutions.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <div className="space-y-2">
          {institutions.map((institution, index) => (
            <ListRow
              key={institution.id}
              index={index}
              count={institutions.length}
              removeLabel={t("remove")}
              onMove={(from, to) =>
                patch((d) => {
                  d.institutions = move(d.institutions, from, to);
                  return d;
                })
              }
              onRemove={() =>
                patch((d) => {
                  d.institutions = d.institutions.filter((i) => i.id !== institution.id);
                  return d;
                })
              }
            >
              <Field label={t("nameLabel")} error={!institution.name.trim() ? t("nameError") : null}>
                {(id, invalid) => (
                  <Input
                    id={id}
                    className="bg-background"
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
                slot={`${library.id}:institution:${institution.id}`}
                value={institution.logo}
                onChange={(file) =>
                  patch((d) => {
                    const row = d.institutions.find((i) => i.id === institution.id);
                    if (row) row.logo = file;
                    return d;
                  })
                }
              />
            </ListRow>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("count", { count: institutions.length, max: INSTITUTIONS_MAX })}
        </p>
        <AddButton
          disabled={institutions.length >= INSTITUTIONS_MAX}
          onClick={() =>
            patch((d) => {
              d.institutions.push({ id: newId("inst"), name: "", logo: null });
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
