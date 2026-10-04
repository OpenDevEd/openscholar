"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Coins, ExternalLink, KeyRound, Monitor, Save, Sparkles } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { AnthropicIcon, GoogleIcon, OpenAIIcon, OpenRouterIcon } from "@/components/icons/provider-icons";
import { useAIConfigStore } from "@/lib/store";
import { getProviderConfig } from "@/lib/ai-models";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { resolveCreditsAvailability } from "@/lib/credits/availability";
import { ESTIMATED_CREDITS_PER_QUERY } from "@/convex/lib/constants";
import { useAppToast } from "@/lib/toast";
import { AI_TASKS, BROWSER_TASKS, type AiTask, type ModelChoice } from "@/lib/ai/tasks";
import { keyFor, type KeyProvider } from "@/lib/ai/keys";
import type { AIKeyMode, AIProvider } from "@/lib/types/ai.types";
import { Enter, Segmented, type Ico } from "@/components/settings/parts";
import {
  MapSummary, NodeCard, PresetSwitch, RoutingMap, useRouting, ZONE_LABEL,
  type Hover, type MapNode,
} from "@/components/settings/model-map";
import { ModelPicker } from "@/components/models/model-picker";
import { useModelPicks } from "@/lib/ai/use-model-picks";

const PROVIDERS: Array<{ id: KeyProvider; icon: Ico }> = [
  { id: "openai", icon: OpenAIIcon },
  { id: "google", icon: GoogleIcon },
  { id: "anthropic", icon: AnthropicIcon },
  { id: "openrouter", icon: OpenRouterIcon },
];

const onBrowser = (task: AiTask) => (BROWSER_TASKS as readonly AiTask[]).includes(task);

export default function AISettingsPage() {
  const t = useTranslations("settingsAi");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const { provider, setProvider, apiKey, setApiKey, providerApiKeys, apiKeyMode, setApiKeyMode } = useAIConfigStore();
  const { signedIn, goToSignIn, creditsEnabled, presetModel, settings, choose, choice, modelsOf, modelOf, fail, requireSignIn, pickAll, presetPicks } = useModelPicks();
  const [hover, setHover] = useState<Hover>(null);

  const account = useOptionalAuthQuery(api.billing.accounts.mine, creditsEnabled ? {} : "skip");
  const isCustom = choice === "custom";
  // Signed-out users can only run on a key: the default preset's picks, on theirs.
  const onKeys = isCustom || !signedIn;
  const keys: Record<string, string> = { ...providerApiKeys, [provider]: apiKey };

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
  // Presets always run on credits; your own keys are part of Custom.
  const browserOn: AIKeyMode = !signedIn ? "local" : !isCustom ? "credits" : !creditsEnabled || (pay === "smart" && !creditsRun) ? "local" : pay;

  const routing = useRouting({
    // Cloud tasks only run on credits.
    modelFor: (task) => (creditsEnabled || onBrowser(task) ? modelOf(task) : null),
    onKey: (task) => browserOn === "local" && onBrowser(task),
  });

  const choosePay = (next: AIKeyMode) => {
    if (next !== "local" && !creditsEnabled) {
      toast.error(t("creditsOff"), t("creditsOffDescription"));
      return;
    }
    if (next !== "local" && !signedIn) {
      toast.error(t("signInToUseCredits"), undefined, { label: tc("signIn"), onClick: goToSignIn, icon: "arrow-right" });
      return;
    }
    setApiKeyMode(next);
  };
  const chooseModels = (next: ModelChoice) => {
    if (next !== "custom" && !creditsEnabled) {
      toast.error(t("creditsOff"), t("creditsOffDescription"));
      return;
    }
    if (requireSignIn()) choose({ choice: next }).catch(fail("model choice"));
  };
  // What a card says in place of its price: only what the map itself doesn't show.
  const note = (n: MapNode) => {
    if (n.paidBy === "key") {
      return keyFor(n.model.id, keys) ? null : (
        <span className="flex items-center gap-1 text-destructive">
          <KeyRound className="size-3" /> {t("needsKey")}
        </span>
      );
    }
    return pay === "smart" && n.tasks.some(onBrowser) && keyFor(n.model.id, keys) ? (
      <span className="flex items-center gap-1">
        <Coins className="size-3" /> {t("pay.smart")}
      </span>
    ) : null;
  };

  const ready =
    presetModel !== undefined && (!signedIn || settings !== undefined) && (!signedIn || !creditsEnabled || account.settlement === "ready");

  return (
    <Enter ready={ready}>
      <div className="space-y-6">
        <PresetSwitch
          withCustom
          value={choice}
          onChange={chooseModels}
          modelsOf={(c) => AI_TASKS.flatMap((task) => modelsOf(c)(task) ?? [])}
        />
        <MapSummary
          routing={routing}
          title={t("modelCount", { count: routing.modelCount })}
          hovered={hover?.node}
          onHover={(id) => setHover(id ? { node: id } : null)}
        />

        <RoutingMap
          routing={routing}
          hover={hover}
          setHover={setHover}
          browserLabel={t(`browserLabel.${browserOn}`)}
          browserActive={browserOn === "local"}
          wrapBrowserLabel={!onKeys ? undefined : (label) => (
            <PayMenu pay={pay} onPay={choosePay} provider={provider} keys={keys} apiKey={apiKey} onProvider={setProvider} onSave={setApiKey}>
              {label}
            </PayMenu>
          )}
          wrapTask={!isCustom ? undefined : (task, row) => (
            <ModelPicker
              align="start"
              current={modelOf(task) ?? undefined}
              onChange={(m, effort) => pickAll([task], m, effort)}
              efforts
              presets={presetPicks([task])}
              tasks={[task]}
              trigger={
                <button type="button" className="w-full rounded-l-xl">
                  {row}
                </button>
              }
            />
          )}
          renderNode={(n) => {
            const card = isCustom ? (
              <ModelPicker
                current={n.model}
                onChange={(m, effort) => pickAll(n.tasks, m, effort)}
                efforts
                presets={presetPicks(n.tasks)}
                tasks={n.tasks}
                trigger={<NodeCard model={n.model} paidBy={n.paidBy} interactive note={note(n)} />}
              />
            ) : (
              <NodeCard model={n.model} paidBy={n.paidBy} note={note(n)} />
            );
            return n.id === routing.firstKey ? (
              <div className="relative">
                <div
                  className="absolute left-0 flex items-center gap-1.5 rounded-t-xl bg-primary/10 pl-3 pr-4 text-xs font-medium text-primary"
                  style={{ top: -ZONE_LABEL + 2, height: ZONE_LABEL - 2 }}
                >
                  <Monitor className="size-3.5" /> {t("yourBrowser")}
                </div>
                {card}
              </div>
            ) : (
              card
            );
          }}
        />
      </div>
    </Enter>
  );
}

