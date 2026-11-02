"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronsUpDown, Coins, ExternalLink, FallbackRouteIcon, KeyRound, Monitor, Save } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { TooltipHint } from "@/components/ui/tooltip";
import { AnthropicIcon, GoogleIcon, OpenAIIcon, OpenRouterIcon } from "@/components/icons/provider-icons";
import { useAIConfigStore } from "@/lib/store";
import { getProviderConfig } from "@/lib/ai-models";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { resolveCreditsAvailability } from "@/lib/credits/availability";
import { useAppToast } from "@/lib/toast";
import { AI_TASKS, BROWSER_TASKS, type AiTask, type ModelChoice } from "@/lib/ai/tasks";
import { checkKey, keyFor, modelForKey, serves, type KeyProvider } from "@/lib/ai/keys";
import type { AIKeyMode } from "@/lib/types/ai.types";
import { Enter, Segmented, type Ico } from "@/components/settings/parts";
import {
  MapSummary, NodeCard, PresetSwitch, RoutingMap, toMapModel, useRouting, ZONE_LABEL,
  type Hover, type MapNode,
} from "@/components/settings/model-map";
import { ModelPicker } from "@/components/models/model-picker";
import { useModelPicks } from "@/lib/ai/use-model-picks";
import { useWorkspaceScope } from "@/lib/workspaces/url";
import { useCurrentWorkspace, WorkspaceTag } from "@/components/workspaces/parts";

const PROVIDERS: Array<{ id: KeyProvider; icon: Ico }> = [
  { id: "openai", icon: OpenAIIcon },
  { id: "google", icon: GoogleIcon },
  { id: "anthropic", icon: AnthropicIcon },
  { id: "openrouter", icon: OpenRouterIcon },
];

const onBrowser = (task: AiTask) => (BROWSER_TASKS as readonly AiTask[]).includes(task);
/** A small action beside a column label. */
const LABEL_ACTION = "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10";

