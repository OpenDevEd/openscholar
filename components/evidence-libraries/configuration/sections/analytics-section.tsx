"use client";

import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HTTPS_URL } from "@/lib/evidence-libraries/configuration/links";
import {
  ANALYTICS_PROVIDERS,
  isPosthogKey,
  MEASUREMENT_ID,
} from "@/lib/evidence-libraries/configuration/rules";
import { Field } from "../section-card";
import { ChoiceCards } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";

export function AnalyticsSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.analytics");
  const analytics = draft.analytics;

  return (
    <SectionShell
      sectionKey="analytics"
      icon={BarChart3}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <div className="space-y-1.5">
        <div className="flex min-h-5 items-center">
          <Label className="font-normal">{t("providerLabel")}</Label>
        </div>
        <ChoiceCards
          columns={3}
          value={analytics.provider}
          ariaLabel={t("providerLabel")}
          onChange={(provider) =>
            patch((d) => {
              d.analytics.provider = provider;
              return d;
            })
          }
          options={ANALYTICS_PROVIDERS.map((provider) => ({
            value: provider,
            label: t(`provider.${provider}`),
            hint: t(`providerHint.${provider}`),
          }))}
        />
      </div>

      {analytics.provider === "posthog" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("hostLabel")}
            hint={t("hostHint")}
            error={!HTTPS_URL.test(analytics.posthog.host) ? t("hostError") : null}
          >
            {(id, invalid) => (
              <Input
                id={id}
                className="bg-background font-mono text-sm"
                value={analytics.posthog.host}
                placeholder="https://"
                aria-invalid={invalid || undefined}
                onChange={(e) =>
                  patch((d) => {
                    d.analytics.posthog.host = e.target.value;
                    return d;
                  })
                }
              />
            )}
          </Field>
          <Field
            label={t("keyLabel")}
            hint={t("keyHint")}
            error={!isPosthogKey(analytics.posthog.key) ? t("keyError") : null}
          >
            {(id, invalid) => (
              <Input
                id={id}
                className="bg-background font-mono text-sm"
                value={analytics.posthog.key}
                placeholder="phc_"
                autoComplete="off"
                aria-invalid={invalid || undefined}
                onChange={(e) =>
                  patch((d) => {
                    d.analytics.posthog.key = e.target.value.trim();
                    return d;
                  })
                }
              />
            )}
          </Field>
        </div>
      ) : null}

      {analytics.provider === "google" ? (
        <Field
          label={t("measurementIdLabel")}
          hint={t("measurementIdHint")}
          className="max-w-xs"
          error={!MEASUREMENT_ID.test(analytics.google.measurementId) ? t("measurementIdError") : null}
        >
          {(id, invalid) => (
            <Input
              id={id}
              className="bg-background font-mono text-sm"
              value={analytics.google.measurementId}
              placeholder="G-XXXXXXXXXX"
              aria-invalid={invalid || undefined}
              onChange={(e) =>
                patch((d) => {
                  d.analytics.google.measurementId = e.target.value.trim().toUpperCase();
                  return d;
                })
              }
            />
          )}
        </Field>
      ) : null}
    </SectionShell>
  );
}