/** The browser tasks' label as a control: how they're paid for, and the keys they can run on. */
function PayMenu({
  pay, onPay, provider, keys, apiKey, onProvider, onSave, children,
}: {
  pay: AIKeyMode;
  onPay: (mode: AIKeyMode) => void;
  provider: AIProvider;
  keys: Record<string, string>;
  apiKey: string;
  onProvider: (p: KeyProvider) => void;
  onSave: (key: string) => void;
  children: ReactNode;
}) {
  const t = useTranslations("settingsAi");
  const saved = PROVIDERS.filter((p) => keys[p.id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="-ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted">
          {children}
          {saved.length ? (
            <span className="flex -space-x-1">
              {saved.map((p) => (
                <span key={p.id} className="flex size-5 items-center justify-center rounded-full bg-background ring-2 ring-background">
                  <p.icon className="size-3" />
                </span>
              ))}
            </span>
          ) : null}
          <ChevronsUpDown className="size-3 text-muted-foreground/60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] space-y-3 p-3">
        <Segmented
          label={t("payWith")}
          value={pay}
          onChange={onPay}
          options={[
            { id: "credits", label: t("pay.credits"), icon: Coins },
            { id: "smart", label: t("pay.smart"), icon: Sparkles },
            { id: "local", label: t("pay.local"), icon: KeyRound },
          ]}
        />
        <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={t("keyProvider")}>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === provider}
              onClick={() => onProvider(p.id)}
              className={cn(
                "relative flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs transition-colors",
                p.id === provider ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <p.icon className="size-4" /> {getProviderConfig(p.id).name}
              {keys[p.id] ? <Check aria-label={t("saved")} className="absolute right-1.5 top-1.5 size-3 text-primary" /> : null}
            </button>
          ))}
        </div>
        <KeyInput key={provider} provider={provider} saved={apiKey} onSave={onSave} />
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
