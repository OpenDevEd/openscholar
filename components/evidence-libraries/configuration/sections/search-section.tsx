"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Segmented } from "@/components/settings/parts";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type FiltersDraft,
  INSTITUTION_MODES,
  type InstitutionMode,
  SCHEMA_LIMITS,
  SEARCH_SCOPES,
  type SearchDraft,
  type SearchScope,
  settleFeatures,
} from "@/lib/evidence-libraries/configuration/rules";
import { Field, FieldError } from "../section-card";
import { ChoiceChips, FieldGroup, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { FeaturedInstitutionPicker } from "./institution-pickers";
import { MOCK_TAG_FILTERS, TagFiltersField } from "./tag-filters-field";
import { SearchIcon } from "@/components/icons";

export function SearchSection({
  libraryId,
  draft,
  saved,
  patch,
  reset,
}: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.search");
  const { search, filters } = draft;
  const featuredMode = filters.institution.mode === "facet-with-featured-value";
  // MOCK (tag filters): kept in this page and never saved; the real build reads and writes `filters.collectionsMatch`.
  const [collectionsMatch, setCollectionsMatch] = useState(() =>
    MOCK_TAG_FILTERS[libraryId] ? { default: "any" as "any" | "all", readerSwitch: true } : { default: "all" as "any" | "all", readerSwitch: false },
  );

  // Some features need a search option or filter; they switch off with it.
  const setSearch = <K extends keyof SearchDraft>(
    key: K,
    value: SearchDraft[K],
  ) =>
    patch((d) => {
      d.search[key] = value;
      return settleFeatures(d);
    });
  const setFilters = (update: (filters: FiltersDraft) => void) =>
    patch((d) => {
      update(d.filters);
      return settleFeatures(d);
    });

  return (
    <SectionShell
      sectionKey="search"
      icon={SearchIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <FieldGroup title={t("whatHeading")}>
        <ToggleRow
          label={t("fullText")}
          hint={t("fullTextHint")}
          checked={search.fullText}
          data-search-full-text
          onChange={(checked) =>
            patch((d) => {
              d.search.fullText = checked;
              // Full text off: the runtime rejects the documents scope.
              if (!checked)
                d.search.scopes = d.search.scopes.filter(
                  (s) => s !== "documents",
                );
              return d;
            })
          }
        />
        <ToggleRow
          label={t("tags")}
          hint={t("tagsHint")}
          checked={search.tags}
          onChange={(v) => setSearch("tags", v)}
        />
        <ToggleRow
          label={t("country")}
          hint={t("countryHint")}
          checked={search.country}
          onChange={(v) => setSearch("country", v)}
        />
      </FieldGroup>

      <FieldGroup title={t("scopesHeading")}>
        <div className="space-y-1.5">
          <ChoiceChips
            ariaLabel={t("scopesHeading")}
            values={search.scopes}
            onChange={(scopes) => setSearch("scopes", scopes)}
            options={SEARCH_SCOPES.map((scope) => {
              const disabled = scope === "documents" && !search.fullText;
              return {
                value: scope,
                label: t(`scope.${scope}`),
                disabled,
                disabledReason: disabled
                  ? t("documentsNeedsFullText")
                  : undefined,
              };
            })}
          />
          {search.scopes.length === 0 ? (
            <FieldError>{t("scopesError")}</FieldError>
          ) : null}
        </div>
        <Field
          label={t("defaultScope")}
          hint={t("defaultScopeHint")}
          className="max-w-sm"
          error={
            search.scopes.length > 0 &&
            !search.scopes.includes(search.defaultScope)
              ? t("defaultScopeError")
              : null
          }
        >
          {(id) => (
            <Select
              value={
                search.scopes.includes(search.defaultScope)
                  ? search.defaultScope
                  : undefined
              }
              disabled={search.scopes.length === 0}
              onValueChange={(value) =>
                setSearch("defaultScope", value as SearchScope)
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
        <ToggleRow
          label={t("topics")}
          hint={t("topicsHint")}
          checked={draft.topics.enabled}
          onChange={(enabled) =>
            patch((next) => {
              next.topics.enabled = enabled;
              return next;
            })
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("institutionMode")} hint={t("institutionModeHint")}>
            {(id) => (
              <Select
                value={filters.institution.mode}
                onValueChange={(value) =>
                  setFilters((f) => {
                    f.institution.mode = value as InstitutionMode;
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
          {filters.institution.mode !== "hidden" ? (
            <Field
              label={t("institutionLabel")}
              hint={t("institutionLabelHint")}
            >
              {(id) => (
                <Input
                  id={id}
                  className="bg-background"
                  maxLength={SCHEMA_LIMITS.filters.institutionLabel}
                  value={filters.institution.label}
                  onChange={(e) =>
                    setFilters((f) => {
                      f.institution.label = e.target.value;
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
            error={
              !filters.institution.featuredValue.trim()
                ? t("featuredInstitutionError")
                : null
            }
          >
            {(id) => (
              <FeaturedInstitutionPicker
                id={id}
                libraryId={libraryId}
                value={filters.institution.featuredValue || undefined}
                onChange={(value) =>
                  setFilters((f) => {
                    f.institution.featuredValue = value ?? "";
                  })
                }
              />
            )}
          </Field>
        ) : null}

        <ToggleRow
          label={t("sourcesFilter")}
          hint={t("sourcesFilterHint")}
          checked={filters.sources.enabled}
          onChange={(checked) =>
            setFilters((f) => {
              f.sources.enabled = checked;
            })
          }
        />
        {filters.sources.enabled ? (
          <Field
            label={t("sourcesLabel")}
            hint={t("sourcesLabelHint")}
            className="max-w-sm"
            error={!filters.sources.label.trim() ? t("sourcesLabelError") : null}
          >
            {(id) => (
              <Input
                id={id}
                className="bg-background"
                maxLength={SCHEMA_LIMITS.filters.sourcesLabel}
                value={filters.sources.label}
                onChange={(e) =>
                  setFilters((f) => {
                    f.sources.label = e.target.value;
                  })
                }
              />
            )}
          </Field>
        ) : null}

        <ToggleRow
          label={t("years")}
          hint={t("yearsHint")}
          checked={filters.years.enabled}
          onChange={(checked) =>
            setFilters((f) => {
              f.years.enabled = checked;
            })
          }
        />

        <ToggleRow
          label={t("collectionsExpanded")}
          hint={t("collectionsExpandedHint")}
          checked={filters.collectionsExpanded}
          onChange={(checked) =>
            setFilters((f) => {
              f.collectionsExpanded = checked;
            })
          }
        />

        <Field label={t("collectionsMatch")} hint={t("collectionsMatchHint")}>
          {() => (
            <Segmented
              fill
              label={t("collectionsMatch")}
              value={collectionsMatch.default}
              onChange={(value) => setCollectionsMatch((current) => ({ ...current, default: value }))}
              options={[
                { id: "any", label: t("collectionsMatchAny"), below: <span className="text-xs font-normal text-muted-foreground">{t("collectionsMatchAnyDetail")}</span> },
                { id: "all", label: t("collectionsMatchAll"), below: <span className="text-xs font-normal text-muted-foreground">{t("collectionsMatchAllDetail")}</span> },
              ]}
            />
          )}
        </Field>
        <ToggleRow
          label={t("collectionsMatchSwitch")}
          hint={t("collectionsMatchSwitchHint")}
          checked={collectionsMatch.readerSwitch}
          onChange={(readerSwitch) => setCollectionsMatch((current) => ({ ...current, readerSwitch }))}
        />

        <ToggleRow
          label={t("uncertainStudyTypes")}
          hint={t("uncertainStudyTypesHint")}
          checked={filters.uncertainStudyTypes === "separate"}
          onChange={(checked) =>
            setFilters((f) => {
              f.uncertainStudyTypes = checked ? "separate" : "marked";
            })
          }
        />
      </FieldGroup>

      <TagFiltersField libraryId={libraryId} />
    </SectionShell>
  );
}
