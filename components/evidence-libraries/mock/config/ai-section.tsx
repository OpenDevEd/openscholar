"use client";

import { useQuery } from "convex/react";
import { Check, ExternalLink, ShieldCheck, Sparkles, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getProviderConfig } from "@/lib/ai-models";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import {
  AI_KEY_PROVIDERS,
  type AiBilling,
  type AiKeyProvider,
  type AiSettings,
} from "@/lib/evidence-libraries/mock/config";
import { aiModelUsable } from "@/lib/evidence-libraries/mock/data";
import { cn } from "@/lib/utils";
import { Field } from "../section-card";
import { AiModelPicker } from "./ai-model-picker";
import { formatContext, formatPrice, ProviderMark, providerName, type CatalogModel } from "./ai-shared";
import { ChoiceCards, EmptyList, FieldGroup, MetaList, Panel, PanelRow, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const BILLING: AiBilling[] = ["credits", "openrouter", "providers"];

export function AiSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.ai");
  const tf = useTranslations("evidenceLibraryMock.config.features");
  const features = library.draft.features;
  const ai = features.aiSettings;
  const catalog = useQuery(api.models.queries.listCatalogOptions, {});
  const byId = new Map((catalog ?? []).map((m) => [m.modelId, m]));

  const update = (fn: (a: AiSettings) => void) =>
    patch((d) => {
      fn(d.features.aiSettings);
      const a = d.features.aiSettings;
      if (a.defaultModel && !a.models.includes(a.defaultModel)) a.defaultModel = a.models[0] ?? "";
      if (!a.defaultModel && a.models.length) a.defaultModel = a.models[0];
      return d;
    });
  const usable = (id: string) => aiModelUsable(library.draft, id);
  const reason = (id: string) => t("needsKey", { provider: providerName(id.split("/")[0]) });

  return (
    <SectionShell sectionKey="ai" icon={Sparkles} description={t("description")} library={library}>
      <ToggleRow
        label={t("master")}
        hint={t("masterHint")}
        checked={features.ai}
        onChange={(on) =>
          patch((d) => {
            d.features.ai = on;
            if (!on) {
              d.features.aiSearch = false;
              d.features.deepResearch = false;
              d.features.relatedResources = false;
            }
            return d;
          })
        }
        data-feature="ai"
      />

      {!features.ai ? (
        <p className="text-xs text-muted-foreground">{t("offNotice")}</p>
      ) : (
        <>
          <FieldGroup title={t("billingHeading")}>
            <ChoiceCards
              value={ai.billing}
              onChange={(billing) => update((a) => { a.billing = billing; })}
              columns={3}
              options={BILLING.map((b) => ({ value: b, label: t(`billing.${b}`), hint: t(`billingHint.${b}`) }))}
            />
            {ai.billing === "credits" ? <CreditsPanel /> : null}
            {ai.billing === "openrouter" ? (
              <KeyField
                provider="openrouter"
                value={ai.openRouterKey}
                onChange={(v) => update((a) => { a.openRouterKey = v; })}
                required
              />
            ) : null}
            {ai.billing === "providers" ? <ProviderKeys ai={ai} update={update} /> : null}
          </FieldGroup>

          <FieldGroup
            title={t("modelsHeading")}
            hint={t("modelsHint")}
            action={
              <AiModelPicker
                catalog={catalog}
                addedIds={ai.models}
                usable={usable}
                disabledReason={reason}
                onAdd={(ids) =>
                  update((a) => {
                    for (const id of ids) if (!a.models.includes(id)) a.models.push(id);
                  })
                }
              />
            }
          >
            {ai.models.length === 0 ? (
              <EmptyList>{t("noModels")}</EmptyList>
            ) : (
              <div className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background">
                {ai.models.map((id) => (
                  <ModelRow
                    key={id}
                    id={id}
                    model={byId.get(id)}
                    isDefault={ai.defaultModel === id}
                    usable={usable(id)}
                    reason={reason(id)}
                    onDefault={() => update((a) => { a.defaultModel = id; })}
                    onRemove={() => update((a) => { a.models = a.models.filter((m) => m !== id); })}
                  />
                ))}
              </div>
            )}
          </FieldGroup>

          <FieldGroup title={t("capabilitiesHeading")}>
            <ToggleRow
              label={tf("labels.aiSearch")}
              hint={tf("hints.aiSearch")}
              checked={features.aiSearch}
              onChange={(on) =>
                patch((d) => {
                  d.features.aiSearch = on;
                  if (!on) d.features.deepResearch = false;
                  return d;
                })
              }
              data-feature="aiSearch"
            />
            <ToggleRow
              label={tf("labels.deepResearch")}
              hint={tf("hints.deepResearch")}
              checked={features.deepResearch}
              disabled={!features.aiSearch}
              disabledReason={tf("needs", { feature: tf("labels.aiSearch") })}
              onChange={(on) => patch((d) => { d.features.deepResearch = on; return d; })}
              data-feature="deepResearch"
            />
            <ToggleRow
              label={tf("labels.relatedResources")}
              hint={tf("hints.relatedResources")}
              checked={features.relatedResources}
              onChange={(on) => patch((d) => { d.features.relatedResources = on; return d; })}
              data-feature="relatedResources"
            />
          </FieldGroup>
        </>
      )}
    </SectionShell>
  );
}

