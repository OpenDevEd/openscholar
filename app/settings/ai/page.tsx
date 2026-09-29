"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Box, Check, ChevronsUpDown, Coins, ExternalLink, KeyRound, Monitor, Plus, Save, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { AnthropicIcon, getModelIcon, GoogleIcon, OpenAIIcon, OpenRouterIcon } from "@/components/icons/provider-icons";
import { useAIConfigStore } from "@/lib/store";
import { getDefaultModelForProvider, getProviderConfig } from "@/lib/ai-models";
import { toNativeModelId } from "@/lib/ai/native-model-id";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { resolveCreditsAvailability } from "@/lib/credits/availability";
import { ESTIMATED_CREDITS_PER_QUERY } from "@/convex/lib/constants";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useFeatureFlagForPlan } from "@/lib/feature-flags/hook";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { BROWSER_TASKS, type AiTask } from "@/lib/ai/tasks";
import type { AIKeyMode, AIProvider } from "@/lib/types/ai.types";
import { Enter, Segmented, type Ico } from "@/components/settings/parts";
import {
  MapSummary, ModelPicker, NodeCard, RoutingMap, toMapModel, useRouting, ZONE_LABEL, type Hover, type MapModel,
} from "@/components/settings/model-map";

type KeyProvider = Extract<AIProvider, "openai" | "google" | "anthropic" | "openrouter">;
const PROVIDERS: Array<{ id: KeyProvider; icon: Ico }> = [
  { id: "openai", icon: OpenAIIcon },
  { id: "google", icon: GoogleIcon },
  { id: "anthropic", icon: AnthropicIcon },
  { id: "openrouter", icon: OpenRouterIcon },
];

/** The store keeps OpenRouter models as slugs and every other provider's as the id its own API takes. */
const storedIdOf = (provider: AIProvider, slug: string) =>
  provider === "openrouter" || provider === "azure" ? slug : toNativeModelId(slug, provider);
const onBrowser = (task: AiTask) => (BROWSER_TASKS as readonly AiTask[]).includes(task);