export default function AISettingsPage() {
  const t = useTranslations("settingsAi");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const { provider, setProvider, apiKey, setApiKey, providerApiKeys, apiKeyMode, setApiKeyMode } = useAIConfigStore();
  const { signedIn, signedOut, goToSignIn, creditsEnabled, presetModel, settings, choose, choice, modelsOf, modelOf, fail, requireSignIn, pickAll, presetPicks, organization } = useModelPicks();
  const workspace = useCurrentWorkspace();
  const [hover, setHover] = useState<Hover>(null);
  const [payOpen, setPayOpen] = useState(false);
  // Signed out, saving a key moves tasks it can't run onto models it can, picked from the catalog.
  const catalog = useQuery(api.models.queries.listCatalogOptions, signedOut ? {} : "skip");

  const scope = useWorkspaceScope();
  const account = useOptionalAuthQuery(api.billing.accounts.mine, creditsEnabled && scope !== "skip" ? scope : "skip");
  const figures = useOptionalAuthQuery(api.ai.estimates.mine, creditsEnabled && scope !== "skip" ? scope : "skip");
  const isCustom = choice === "custom";
  // Signed out it's all Custom, on the person's keys (useModelPicks).
  const onKeys = isCustom;
  const keys: Record<string, string> = { ...providerApiKeys, [provider]: apiKey };

  const pay = apiKeyMode;
  // Mirrors the executor: "Credits, then key" runs on the key alone when credits can't run.
  const creditsRun =
    creditsEnabled &&
    signedIn &&
    resolveCreditsAvailability({
      isAuthenticated: signedIn,
      settlement: account.settlement === "ready" && figures.settlement === "ready" ? "settled" : "loading",
      totalCredits: account.data?.balance,
      // A search helper, the browser task run most, on the model it runs on.
      requiredCredits: figures.data?.questionToQuery?.helper ?? 0,
    }) !== "unavailable";
  // Presets always run on credits; your own keys are part of Custom.
  const browserOn: AIKeyMode = !signedIn ? "local" : !isCustom ? "credits" : !creditsEnabled || (pay === "smart" && !creditsRun) ? "local" : pay;

  const routing = useRouting({
    // Cloud tasks only run on credits, which need an account.
    modelFor: (task) => (onBrowser(task) || (signedIn && creditsEnabled) ? modelOf(task) : null),
    onKey: (task) => browserOn === "local" && onBrowser(task),
  });

  const choosePay = (next: AIKeyMode) => {
    if (next !== "local" && !creditsEnabled) {
      toast.error(t("creditsOff"), t("creditsOffDescription"));
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
  // On a preset a key does nothing: this takes the person to Custom on their key, with the key menu open.
  const switchToKey = () => {
    chooseModels("custom");
    setApiKeyMode("local");
    setPayOpen(true);
  };
  // Signed out the picks are only where things started, so a task no saved key can run moves to a model the new key can.
  // OpenRouter's key runs every model; another provider's runs what its own list for the key has.
  const saveKey = (to: KeyProvider, key: string, served: string[]) => {
    setApiKey(to, key);
    if (!signedOut || !key || !catalog || to === "openrouter") return;
    const saved = { ...keys, [to]: key };
    for (const task of BROWSER_TASKS) {
      const current = modelOf(task);
      const runsOn = current && keyFor(current.id, saved);
      if (!current || (runsOn && (runsOn !== to || serves(served, current.id, to)))) continue;
      const next = modelForKey(task, current, to, catalog, served);
      if (next) pickAll([task], toMapModel(next), current.effort && next.reasoningEfforts?.includes(current.effort) ? current.effort : undefined);
    }
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
    presetModel !== undefined && (!signedIn || settings !== undefined) && (!signedIn || !creditsEnabled || account.settlement === "ready") && !organization?.loading;

  return (
    <Enter ready={ready}>
      <div className="space-y-6">
        {/* In an organization its admins pick the preset everyone in it runs on, with no Custom and no keys of one's own (#651). */}
        {organization && workspace ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <WorkspaceTag workspace={workspace} strong />
            {organization.admin ? t("organizationPresetAdmin") : t("organizationPresetMember")}
          </div>
        ) : null}
        {/* Presets run on credits, which need an account: signed out it's Custom alone. */}
        {!signedOut ? (
          <div className={cn(organization && !organization.admin && "pointer-events-none opacity-60")} aria-disabled={organization ? !organization.admin : undefined}>
            <PresetSwitch
              withCustom={!organization}
              value={choice}
              onChange={chooseModels}
              modelsOf={(c) => AI_TASKS.flatMap((task) => modelsOf(c)(task) ?? [])}
            />
          </div>
        ) : null}
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
          cloudAside={
            signedOut ? (
              <button type="button" onClick={goToSignIn} className={LABEL_ACTION}>
                {t("signInToUse")} <ArrowRight className="size-3" />
              </button>
            ) : undefined
          }
          wrapBrowserLabel={
            onKeys
              ? (label) => (
                  <PayMenu
                    open={payOpen}
                    onOpenChange={setPayOpen}
                    pay={signedOut ? undefined : pay}
                    onPay={choosePay}
                    provider={provider}
                    keys={keys}
                    apiKey={apiKey}
                    onProvider={setProvider}
                    onSave={saveKey}
                    // Signed out, a saved key may move tasks onto other models, which needs the catalog first.
                    canSave={!signedOut || catalog !== undefined}
                  >
                    {label}
                  </PayMenu>
                )
              : organization
                ? undefined
                : (label) => (
                    <span className="flex w-full items-center justify-between gap-2 whitespace-nowrap">
                      {label}
                      <button type="button" onClick={switchToKey} className={LABEL_ACTION}>
                        <KeyRound className="size-3" /> {t("useOwnKey")}
                      </button>
                    </span>
                  )
          }
          wrapTask={!isCustom ? undefined : (task, row) => (
            <ModelPicker
              align="start"
              current={modelOf(task) ?? undefined}
              onChange={(m, effort) => pickAll([task], m, effort)}
              efforts
              presets={signedOut ? undefined : presetPicks([task])}
              tasks={[task]}
              trigger={
                <button type="button" className="w-full rounded-s-xl">
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
                presets={signedOut ? undefined : presetPicks(n.tasks)}
                tasks={n.tasks}
                trigger={<NodeCard model={n.model} paidBy={n.paidBy} interactive note={note(n)} />}
              />
            ) : (
              <NodeCard model={n.model} paidBy={n.paidBy} note={note(n)} />
            );
            return n.id === routing.firstKey ? (
              <div className="relative">
                <div
                  className="absolute start-0 flex items-center gap-1.5 rounded-t-xl bg-primary/10 ps-3 pe-4 text-xs font-medium text-primary"
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
  open, onOpenChange, pay, onPay, provider, keys, apiKey, onProvider, onSave, canSave, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How the browser tasks are paid for; none when signed out, where only a key can. */
  pay?: AIKeyMode;
  onPay: (mode: AIKeyMode) => void;
  provider: KeyProvider;
  keys: Record<string, string>;
  apiKey: string;
  onProvider: (p: KeyProvider) => void;
  onSave: (provider: KeyProvider, key: string, served: string[]) => void;
  canSave: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("settingsAi");
  const saved = PROVIDERS.filter((p) => keys[p.id]);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="-ms-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted">
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
        {pay ? (
          <Segmented
            label={t("payWith")}
            value={pay}
            onChange={onPay}
            options={[
              { id: "credits", label: t("pay.credits"), icon: Coins },
              { id: "smart", label: t("pay.smart"), icon: FallbackRouteIcon },
              { id: "local", label: t("pay.local"), icon: KeyRound },
            ]}
          />
        ) : null}
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
              {keys[p.id] ? <Check aria-label={t("saved")} className="absolute end-1.5 top-1.5 size-3 text-primary" /> : null}
            </button>
          ))}
        </div>
        <KeyInput key={provider} provider={provider} saved={apiKey} onSave={onSave} canSave={canSave} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Password field with save; remounts per provider so a draft never leaks to another key.
 * A key is saved once its provider takes it (a free call listing its models); an empty field removes the key.
 */
function KeyInput({
  provider, saved, onSave, canSave,
}: {
  provider: KeyProvider;
  saved: string;
  onSave: (provider: KeyProvider, key: string, served: string[]) => void;
  canSave: boolean;
}) {
  const t = useTranslations("settingsAi");
  const { name, apiKeyUrl } = getProviderConfig(provider);
  const [draft, setDraft] = useState(saved);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = draft !== saved;
  const save = async () => {
    const key = draft.trim();
    let served: string[] = [];
    if (key) {
      setChecking(true);
      const check = await checkKey(provider, key);
      setChecking(false);
      if (!check.ok) return setProblem(check.reason ?? t("keyUnreachable", { provider: name }));
      served = check.served;
    }
    setDraft(key);
    onSave(provider, key, served);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type="password"
            aria-label={t("apiKey", { provider: name })}
            aria-invalid={problem ? true : undefined}
            placeholder={t("apiKey", { provider: name })}
            value={draft}
            // Held while its check runs, so what's saved is what was checked.
            readOnly={checking}
            onChange={(e) => {
              setDraft(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && !checking && canSave) void save();
            }}
            className="h-10 pe-10 font-mono text-sm"
          />
          <TooltipHint label={t("getKey", { provider: name })}>
            <a
              href={apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("getKey", { provider: name })}
              className="absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </TooltipHint>
        </div>
        <Button className="h-10 w-24 gap-1.5" variant={dirty || !draft ? "default" : "secondary"} disabled={!dirty || checking || !canSave} onClick={() => void save()}>
          {checking ? <Spinner className="size-3.5" /> : dirty || !draft ? <Save className="size-3.5" /> : <Check className="size-3.5" />} {dirty || !draft ? t("save") : t("saved")}
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
