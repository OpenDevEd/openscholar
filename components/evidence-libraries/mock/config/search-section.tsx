"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CURRENT_YEAR,
  type InstitutionFacetMode,
  SEARCH_SCOPES,
  type SearchScope,
} from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import { ChoiceChips, FieldError, FieldGroup, ToggleRow } from "./fields";
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
      <FieldGroup title={t("whatHeading")}>
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
      </FieldGroup>

      <FieldGroup title={t("scopesHeading")}>
        <div className="space-y-1.5">
          <ChoiceChips
            ariaLabel={t("scopesHeading")}
            values={search.scopes}
            onChange={setScopes}
            options={SEARCH_SCOPES.map((scope) => {
              const disabled = scope === "documents" && !search.fullText;
              return {
                value: scope,
                label: t(`scope.${scope}`),
                disabled,
                disabledReason: disabled ? t("documentsNeedsFullText") : undefined,
              };
            })}
          />
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
      </FieldGroup>

      <FieldGroup title={t("filtersHeading")}>
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
              <Select
                value={search.featuredInstitution || undefined}
                disabled={library.recordInstitutions.length === 0}
                onValueChange={(value) =>
                  patch((d) => {
                    d.search.featuredInstitution = value;
                    return d;
                  })
                }
              >
                <SelectTrigger id={id} className="w-full bg-background" aria-invalid={invalid || undefined}>
                  <SelectValue
                    placeholder={
                      library.recordInstitutions.length === 0 ? t("noRecordInstitutions") : t("pickInstitution")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {library.recordInstitutions.map((inst) => (
                    <SelectItem key={inst.name} value={inst.name}>
                      <span className="flex items-center gap-2">
                        {inst.name}
                        <span className="font-mono text-xs text-muted-foreground">{inst.count}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
      </FieldGroup>
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
