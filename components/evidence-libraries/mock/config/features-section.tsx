"use client";

import { ToggleRight } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  FEATURE_DEPENDENCIES,
  FEATURE_GROUPS,
  type FeatureKey,
  type LibraryConfig,
} from "@/lib/evidence-libraries/mock/config";
import { FieldGroup, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";


/** Every feature that needs `key`, directly or through another feature. */
function dependents(key: FeatureKey): FeatureKey[] {
  const out = new Set<FeatureKey>();
  const stack: FeatureKey[] = [key];
  while (stack.length) {
    const current = stack.pop() as FeatureKey;
    for (const [feature, deps] of Object.entries(FEATURE_DEPENDENCIES) as [FeatureKey, FeatureKey[]][]) {
      if (deps.includes(current) && !out.has(feature)) {
        out.add(feature);
        stack.push(feature);
      }
    }
  }
  return [...out];
}

type Block = { kind: "feature"; feature: FeatureKey } | { kind: "languages" | "exports" | "atom" };

/** Why a feature cannot be turned on right now, or null when it can. */
function blockedBy(key: FeatureKey, draft: LibraryConfig): Block | null {
  const missing = (FEATURE_DEPENDENCIES[key] ?? []).find((dep) => !draft.features[dep]);
  if (missing) return { kind: "feature", feature: missing };
  if (key === "languageSwitcher" && draft.localization.locales.length < 2) return { kind: "languages" };
  if (key === "downloads" && !draft.citations.ris && !draft.citations.bibtex) return { kind: "exports" };
  if (key === "atomFeed" && !draft.citations.atom) return { kind: "atom" };
  return null;
}

export function FeaturesSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.features");
  const draft = library.draft;
  const features = draft.features;

  function reasonText(block: Block | null) {
    if (!block) return null;
    if (block.kind === "feature") return t("needs", { feature: t(`labels.${block.feature}`) });
    if (block.kind === "languages") return t("needsLanguages");
    if (block.kind === "exports") return t("needsExports");
    return t("needsAtom");
  }

  function setFeature(key: FeatureKey, checked: boolean) {
    patch((d) => {
      d.features[key] = checked;
      if (!checked) {
        for (const dep of dependents(key)) d.features[dep] = false;
      }
      return d;
    });
  }

  return (
    <SectionShell sectionKey="features" icon={ToggleRight} description={t("description")} library={library}>
      {FEATURE_GROUPS.map((group) => (
        <FieldGroup
          key={group.key}
          title={t(`groups.${group.key as "appearance"}`)}
          data-feature-group={group.key}
        >
          {group.features.map((key) => {
            const reason = reasonText(blockedBy(key, draft));
            return (
              <ToggleRow
                key={key}
                data-feature={key}
                label={t(`labels.${key}`)}
                hint={t(`hints.${key}`)}
                checked={features[key]}
                disabled={reason !== null}
                disabledReason={reason}
                onChange={(checked) => setFeature(key, checked)}
              />
            );
          })}
        </FieldGroup>
      ))}
    </SectionShell>
  );
}
