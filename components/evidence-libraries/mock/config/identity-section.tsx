"use client";

import { Copy, Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { newId } from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import {
  AddButton,
  EmptyList,
  ListRow,
  move,
  ReadOnlyValue,
  SubHeading,
  UploadField,
} from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const NAME_MAX = 100;
const TAGLINE_MAX = 120;
const DESCRIPTION_MAX = 300;
const PARTNERS_MAX = 20;

export function IdentitySection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.identity");
  const identity = library.draft.identity;
  const address = `https://${library.address}`;

  function copyAddress() {
    navigator.clipboard?.writeText(address).catch(() => {});
    toast.success(t("copied"), { description: address });
  }

  return (
    <SectionShell sectionKey="identity" icon={Globe} description={t("description")} library={library}>
      <Field
        label={t("nameLabel")}
        counter={`${identity.name.length} / ${NAME_MAX}`}
        error={!identity.name.trim() ? t("nameError") : null}
      >
        {(id, invalid) => (
          <Input
            id={id}
            maxLength={NAME_MAX}
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
        <Field label={t("shortNameLabel")} hint={t("shortNameHint")}>
          {(id) => (
            <ReadOnlyValue id={id} value={identity.shortName} />
          )}
        </Field>
        <Field label={t("addressLabel")} hint={t("addressHint")}>
          {(id) => (
            <div className="flex min-w-0 gap-1.5">
              <ReadOnlyValue id={id} value={address} className="min-w-0 flex-1" />
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
        counter={`${identity.tagline.length} / ${TAGLINE_MAX}`}
      >
        {(id) => (
          <Input
            id={id}
            maxLength={TAGLINE_MAX}
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
        counter={`${identity.description.length} / ${DESCRIPTION_MAX}`}
      >
        {(id) => (
          <Textarea
            id={id}
            maxLength={DESCRIPTION_MAX}
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

      <div className="space-y-3">
        <SubHeading
          action={
            <AddButton
              disabled={identity.fundingPartners.length >= PARTNERS_MAX}
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
          {t("partnersHeading")}
        </SubHeading>
        <p className="text-xs text-muted-foreground">{t("partnersHint", { max: PARTNERS_MAX })}</p>
        {identity.fundingPartners.length === 0 ? (
          <EmptyList>{t("noPartners")}</EmptyList>
        ) : (
          <div className="space-y-2">
            {identity.fundingPartners.map((partner, index) => (
              <ListRow
                key={partner.id}
                index={index}
                count={identity.fundingPartners.length}
                removeLabel={t("removePartner")}
                onMove={(from, to) =>
                  patch((d) => {
                    d.identity.fundingPartners = move(d.identity.fundingPartners, from, to);
                    return d;
                  })
                }
                onRemove={() =>
                  patch((d) => {
                    d.identity.fundingPartners = d.identity.fundingPartners.filter((p) => p.id !== partner.id);
                    return d;
                  })
                }
              >
                <Input
                  aria-label={t("partnerName")}
                  className="bg-background"
                  value={partner.name}
                  placeholder={t("partnerPlaceholder")}
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
          </div>
        )}
      </div>

      <UploadField
        label={t("shareImageLabel")}
        hint={t("shareImageHint")}
        kind="shareImage"
        optional
        slot={`${library.id}:shareImage`}
        value={identity.shareImage}
        onChange={(file) =>
          patch((d) => {
            d.identity.shareImage = file;
            return d;
          })
        }
      />
    </SectionShell>
  );
}