export default function AISettingsPage() {
  const t = useTranslations("settingsAi");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const { provider, model, setProvider, setModel, apiKey, setApiKey, apiKeyMode, setApiKeyMode } = useAIConfigStore();
  const { phase } = useAuthReadiness();
  const signedIn = phase === "authenticated";
  const goToSignIn = useSignInRedirect();
  const subscriptionState = useSharedSubscriptionState();
  const creditsEnabled = useFeatureFlagForPlan("credits.enabled", subscriptionState.planFeatures);
  const [hover, setHover] = useState<Hover>(null);

  const routes = useQuery(api.aiModelConfig.queries.routing, creditsEnabled ? {} : "skip");
  const config = useQuery(api.userAiConfig.queries.get, signedIn && creditsEnabled ? {} : "skip");
  const account = useOptionalAuthQuery(api.billing.accounts.mine, creditsEnabled ? {} : "skip");
  const keyRow = useQuery(
    api.models.queries.getCatalogOption,
    provider === "openrouter" || provider === "azure" ? { modelId: model } : { modelId: model, provider },
  );

  const recommendedChat = routes?.tasks.find((r) => r.task === "chat")?.model ?? null;
  const setPreset = useMutation(api.userAiConfig.mutations.setPreset).withOptimisticUpdate((store, { serverPreset }) => {
    const current = store.getQuery(api.userAiConfig.queries.get, {});
    store.setQuery(api.userAiConfig.queries.get, {}, {
      serverPreset,
      model: serverPreset === "recommended" ? null : (current?.model ?? recommendedChat),
    });
  });
  const setCustomModel = useMutation(api.userAiConfig.mutations.setCustomModel);

  // The server returns no model when tasks run on Recommended, including when an admin hid the picked one.
  const single = config?.model ?? null;
  const one = single !== null;
  const pay = apiKeyMode;
  // Mirrors the executor: "Credits, then key" runs on the key alone when credits can't run.
  const creditsRun =
    creditsEnabled &&
    signedIn &&
    resolveCreditsAvailability({
      isAuthenticated: signedIn,
      settlement: account.settlement === "ready" ? "settled" : "loading",
      totalCredits: account.data?.balance,
      requiredCredits: ESTIMATED_CREDITS_PER_QUERY,
    }) !== "unavailable";
  const browserOn: AIKeyMode = pay === "smart" && !creditsRun ? "local" : pay;
  const keyModel: MapModel = keyRow
    ? toMapModel(keyRow)
    : { id: provider === "openrouter" ? model : `${provider}/${model}`, name: model, inputPricePerMillion: 0, outputPricePerMillion: 0, unpriced: true };

  const routing = useRouting({
    modelFor: (task) => {
      if (!creditsEnabled) return null;
      const picked = single ?? routes?.tasks.find((r) => r.task === task)?.model;
      return picked ? toMapModel(picked) : null;
    },
    onKey: (task) => browserOn === "local" && onBrowser(task),
    keyModel,
    fallback: browserOn === "smart",
  });

  const fail = (what: string) => (error: unknown) => {
    console.error(`[settings] ${what} failed`, error);
    toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
  };
  const chooseMode = (mode: "recommended" | "one") => {
    if (!signedIn) {
      toast.error(t("signInToPick"), undefined, { label: tc("signIn"), onClick: goToSignIn, icon: "arrow-right" });
      return;
    }
    setPreset({ serverPreset: mode === "one" ? "custom" : "recommended" }).catch(fail("model mode change"));
  };
  const choosePay = (next: AIKeyMode) => {
    if (next === "credits" && !creditsEnabled) {
      toast.error(t("creditsOff"), t("creditsOffDescription"));
      return;
    }
    if (next === "credits" && !signedIn) {
      toast.error(t("signInToUseCredits"), undefined, { label: tc("signIn"), onClick: goToSignIn, icon: "arrow-right" });
      return;
    }
    setApiKeyMode(next);
  };
  const chooseProvider = (next: KeyProvider) => {
    if (next === provider) return;
    setProvider(next);
    setModel(getDefaultModelForProvider(next));
  };

  const ready =
    keyRow !== undefined &&
    (!creditsEnabled || (routes !== undefined && (!signedIn || (config !== undefined && account.settlement === "ready"))));

  return (
    <Enter ready={ready}>
      <div className="space-y-6">
        <MapSummary
          routing={routing}
          title={
            !creditsEnabled
              ? stripProviderPrefix(keyModel.name)
              : single
                ? stripProviderPrefix(single.name)
                : t("modelCount", { count: routing.creditModels })
          }
          subtitle={!creditsEnabled ? t("onBrowserTasks") : !single ? t("perTask") : browserOn === "local" ? t("onCloudTasks") : t("onEveryTask")}
          hovered={hover?.node}
          onHover={(id) => setHover(id ? { node: id } : null)}
          aside={
            creditsEnabled ? (
              <Segmented
                size="md"
                label={t("models")}
                value={one ? "one" : "recommended"}
                onChange={chooseMode}
                options={[
                  { id: "recommended", label: t("recommended"), icon: Sparkles },
                  { id: "one", label: t("oneModel"), icon: Box },
                ]}
              />
            ) : null
          }
        />

        <RoutingMap
          routing={routing}
          hover={hover}
          setHover={setHover}
          browserLabel={t(`browserLabel.${browserOn}`)}
          browserActive={browserOn === "local"}
          renderNode={(n) =>
            n.id === "key" ? (
              <KeyNode
                model={keyModel}
                provider={provider}
                apiKey={apiKey}
                fallback={browserOn === "smart"}
                onProvider={chooseProvider}
                onModel={(picked) => setModel(storedIdOf(provider, picked.id))}
                onSave={setApiKey}
              />
            ) : single ? (
              <ModelPicker
                value={n.model.id}
                onChange={(picked) => setCustomModel({ serverModelId: picked._id }).catch(fail("model change"))}
                trigger={<NodeCard model={n.model} paidBy="credits" count={n.tasks.length} interactive />}
              />
            ) : (
              <NodeCard model={n.model} paidBy="credits" count={n.tasks.length} />
            )
          }
        />

        <div className="flex items-center justify-between gap-6 rounded-2xl bg-muted/30 py-3 pl-5 pr-3 @max-[46rem]/configuration:flex-col @max-[46rem]/configuration:items-start @max-[46rem]/configuration:gap-3">
          <p className="text-sm text-muted-foreground">
            {t.rich("keyTasks", { b: (chunks: ReactNode) => <span className="font-medium text-foreground">{chunks}</span> })}
          </p>
          <Segmented
            label={t("payWith")}
            value={pay}
            onChange={choosePay}
            options={[
              { id: "credits", label: t("pay.credits"), icon: Coins },
              { id: "smart", label: t("pay.smart"), icon: Sparkles },
              { id: "local", label: t("pay.local"), icon: KeyRound },
            ]}
          />
        </div>
      </div>
    </Enter>
  );
}

