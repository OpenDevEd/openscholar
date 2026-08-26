"use client";

import { ToggleRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
import { SubHeading, ToggleRow } from "./fields";
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
          {group.key === "ai" && features.ai ? <AiSettingsFields library={library} patch={patch} /> : null}
        </div>
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
      <SubHeading>{t("billingHeading")}</SubHeading>
      <RadioGroup
        value={ai.billing}
        onValueChange={(value) => update((a) => { a.billing = value as AiBilling; })}
        className="grid gap-2 sm:grid-cols-3"
      >
        {BILLING.map((billing) => (
          <Label
            key={billing}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border-2 bg-background p-3 font-normal transition-all",
              ai.billing === billing ? "border-primary/40 bg-primary/5" : "border-border/50 hover:border-border/80",
            )}
          >
            <RadioGroupItem value={billing} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{t(`billing.${billing}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`billingHint.${billing}`)}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>

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

      <SubHeading>{t("modelsHeading")}</SubHeading>
      <p className="text-xs text-muted-foreground">{t("modelsHint")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("modelsHeading")}>
        {AI_MODELS.map((model) => {
          const checked = ai.models.includes(model.id);
          const ok = usable(model.id);
          return (
            <Label
              key={model.id}
              data-model={model.id}
              data-usable={ok}
              className={cn(
                "flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-normal transition-all",
                !ok
                  ? "cursor-not-allowed border-dashed border-border/60 bg-muted/40 text-muted-foreground"
                  : checked
                    ? "cursor-pointer border-primary/40 bg-primary/5"
                    : "cursor-pointer border-border/50 hover:border-border/80 hover:bg-muted/30",
              )}
              title={!ok ? t("needsKey", { provider: t(`providerNames.${model.provider}`) }) : undefined}
            >
              <Checkbox
                checked={checked}
                disabled={!ok}
                onCheckedChange={(next) =>
                  update((a) => {
                    a.models = next === true
                      ? AI_MODELS.filter((m) => m.id === model.id || a.models.includes(m.id)).map((m) => m.id)
                      : a.models.filter((id) => id !== model.id);
                  })
                }
              />
              <span>{model.name}</span>
              <code className="font-mono text-xs text-muted-foreground">{model.id}</code>
            </Label>
          );
        })}
      </div>

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

      <InlineNotice tone="info">{t("embeddingsNote")}</InlineNotice>
    </div>
  );
}
