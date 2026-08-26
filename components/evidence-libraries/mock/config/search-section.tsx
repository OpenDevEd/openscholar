"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CURRENT_YEAR,
  type InstitutionFacetMode,
  SEARCH_SCOPES,
  type SearchScope,
} from "@/lib/evidence-libraries/mock/config";
import { cn } from "@/lib/utils";
import { Field } from "../section-card";
import { FieldError, SubHeading, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const INSTITUTION_MODES: InstitutionFacetMode[] = ["hidden", "facet", "facet-with-featured-value"];
const YEAR_MIN = 1900;

export function SearchSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.search");
  const search = library.draft.search;
  const featuredMode = search.institutionMode === "facet-with-featured-value";

  function setScopes(scopes: SearchScope[]) {
    patch((d) => {
      d.search.scopes = scopes;
      return d;
    });
  }

  return (
    <SectionShell sectionKey="search" icon={Search} description={t("description")} library={library}>
      <div className="space-y-2">
        <SubHeading>{t("whatHeading")}</SubHeading>
        <ToggleRow
          label={t("fullText")}
          hint={t("fullTextHint")}
          checked={search.fullText}
          onChange={(checked) =>
            patch((d) => {
              d.search.fullText = checked;
              if (!checked) {
                d.search.scopes = d.search.scopes.filter((s) => s !== "documents");
              }
              return d;
            })
          }
        />
        <ToggleRow
          label={t("tags")}
          hint={t("tagsHint")}
          checked={search.tags}
          onChange={(checked) =>
            patch((d) => {
              d.search.tags = checked;
              return d;
            })
          }
        />
        <ToggleRow
          label={t("country")}
          hint={t("countryHint")}
          checked={search.country}
          onChange={(checked) =>
            patch((d) => {
              d.search.country = checked;
              return d;
            })
          }
        />
        <ToggleRow
          label={t("authorCountry")}
          hint={t("authorCountryHint")}
          checked={search.authorCountry}
          onChange={(checked) =>
            patch((d) => {
              d.search.authorCountry = checked;
              return d;
            })
          }
        />
      </div>

      <div className="space-y-3">
        <SubHeading>{t("scopesHeading")}</SubHeading>
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("scopesHeading")}>
            {SEARCH_SCOPES.map((scope) => {
              const checked = search.scopes.includes(scope);
              const disabled = scope === "documents" && !search.fullText;
              return (
                <Label
                  key={scope}
                  data-scope={scope}
                  data-checked={checked}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-normal transition-all",
                    disabled
                      ? "cursor-not-allowed border-border/40 opacity-60"
                      : checked
                        ? "cursor-pointer border-primary/40 bg-primary/5"
                        : "cursor-pointer border-border/50 hover:border-border/80 hover:bg-muted/30",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) =>
                      setScopes(
                        next === true
                          ? SEARCH_SCOPES.filter((s) => s === scope || search.scopes.includes(s))
                          : search.scopes.filter((s) => s !== scope),
                      )
                    }
                  />
                  <span>{t(`scope.${scope}`)}</span>
                </Label>
              );
            })}
          </div>
          {search.scopes.length === 0 ? (
            <FieldError>{t("scopesError")}</FieldError>
          ) : !search.fullText ? (
            <p className="text-xs text-muted-foreground">{t("documentsNeedsFullText")}</p>
          ) : null}
        </div>
        <Field
          label={t("defaultScope")}
          hint={t("defaultScopeHint")}
          className="max-w-sm"
          error={!search.scopes.includes(search.defaultScope) ? t("defaultScopeError") : null}
        >
          {(id) => (
            <Select
              value={search.scopes.includes(search.defaultScope) ? search.defaultScope : undefined}
              disabled={search.scopes.length === 0}
              onValueChange={(value) =>
                patch((d) => {
                  d.search.defaultScope = value as SearchScope;
                  return d;
                })
              }
            >
              <SelectTrigger id={id} className="w-full bg-background">
                <SelectValue placeholder={t("defaultScopePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {search.scopes.map((scope) => (
                  <SelectItem key={scope} value={scope}>
                    {t(`scope.${scope}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>

      <div className="space-y-3">
        <SubHeading>{t("filtersHeading")}</SubHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("institutionMode")} hint={t("institutionModeHint")}>
            {(id) => (
              <Select
                value={search.institutionMode}
                onValueChange={(value) =>
                  patch((d) => {
                    d.search.institutionMode = value as InstitutionFacetMode;
                    return d;
                  })
                }
              >
                <SelectTrigger id={id} className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSTITUTION_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`institutionModes.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {search.institutionMode !== "hidden" ? (
            <Field label={t("institutionLabel")} hint={t("institutionLabelHint")}>
              {(id) => (
                <Input
                  id={id}
                  className="bg-background"
                  value={search.institutionLabel}
                  placeholder={t("institutionLabelPlaceholder")}
                  onChange={(e) =>
                    patch((d) => {
                      d.search.institutionLabel = e.target.value;
                      return d;
                    })
                  }
                />
              )}
            </Field>
          ) : null}
        </div>
        {featuredMode ? (
          <Field
            label={t("featuredInstitution")}
            hint={t("featuredInstitutionHint")}
            className="max-w-sm"
            error={!search.featuredInstitution.trim() ? t("featuredInstitutionError") : null}
          >
            {(id, invalid) => (
              <Input
                id={id}
                className="bg-background"
                value={search.featuredInstitution}
                aria-invalid={invalid || undefined}
                onChange={(e) =>
                  patch((d) => {
                    d.search.featuredInstitution = e.target.value;
                    return d;
                  })
                }
              />
            )}
          </Field>
        ) : null}

        <ToggleRow
          label={t("years")}
          hint={t("yearsHint")}
          checked={search.yearsEnabled}
          onChange={(checked) =>
            patch((d) => {
              d.search.yearsEnabled = checked;
              return d;
            })
          }
        />
        {search.yearsEnabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <YearField
              label={t("yearMin")}
              value={search.yearMin}
              error={search.yearMin > search.yearMax ? t("yearsError") : null}
              onChange={(year) =>
                patch((d) => {
                  d.search.yearMin = year;
                  return d;
                })
              }
            />
            <YearField
              label={t("yearMax")}
              value={search.yearMax}
              error={null}
              onChange={(year) =>
                patch((d) => {
                  d.search.yearMax = year;
                  return d;
                })
              }
            />
          </div>
        ) : null}

        <ToggleRow
          label={t("collectionsExpanded")}
          hint={t("collectionsExpandedHint")}
          checked={search.collectionsExpanded}
          onChange={(checked) =>
            patch((d) => {
              d.search.collectionsExpanded = checked;
              return d;
            })
          }
        />
      </div>
    </SectionShell>
  );
}

function YearField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: number;
  error: string | null;
  onChange: (year: number) => void;
}) {
  return (
    <Field label={label} error={error}>
      {(id, invalid) => (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={YEAR_MIN}
          max={CURRENT_YEAR}
          className="bg-background font-mono text-sm"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isInteger(next)) onChange(next);
          }}
          onBlur={() => onChange(Math.min(CURRENT_YEAR, Math.max(YEAR_MIN, value)))}
        />
      )}
    </Field>
  );
}
