"use client";

import { useTranslations } from "next-intl";
import {
  FEATURE_GROUPS,
  type FeatureBlock,
  featureBlock,
  OPEN_ACCESS_LABELS,
  type OpenAccessLabel,
  settleFeatures,
  type ShownFeature,
} from "@/lib/evidence-libraries/configuration/rules";
import { ChoiceCards, FieldGroup, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { Lock, LockOpen, SwitchesIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export function FeaturesSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.features");

  function reasonText(block: FeatureBlock | null) {
    if (!block) return null;
    switch (block.kind) {
      case "feature":
        return t("needs", { feature: t(`labels.${block.feature}`) });
      case "search":
        return t(`needsSearch.${block.option}`);
      case "years":
        return t("needsYears");
      case "exports":
        return t("needsExports");
      case "atom":
        return t("needsAtom");
      case "languages":
        return t("needsLanguages");
    }
  }

  function setFeature(feature: ShownFeature, checked: boolean) {
    patch((d) => {
      d.features[feature] = checked;
      return settleFeatures(d);
    });
  }

  return (
    <SectionShell
      sectionKey="features"
      icon={SwitchesIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      {FEATURE_GROUPS.map((group) => (
        <FieldGroup key={group.key} title={t(`groups.${group.key}`)} data-feature-group={group.key}>
          {group.features.map((feature) => {
            const reason = reasonText(featureBlock(draft, feature));
            return (
              <ToggleRow
                key={feature}
                data-feature={feature}
                label={t(`labels.${feature}`)}
                hint={t(`hints.${feature}`)}
                checked={draft.features[feature]}
                disabled={reason !== null}
                disabledReason={reason}
                onChange={(checked) => setFeature(feature, checked)}
              />
            );
          })}
        </FieldGroup>
      ))}
      <FieldGroup title={t("groups.openAccess")} data-feature-group="openAccess">
        <ChoiceCards
          value={draft.content.openAccessLabel}
          onChange={(openAccessLabel) =>
            patch((d) => {
              d.content.openAccessLabel = openAccessLabel;
              return d;
            })
          }
          columns={3}
          ariaLabel={t("groups.openAccess")}
          options={OPEN_ACCESS_LABELS.map((label) => ({
            value: label,
            label: t(`openAccess.options.${label}`),
            preview: <AccessLabelPreview label={label} />,
          }))}
        />
      </FieldGroup>
    </SectionShell>
  );
}

/** Two records, one open and one closed, as the library labels them under `label`. */
function AccessLabelPreview({ label }: { label: OpenAccessLabel }) {
  const t = useTranslations("evidenceLibraryConfiguration.features.openAccess");
  return (
    <span
      aria-hidden
      data-access-preview={label}
      className="flex h-16 w-full flex-col justify-center gap-2.5 overflow-hidden rounded-md border border-border-subtle bg-inset px-3"
    >
      {[true, false].map((open) => (
        <span key={String(open)} className="flex h-4 items-center gap-2">
          <span className="h-1.5 w-10 shrink-0 rounded-sm bg-foreground/60" />
          {label !== "off" && (open || label === "both") && (
            <span
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                open ? "ink-success" : "text-muted-foreground",
              )}
            >
              {open ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
              {t(open ? "open" : "closed")}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
