"use client";

import { ToggleRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AI_PROVIDERS,
  type AiProvider,
  FEATURE_DEPENDENCIES,
  FEATURE_GROUPS,
  type FeatureKey,
  type LibraryConfig,
} from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import { SubHeading, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const PROVIDERS = Object.keys(AI_PROVIDERS) as AiProvider[];

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
        <div key={group.key} className="space-y-2" data-feature-group={group.key}>
          <SubHeading>{t(`groups.${group.key as "appearance"}`)}</SubHeading>
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
          {group.key === "ai" && features.ai ? <AiModelFields library={library} patch={patch} /> : null}
        </div>
      ))}
    </SectionShell>
  );
}

function AiModelFields({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.features");
  const { aiProvider, aiModel } = library.draft.features;
  const models = aiProvider ? AI_PROVIDERS[aiProvider] : [];
  return (
    <div className="grid gap-4 rounded-lg border border-border/50 bg-muted/30 p-3 sm:grid-cols-2">
      <Field label={t("provider")} error={!aiProvider ? t("providerError") : null}>
        {(id) => (
          <Select
            value={aiProvider || undefined}
            onValueChange={(value) =>
              patch((d) => {
                const provider = value as AiProvider;
                d.features.aiProvider = provider;
                d.features.aiModel = AI_PROVIDERS[provider][0];
                return d;
              })
            }
          >
            <SelectTrigger id={id} className="w-full bg-background">
              <SelectValue placeholder={t("providerPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {t(`providers.${provider}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label={t("model")} hint={t("modelHint")}>
        {(id) => (
          <Select
            value={aiModel || undefined}
            disabled={!aiProvider}
            onValueChange={(value) =>
              patch((d) => {
                d.features.aiModel = value;
                return d;
              })
            }
          >
            <SelectTrigger id={id} className="w-full bg-background font-mono text-sm">
              <SelectValue placeholder={t("modelPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model} value={model} className="font-mono text-sm">
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
    </div>
  );
}
