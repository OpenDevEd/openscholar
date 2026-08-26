"use client";

import { ToggleRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AI_KEY_PROVIDERS,
  AI_MODELS,
  type AiBilling,
  type AiModelId,
  FEATURE_DEPENDENCIES,
  FEATURE_GROUPS,
  type FeatureKey,
  type LibraryConfig,
} from "@/lib/evidence-libraries/mock/config";
import { Field, InlineNotice } from "../section-card";
import { ChoiceCards, ChoiceChips, FieldGroup, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const BILLING: AiBilling[] = ["credits", "openrouter", "providers"];
const MOCK_CREDITS = 1240;

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
          {group.key === "ai" && features.ai ? <AiSettingsFields library={library} patch={patch} /> : null}
        </FieldGroup>
      ))}
    </SectionShell>
  );
}

function AiSettingsFields({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.features");
  const ai = library.draft.features.aiSettings;
  const update = (fn: (a: typeof ai) => void) =>
    patch((d) => {
      fn(d.features.aiSettings);
      const a = d.features.aiSettings;
      if (a.defaultModel && !a.models.includes(a.defaultModel)) a.defaultModel = a.models[0] ?? "";
      if (!a.defaultModel && a.models.length) a.defaultModel = a.models[0];
      return d;
    });
  const hasKey = (provider: (typeof AI_KEY_PROVIDERS)[number]) =>
    Boolean(ai.providerKeys[provider]?.trim());
  const usable = (id: AiModelId) => {
    if (ai.billing !== "providers") return true;
    const provider = AI_MODELS.find((m) => m.id === id)?.provider;
    return Boolean(provider && hasKey(provider));
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/50 bg-muted/30 p-3" data-ai-settings>
      <FieldGroup title={t("billingHeading")}>
        <ChoiceCards
          columns={3}
          value={ai.billing}
          ariaLabel={t("billingHeading")}
          onChange={(value) => update((a) => { a.billing = value; })}
          options={BILLING.map((billing) => ({
            value: billing,
            label: t(`billing.${billing}`),
            hint: t(`billingHint.${billing}`),
          }))}
        />

        {ai.billing === "credits" ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background px-3 py-2.5 text-sm">
            <span>{t("balance", { credits: MOCK_CREDITS.toLocaleString() })}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => toast(t("topUpToast"))}>
              {t("topUp")}
            </Button>
          </div>
        ) : null}

        {ai.billing === "openrouter" ? (
          <Field label={t("openRouterKey")} hint={t("openRouterKeyHint")} error={!ai.openRouterKey.trim() ? t("openRouterKey") : null} className="max-w-md">
            {(id, invalid) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                className="bg-background font-mono text-sm"
                placeholder="sk-or-v1-…"
                value={ai.openRouterKey}
                aria-invalid={invalid || undefined}
                onChange={(e) => update((a) => { a.openRouterKey = e.target.value; })}
              />
            )}
          </Field>
        ) : null}

        {ai.billing === "providers" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {AI_KEY_PROVIDERS.map((provider) => (
              <Field key={provider} label={t("providerKey", { provider: t(`providerNames.${provider}`) })}>
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="off"
                    className="bg-background font-mono text-sm"
                    value={ai.providerKeys[provider] ?? ""}
                    onChange={(e) => update((a) => { a.providerKeys[provider] = e.target.value; })}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}
      </FieldGroup>

      <FieldGroup title={t("modelsHeading")} hint={t("modelsHint")}>
        <ChoiceChips
          ariaLabel={t("modelsHeading")}
          values={ai.models}
          onChange={(models) => update((a) => { a.models = models; })}
          options={AI_MODELS.map((model) => {
            const ok = usable(model.id);
            return {
              value: model.id,
              code: model.id,
              label: model.name,
              disabled: !ok,
              disabledReason: ok ? undefined : t("needsKey", { provider: t(`providerNames.${model.provider}`) }),
            };
          })}
        />

        <Field label={t("defaultModel")} className="max-w-xs">
          {(id) => (
            <Select
              value={ai.defaultModel || undefined}
              disabled={ai.models.filter(usable).length === 0}
              onValueChange={(value) => update((a) => { a.defaultModel = value as AiModelId; })}
            >
              <SelectTrigger id={id} className="w-full bg-background">
                <SelectValue placeholder={t("defaultModelPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {AI_MODELS.filter((m) => ai.models.includes(m.id) && usable(m.id)).map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </FieldGroup>

      <InlineNotice tone="info">{t("embeddingsNote")}</InlineNotice>
    </div>
  );
}
