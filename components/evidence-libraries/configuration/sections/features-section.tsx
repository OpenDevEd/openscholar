"use client";

import { useTranslations } from "next-intl";
import {
  FEATURE_GROUPS,
  type FeatureBlock,
  featureBlock,
  settleFeatures,
  type ShownFeature,
} from "@/lib/evidence-libraries/configuration/rules";
import { FieldGroup, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { SwitchesIcon } from "@/components/section-icons";

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
    </SectionShell>
  );
}
