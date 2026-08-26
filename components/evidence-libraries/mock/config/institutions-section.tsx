"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import {
  AddButton,
  EmptyList,
  ListRow,
  move,
  SortableList,
  UploadField,
} from "./fields";
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
                  d.institutions = d.institutions.filter(
                    (i) => i.id !== institution.id,
                  );
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
                    value={institution.name}
                    placeholder={t("namePlaceholder")}
                    aria-invalid={invalid || undefined}
                    onChange={(e) =>
                      patch((d) => {
                        const row = d.institutions.find(
                          (i) => i.id === institution.id,
                        );
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
                    const row = d.institutions.find(
                      (i) => i.id === institution.id,
                    );
                    if (row) row.logo = file;
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