/* ------------------------------------------------------------------ */

function CreditsPanel() {
  const t = useTranslations("evidenceLibraryMock.config.ai");
  const credits = useOptionalAuthQuery(api.credits.queries.getMyBalance, {});
  const total = credits.data?.total;
  return (
    <PanelRow
      tone="muted"
      title={total === undefined ? t("balanceUnknown") : t("balance", { credits: total.toLocaleString() })}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/billing#topup-section">{t("topUp")}</Link>
        </Button>
      }
      data-credits={total ?? "unknown"}
    />
  );
}

function KeyField({
  provider,
  value,
  onChange,
  required,
}: {
  provider: AiKeyProvider | "openrouter";
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const t = useTranslations("evidenceLibraryMock.config.ai");
  const config = getProviderConfig(provider);
  const filled = value.trim().length > 0;
  return (
    <Field
      label={t("keyLabel", { provider: config.name })}
      hint={
        <span className="inline-flex flex-wrap items-center gap-x-3">
          <span>{t("keyHint")}</span>
          <a
            href={config.apiKeyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {t("getKey", { provider: config.name })}
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>
      }
      error={required && !filled ? t("keyLabel", { provider: config.name }) : null}
      className="max-w-lg"
    >
      {(id, invalid) => (
        <div className="relative">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            className="bg-background pr-9 font-mono text-sm"
            placeholder={config.apiKeyPlaceholder}
            value={value}
            aria-invalid={invalid || undefined}
            onChange={(e) => onChange(e.target.value)}
          />
          {filled ? (
            <ShieldCheck className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" aria-hidden />
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** The app's segmented provider control, one key field for the selected provider. */
function ProviderKeys({ ai, update }: { ai: AiSettings; update: (fn: (a: AiSettings) => void) => void }) {
  const t = useTranslations("evidenceLibraryMock.config.ai");
  const [selected, setSelected] = useState<AiKeyProvider>(
    AI_KEY_PROVIDERS.find((p) => !ai.providerKeys[p]) ?? AI_KEY_PROVIDERS[0],
  );
  return (
    <Panel tone="muted" className="space-y-4">
      <div className="flex gap-0.5 rounded-lg border border-border/50 bg-background p-0.5" role="tablist">
        {AI_KEY_PROVIDERS.map((p) => {
          const on = selected === p;
          const has = Boolean(ai.providerKeys[p]?.trim());
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={on}
              title={has ? t("keySaved") : t("keyMissing")}
              onClick={() => setSelected(p)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-all",
                on ? "bg-muted font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ProviderMark provider={p} className="h-4 w-4" />
              <span className="hidden sm:inline">{providerName(p)}</span>
              {has ? <Check className="h-3 w-3 text-emerald-500" aria-label={t("keySaved")} /> : null}
            </button>
          );
        })}
      </div>
      <KeyField
        provider={selected}
        value={ai.providerKeys[selected] ?? ""}
        onChange={(v) => update((a) => { a.providerKeys[selected] = v; })}
      />
    </Panel>
  );
}

function ModelRow({
  id,
  model,
  isDefault,
  usable,
  reason,
  onDefault,
  onRemove,
}: {
  id: string;
  model: CatalogModel | undefined;
  isDefault: boolean;
  usable: boolean;
  reason: string;
  onDefault: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.ai");
  const provider = id.split("/")[0];
  return (
    <div
      className={cn("flex items-center gap-3 p-3", !usable && "bg-muted/30")}
      data-model-id={id}
      data-default={isDefault || undefined}
      data-usable={usable}
    >
      <ProviderMark provider={provider} className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm font-medium", !usable && "text-muted-foreground")}>
            {model ? stripProviderPrefix(model.name) : id}
          </span>
          {isDefault ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Star className="h-3 w-3" />
              {t("default")}
            </span>
          ) : null}
        </div>
        <MetaList
          items={[
            { key: "id", value: <span className="font-mono text-muted-foreground">{id}</span> },
            ...(model
              ? [
                  {
                    key: "price",
                    label: t("priceLabel"),
                    value: formatPrice(model.inputPricePerMillion, model.outputPricePerMillion, t("free")),
                  },
                  { key: "ctx", label: t("contextLabel"), value: formatContext(model.contextLength) },
                ]
              : []),
          ]}
        />
        {!usable ? <p className="text-xs text-amber-700 dark:text-amber-400">{reason}</p> : null}
      </div>
      {!isDefault ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="sm" disabled={!usable} onClick={onDefault}>
              {t("makeDefault")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("makeDefault")}</TooltipContent>
        </Tooltip>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive"
        aria-label={t("removeModel")}
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
