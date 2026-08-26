"use client";

import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { LibraryConfig } from "@/lib/evidence-libraries/mock/config";
import { Field, InlineNotice } from "../section-card";
import { SectionShell, type SectionProps } from "./section-shell";

type Analytics = LibraryConfig["analytics"];
type Provider = Analytics["provider"];

const PROVIDERS: Provider[] = ["none", "posthog", "google"];

function emptyFor(provider: Provider): Analytics {
  switch (provider) {
    case "posthog":
      return { provider, host: "https://eu.i.posthog.com", key: "" };
    case "google":
      return { provider, measurementId: "" };
    default:
      return { provider: "none" };
  }
}

export function AnalyticsSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.analytics");
  const analytics = library.draft.analytics;

  return (
    <SectionShell sectionKey="analytics" icon={BarChart3} description={t("description")} library={library}>
      <div className="space-y-1.5">
        <div className="flex min-h-5 items-center"><Label className="font-normal">{t("providerLabel")}</Label></div>
        <RadioGroup
          value={analytics.provider}
          className="gap-2"
          onValueChange={(provider) =>
            patch((d) => {
              d.analytics = emptyFor(provider as Provider);
              return d;
            })
          }
        >
          {PROVIDERS.map((provider) => (
            <Label key={provider} className="flex items-center gap-2 font-normal">
              <RadioGroupItem value={provider} />
              {t(`provider.${provider}`)}
            </Label>
          ))}
        </RadioGroup>
      </div>

      {analytics.provider === "posthog" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("hostLabel")} hint={t("hostHint")} error={!analytics.host.trim() ? t("hostError") : null}>
            {(id, invalid) => (
              <Input
                id={id}
                className="bg-background font-mono text-sm"
                value={analytics.host}
                aria-invalid={invalid || undefined}
                onChange={(e) =>
                  patch((d) => {
                    if (d.analytics.provider === "posthog") d.analytics.host = e.target.value;
                    return d;
                  })
                }
              />
            )}
          </Field>
          <Field
            label={t("keyLabel")}
            hint={t("keyHint")}
            error={!/^phc_/.test(analytics.key) ? t("keyError") : null}
          >
            {(id, invalid) => (
              <Input
                id={id}
                className="bg-background font-mono text-sm"
                value={analytics.key}
                placeholder="phc_…"
                autoComplete="off"
                aria-invalid={invalid || undefined}
                onChange={(e) =>
                  patch((d) => {
                    if (d.analytics.provider === "posthog") d.analytics.key = e.target.value;
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
          error={!/^G-[A-Z0-9]{4,20}$/.test(analytics.measurementId) ? t("measurementIdError") : null}
        >
          {(id, invalid) => (
            <Input
              id={id}
              className="bg-background font-mono text-sm"
              value={analytics.measurementId}
              placeholder="G-XXXXXXXXXX"
              aria-invalid={invalid || undefined}
              onChange={(e) =>
                patch((d) => {
                  if (d.analytics.provider === "google") d.analytics.measurementId = e.target.value.toUpperCase();
                  return d;
                })
              }
            />
          )}
        </Field>
      ) : null}

      <InlineNotice tone="info" data-gdpr="always-on">
        {t("gdprNotice")}
      </InlineNotice>
    </SectionShell>
  );
}
