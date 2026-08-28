"use client";

import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { HTTPS_URL } from "@/lib/evidence-libraries/configuration/links";
import {
  type AnalyticsDraft,
  CONSENT_POLICY_VERSION_DEFAULT,
  isPosthogKey,
  MEASUREMENT_ID,
} from "@/lib/evidence-libraries/configuration/rules";
import { Field } from "../section-card";
import { FieldGroup, Panel, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";

/** PostHog and Google Analytics are independent; both may be on at once. */
export function AnalyticsSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.analytics");
  const analytics = draft.analytics;

  const set = <
    P extends keyof AnalyticsDraft,
    K extends keyof AnalyticsDraft[P],
  >(
    provider: P,
    key: K,
    value: AnalyticsDraft[P][K],
  ) =>
    patch((d) => {
      d.analytics[provider][key] = value;
      return d;
    });

  return (
    <SectionShell
      sectionKey="analytics"
      icon={BarChart3}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <FieldGroup
        title={t("posthogLabel")}
        data-analytics="posthog"
        data-enabled={analytics.posthog.enabled}
      >
        <ToggleRow
          label={t("posthogLabel")}
          hint={t("posthogHint")}
          checked={analytics.posthog.enabled}
          onChange={(enabled) => set("posthog", "enabled", enabled)}
        />
        {analytics.posthog.enabled ? (
          <Panel tone="muted" className="ml-4 grid gap-4 sm:grid-cols-2">
            <Field
              label={t("hostLabel")}
              hint={t("hostHint")}
              error={
                !HTTPS_URL.test(analytics.posthog.host) ? t("hostError") : null
              }
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
                      // A session recordings address is meaningless without a
                      // host, so it goes when the host stops being one.
                      if (!HTTPS_URL.test(e.target.value)) {
                        d.analytics.posthog.uiHost = "";
                      }
                      return d;
                    })
                  }
                />
              )}
            </Field>
            <Field
              label={t("keyLabel")}
              hint={t("keyHint")}
              error={
                !isPosthogKey(analytics.posthog.key) ? t("keyError") : null
              }
            >
              {(id, invalid) => (
                <Input
                  id={id}
                  className="bg-background font-mono text-sm"
                  value={analytics.posthog.key}
                  placeholder="phc_"
                  autoComplete="off"
                  aria-invalid={invalid || undefined}
                  onChange={(e) => set("posthog", "key", e.target.value.trim())}
                />
              )}
            </Field>
            {HTTPS_URL.test(analytics.posthog.host) ? (
              <Field
                label={t("uiHostLabel")}
                hint={t("uiHostHint")}
                error={
                  analytics.posthog.uiHost !== "" &&
                  !HTTPS_URL.test(analytics.posthog.uiHost)
                    ? t("hostError")
                    : null
                }
              >
                {(id, invalid) => (
                  <Input
                    id={id}
                    className="bg-background font-mono text-sm"
                    value={analytics.posthog.uiHost}
                    placeholder="https://"
                    aria-invalid={invalid || undefined}
                    onChange={(e) => set("posthog", "uiHost", e.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </Panel>
        ) : null}
      </FieldGroup>

      <FieldGroup
        title={t("googleLabel")}
        data-analytics="google"
        data-enabled={analytics.google.enabled}
      >
        <ToggleRow
          label={t("googleLabel")}
          hint={t("googleHint")}
          checked={analytics.google.enabled}
          onChange={(enabled) => set("google", "enabled", enabled)}
        />
        {analytics.google.enabled ? (
          <Panel tone="muted" className="ml-4">
            <Field
              label={t("measurementIdLabel")}
              hint={t("measurementIdHint")}
              className="max-w-xs"
              error={
                !MEASUREMENT_ID.test(analytics.google.measurementId)
                  ? t("measurementIdError")
                  : null
              }
            >
              {(id, invalid) => (
                <Input
                  id={id}
                  className="bg-background font-mono text-sm"
                  value={analytics.google.measurementId}
                  placeholder="G-XXXXXXXXXX"
                  aria-invalid={invalid || undefined}
                  onChange={(e) =>
                    set(
                      "google",
                      "measurementId",
                      e.target.value.trim().toUpperCase(),
                    )
                  }
                />
              )}
            </Field>
          </Panel>
        ) : null}
      </FieldGroup>

      <FieldGroup title={t("consentLabel")} data-analytics="consent">
        <Field
          label={t("consentVersionLabel")}
          hint={t("consentVersionHint")}
          className="max-w-xs"
          error={
            !Number.isInteger(analytics.consentPolicyVersion) ||
            analytics.consentPolicyVersion < CONSENT_POLICY_VERSION_DEFAULT
              ? t("consentVersionError")
              : null
          }
        >
          {(id, invalid) => (
            <Input
              id={id}
              type="number"
              min={CONSENT_POLICY_VERSION_DEFAULT}
              step={1}
              className="bg-background font-mono text-sm"
              value={
                Number.isFinite(analytics.consentPolicyVersion)
                  ? analytics.consentPolicyVersion
                  : ""
              }
              aria-invalid={invalid || undefined}
              onChange={(e) =>
                patch((d) => {
                  d.analytics.consentPolicyVersion = Number(e.target.value);
                  return d;
                })
              }
            />
          )}
        </Field>
      </FieldGroup>
    </SectionShell>
  );
}
