"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Locale, LOCALES, settleFeatures } from "@/lib/evidence-libraries/configuration/rules";
import { Field, FieldError } from "../section-card";
import { ChoiceChips, EmptyList, FieldGroup, ListRow, move, SortableList, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { LanguagesIcon } from "@/components/section-icons";

export function LanguagesSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.languages");
  const localization = draft.localization;
  const name = (code: Locale) => t(`names.${code}`);

  function setLocales(next: Locale[]) {
    patch((d) => {
      const loc = d.localization;
      // Keep the catalogue order for the offered list; new ones join the end of the priority list.
      loc.locales = LOCALES.filter((code) => next.includes(code));
      loc.localePriority = [
        ...loc.localePriority.filter((code) => loc.locales.includes(code)),
        ...loc.locales.filter((code) => !loc.localePriority.includes(code)),
      ];
      if (!loc.locales.includes(loc.defaultLocale) && loc.locales[0]) loc.defaultLocale = loc.locales[0];
      return settleFeatures(d);
    });
  }

  return (
    <SectionShell
      sectionKey="languages"
      icon={LanguagesIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <div className="space-y-1.5">
        <div className="flex min-h-5 items-center">
          <Label className="font-normal">{t("availableLabel")}</Label>
        </div>
        <ChoiceChips
          ariaLabel={t("availableLabel")}
          values={localization.locales}
          onChange={setLocales}
          options={LOCALES.map((code) => ({ value: code, code, label: name(code) }))}
        />
        {localization.locales.length === 0 ? <FieldError>{t("noneError")}</FieldError> : null}
      </div>

      <Field label={t("defaultLabel")} hint={t("defaultHint")} className="max-w-xs">
        {(id) => (
          <Select
            value={localization.locales.includes(localization.defaultLocale) ? localization.defaultLocale : undefined}
            disabled={localization.locales.length === 0}
            onValueChange={(code) =>
              patch((d) => {
                d.localization.defaultLocale = code as Locale;
                return d;
              })
            }
          >
            <SelectTrigger id={id} className="w-full bg-background">
              <SelectValue placeholder={t("selectFirst")} />
            </SelectTrigger>
            <SelectContent>
              {localization.locales.map((code) => (
                <SelectItem key={code} value={code}>
                  {name(code)}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{code}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <ToggleRow
        label={t("detectLabel")}
        hint={t("detectHint")}
        checked={localization.detectLocale}
        onChange={(detectLocale) =>
          patch((d) => {
            d.localization.detectLocale = detectLocale;
            return d;
          })
        }
      />

      <FieldGroup title={t("priorityHeading")} hint={t("priorityHint")}>
        {localization.localePriority.length === 0 ? (
          <EmptyList>{t("priorityEmpty")}</EmptyList>
        ) : (
          <SortableList
            ids={localization.localePriority}
            onMove={(from, to) =>
              patch((d) => {
                d.localization.localePriority = move(d.localization.localePriority, from, to);
                return d;
              })
            }
          >
            {localization.localePriority.map((code, index) => (
              <ListRow
                key={code}
                id={code}
                hideRemove
                removeLabel=""
                onRemove={() => undefined}
                className="items-center py-2"
                data-locale={code}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-5 font-mono text-xs text-muted-foreground">{index + 1}.</span>
                  <code className="font-mono text-xs text-muted-foreground">{code}</code>
                  <span>{name(code)}</span>
                </div>
              </ListRow>
            ))}
          </SortableList>
        )}
      </FieldGroup>
    </SectionShell>
  );
}