/** The browser's model card: pick a provider, save its key, pick its model. */
function KeyNode({
  model, provider, apiKey, fallback, onProvider, onModel, onSave,
}: {
  model: MapModel;
  provider: AIProvider;
  apiKey: string;
  fallback: boolean;
  onProvider: (p: KeyProvider) => void;
  onModel: (m: MapModel) => void;
  onSave: (key: string) => void;
}) {
  const t = useTranslations("settingsAi");
  const name = getProviderConfig(provider).name;
  const Icon = PROVIDERS.find((p) => p.id === provider)?.icon ?? KeyRound;
  const Brand = getModelIcon(model.id);
  return (
    <Popover>
      <div className="relative">
        <div
          className="absolute left-0 flex items-center gap-1.5 rounded-t-xl bg-primary/10 pl-3 pr-4 text-xs font-medium text-primary"
          style={{ top: -ZONE_LABEL + 2, height: ZONE_LABEL - 2 }}
        >
          <Monitor className="size-3.5" /> {t("yourBrowser")}
        </div>
        <PopoverTrigger asChild>
          <NodeCard
            model={model}
            paidBy="key"
            count={0}
            interactive
            caption={
              apiKey ? (
                <>
                  <Icon className="size-3" /> {t("yourKey")}
                  {fallback ? <span className="text-muted-foreground/60">{t("afterCredits")}</span> : null}
                </>
              ) : (
                <span className="flex items-center gap-1 text-primary">
                  <Plus className="size-3" /> {t("addKey", { provider: name })}
                </span>
              )
            }
          />
        </PopoverTrigger>
      </div>
      <PopoverContent align="end" className="w-[26rem] space-y-3 p-3">
        <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={t("keyProvider")}>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === provider}
              onClick={() => onProvider(p.id)}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs transition-colors",
                p.id === provider ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <p.icon className="size-4" /> {getProviderConfig(p.id).name}
            </button>
          ))}
        </div>
        <KeyInput key={provider} provider={provider} saved={apiKey} onSave={onSave} />
        <ModelPicker
          value={model.id}
          onChange={onModel}
          provider={provider === "openrouter" ? undefined : provider}
          trigger={
            <button
              type="button"
              className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-left text-sm transition-colors hover:border-border"
            >
              <Brand className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">{stripProviderPrefix(model.name)}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/** Password field with save; remounts per provider so a draft never leaks to another key. */
function KeyInput({ provider, saved, onSave }: { provider: AIProvider; saved: string; onSave: (key: string) => void }) {
  const t = useTranslations("settingsAi");
  const { name, apiKeyUrl } = getProviderConfig(provider);
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;
  const save = () => onSave(draft);
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          type="password"
          aria-label={t("apiKey", { provider: name })}
          placeholder={t("apiKey", { provider: name })}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) save();
          }}
          className="h-10 pr-10 font-mono text-sm"
        />
        <TooltipHint label={t("getKey", { provider: name })}>
          <a
            href={apiKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("getKey", { provider: name })}
            className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </TooltipHint>
      </div>
      <Button className="h-10 w-24 gap-1.5" variant={dirty || !draft ? "default" : "secondary"} disabled={!dirty} onClick={save}>
        {dirty || !draft ? <Save className="size-3.5" /> : <Check className="size-3.5" />} {dirty || !draft ? t("save") : t("saved")}
      </Button>
    </div>
  );
}
