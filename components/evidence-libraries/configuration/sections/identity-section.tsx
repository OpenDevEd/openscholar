"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { newId, SCHEMA_LIMITS } from "@/lib/evidence-libraries/configuration/rules";
import { Field } from "../section-card";
import {
  AddButton,
  EmptyList,
  ListRow,
  move,
  ReadOnlyValue,
  FieldGroup,
  SortableList,
  UploadField,
} from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { GlobeIcon } from "@/components/section-icons";

const LIMITS = SCHEMA_LIMITS.identity;

export function IdentitySection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.identity");
  const identity = draft.identity;

  function copyAddress() {
    navigator.clipboard?.writeText(identity.baseUrl).catch(() => {});
    toast.success(t("copied"), { description: identity.baseUrl });
  }

  return (
    <SectionShell
      sectionKey="identity"
      icon={GlobeIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <Field
        label={t("nameLabel")}
        counter={`${identity.name.length} / ${LIMITS.name}`}
        error={!identity.name.trim() ? t("nameError") : null}
      >
        {(id, invalid) => (
          <Input
            id={id}
            maxLength={LIMITS.name}
            className="bg-background"
            value={identity.name}
            aria-invalid={invalid || undefined}
            onChange={(e) =>
              patch((d) => {
                d.identity.name = e.target.value;
                return d;
              })
            }
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Field
          label={t("shortNameLabel")}
          hint={t("shortNameHint")}
          counter={`${identity.shortName.length} / ${LIMITS.shortName}`}
          error={!identity.shortName.trim() ? t("shortNameError") : null}
        >
          {(id, invalid) => (
            <Input
              id={id}
              maxLength={LIMITS.shortName}
              className="bg-background"
              value={identity.shortName}
              aria-invalid={invalid || undefined}
              onChange={(e) =>
                patch((d) => {
                  d.identity.shortName = e.target.value;
                  return d;
                })
              }
            />
          )}
        </Field>
        <Field label={t("addressLabel")} hint={t("addressHint")}>
          {(id) => (
            <div className="flex min-w-0 gap-1.5">
              <ReadOnlyValue id={id} value={identity.baseUrl} className="min-w-0 flex-1" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("copyAddress")}
                onClick={copyAddress}
              >
                <Copy />
              </Button>
            </div>
          )}
        </Field>
      </div>

      <Field
        label={t("taglineLabel")}
        hint={t("taglineHint")}
        counter={`${identity.tagline.length} / ${LIMITS.tagline}`}
      >
        {(id) => (
          <Input
            id={id}
            maxLength={LIMITS.tagline}
            className="bg-background"
            value={identity.tagline}
            placeholder={t("taglinePlaceholder")}
            onChange={(e) =>
              patch((d) => {
                d.identity.tagline = e.target.value;
                return d;
              })
            }
          />
        )}
      </Field>

      <Field
        label={t("descriptionLabel")}
        hint={t("descriptionHint")}
        counter={`${identity.description.length} / ${LIMITS.description}`}
      >
        {(id) => (
          <Textarea
            id={id}
            maxLength={LIMITS.description}
            className="bg-background"
            value={identity.description}
            onChange={(e) =>
              patch((d) => {
                d.identity.description = e.target.value;
                return d;
              })
            }
          />
        )}
      </Field>

      <FieldGroup
        title={t("partnersHeading")}
        hint={t("partnersHint")}
        action={
          <AddButton
            disabled={identity.fundingPartners.length >= LIMITS.fundingPartners}
            onClick={() =>
              patch((d) => {
                d.identity.fundingPartners.push({ id: newId("fp"), name: "" });
                return d;
              })
            }
          >
            {t("addPartner")}
          </AddButton>
        }
      >
        {identity.fundingPartners.length === 0 ? (
          <EmptyList>{t("noPartners")}</EmptyList>
        ) : (
          <SortableList
            ids={identity.fundingPartners.map((p) => p.id)}
            onMove={(from, to) =>
              patch((d) => {
                d.identity.fundingPartners = move(d.identity.fundingPartners, from, to);
                return d;
              })
            }
          >
            {identity.fundingPartners.map((partner) => (
              <ListRow
                key={partner.id}
                id={partner.id}
                removeLabel={t("removePartner")}
                onRemove={() =>
                  patch((d) => {
                    d.identity.fundingPartners = d.identity.fundingPartners.filter(
                      (p) => p.id !== partner.id,
                    );
                    return d;
                  })
                }
              >
                <Input
                  aria-label={t("partnerName")}
                  className="bg-background"
                  maxLength={LIMITS.partnerName}
                  value={partner.name}
                  placeholder={t("partnerPlaceholder")}
                  aria-invalid={!partner.name.trim() || undefined}
                  onChange={(e) =>
                    patch((d) => {
                      const row = d.identity.fundingPartners.find((p) => p.id === partner.id);
                      if (row) row.name = e.target.value;
                      return d;
                    })
                  }
                />
              </ListRow>
            ))}
          </SortableList>
        )}
      </FieldGroup>

      <UploadField
        label={t("shareImageLabel")}
        hint={t("shareImageHint")}
        kind="shareImage"
        optional
        value={identity.assets.shareImage || null}
        onChange={(url) =>
          patch((d) => {
            d.identity.assets.shareImage = url ?? "";
            return d;
          })
        }
      />
    </SectionShell>
  );
}
