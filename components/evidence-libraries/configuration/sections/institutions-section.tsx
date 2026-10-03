"use client";

import { useTranslations } from "next-intl";
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
import { InstitutionNamePicker } from "./institution-pickers";
import { BuildingsIcon } from "@/components/section-icons";

const LIMITS = SCHEMA_LIMITS.institutions;

export function InstitutionsSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.institutions");
  const institutions = draft.institutions;

  return (
    <SectionShell
      sectionKey="institutions"
      icon={BuildingsIcon}
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
                {(id) => (
                  <InstitutionNamePicker
                    id={id}
                    libraryId={libraryId}
                    value={institution.name}
                    onChange={(name) =>
                      patch((d) => {
                        const row = d.institutions.find((i) => i.id === institution.id);
                        if (row) row.name = name.slice(0, LIMITS.name);
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
