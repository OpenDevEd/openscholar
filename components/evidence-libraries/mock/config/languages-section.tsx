"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MOCK_LANGUAGES } from "@/lib/evidence-libraries/mock/data";
import { Field, FieldError } from "../section-card";
import { EmptyList, ListRow, move, SubHeading, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const languageName = (code: string) => MOCK_LANGUAGES.find((l) => l.code === code)?.name ?? code;

export function LanguagesSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.languages");
  const tc = useTranslations("evidenceLibraryMock.config");
  const localization = library.draft.localization;
  const priority = localization.priority.filter((code) => localization.locales.includes(code));

  function toggleLocale(code: string, on: boolean) {
    patch((d) => {
      const loc = d.localization;
      if (on) {
        // Keep the catalog order for the chosen list; append to priority.
        loc.locales = MOCK_LANGUAGES.filter((l) => l.code === code || loc.locales.includes(l.code)).map(
          (l) => l.code,
        );
        if (!loc.priority.includes(code)) loc.priority.push(code);
        if (!loc.defaultLocale) loc.defaultLocale = code;
      } else {
        loc.locales = loc.locales.filter((c) => c !== code);
        loc.priority = loc.priority.filter((c) => c !== code);
        if (loc.defaultLocale === code) loc.defaultLocale = loc.locales[0] ?? "";
      }
      return d;
    });
  }

  return (
    <SectionShell sectionKey="languages" icon={Languages} description={t("description")} library={library}>
      <div className="space-y-1.5">
        <Label>{tc("availableLanguages")}</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label={tc("availableLanguages")}>
          {MOCK_LANGUAGES.map((lang) => {
            const checked = localization.locales.includes(lang.code);
            return (
              <Label
                key={lang.code}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-normal transition-all",
                  checked
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/50 hover:border-border/80 hover:bg-muted/30",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => toggleLocale(lang.code, next === true)}
                />
                <code className="text-xs font-mono text-muted-foreground">{lang.code}</code>
                <span>{lang.name}</span>
              </Label>
            );
          })}
        </div>
        {localization.locales.length === 0 ? <FieldError>{tc("languagesError")}</FieldError> : null}
      </div>

      <Field label={tc("defaultLanguage")} hint={tc("defaultLanguageHint")} className="max-w-xs">
        {(id) => (
          <Select
            value={localization.defaultLocale || undefined}
            disabled={localization.locales.length === 0}
            onValueChange={(defaultLocale) =>
              patch((d) => {
                d.localization.defaultLocale = defaultLocale;
                return d;
              })
            }
          >
            <SelectTrigger id={id} className="w-full bg-background">
              <SelectValue placeholder={tc("selectLanguageFirst")} />
            </SelectTrigger>
            <SelectContent>
              {localization.locales.map((code) => (
                <SelectItem key={code} value={code}>
                  {code} — {languageName(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <ToggleRow
        label={t("detectLabel")}
        hint={t("detectHint")}
        checked={localization.detect}
        onChange={(detect) =>
          patch((d) => {
            d.localization.detect = detect;
            return d;
          })
        }
      />

      <div className="space-y-3">
        <SubHeading>{t("priorityHeading")}</SubHeading>
        <p className="text-xs text-muted-foreground">{t("priorityHint")}</p>
        {priority.length === 0 ? (
          <EmptyList>{t("priorityEmpty")}</EmptyList>
        ) : (
          <ol className="space-y-2" aria-label={t("priorityHeading")}>
            {priority.map((code, index) => (
              <li key={code}>
                <ListRow
                  index={index}
                  count={priority.length}
                  hideRemove
                  removeLabel=""
                  onRemove={() => {}}
                  className="items-center py-2"
                  onMove={(from, to) =>
                    patch((d) => {
                      d.localization.priority = move(priority, from, to);
                      return d;
                    })
                  }
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-xs font-mono text-muted-foreground">{index + 1}.</span>
                    <code className="text-xs font-mono text-muted-foreground">{code}</code>
                    <span>{languageName(code)}</span>
                  </div>
                </ListRow>
              </li>
            ))}
          </ol>
        )}
      </div>
    </SectionShell>
  );
}
