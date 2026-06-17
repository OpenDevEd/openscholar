"use client";
"use no memo"; // try/finally in handlers

import { useState, useMemo } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  ChevronDown,
  ChevronUp,
  Search,
  ExternalLink,
  Check,
  AlertCircle,
  Lock,
  Save,
  RotateCcw,
  Coins,
  KeyRound,
  Sparkles,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  OpenAIIcon,
  GoogleIcon,
  AnthropicIcon,
  OpenRouterIcon,
} from "@/components/icons/provider-icons";
import { useAIConfigStore } from "@/lib/store";
import {
  getProviderConfig,
  getDefaultModelForProvider,
} from "@/lib/ai-models";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTranslations } from "next-intl";
import { useAppToast } from "@/lib/toast";
import { toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { ServerModelSection } from "@/components/settings/server-model-section";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import {
  useSharedSubscriptionState,
} from "@/lib/auth/use-subscription-state";
import { useFeatureFlagForResolvedTier } from "@/lib/feature-flags/hook";
import type { AIProvider } from "@/lib/types/ai.types";

type ModelCatalogOption =
  (typeof api.models.queries.listCatalogOptions)["_returnType"][number];

export default function AISettingsPage() {
  const {
    provider,
    model,
    setProvider,
    setModel,
    apiKey,
    setApiKey,
    apiKeyMode,
    setApiKeyMode,
  } = useAIConfigStore();

  const { phase } = useAuthReadiness();
  const isSignedIn = phase === "authenticated";
  const convex = useConvex();
  const router = useRouter();
  const goToSignIn = useSignInRedirect();
  const subscriptionState = useSharedSubscriptionState();
  const [showApiKeyConfig, setShowApiKeyConfig] = useState(false);

  // Per-provider draft keys — only entries that differ from the store are present
  const [pendingKeys, setPendingKeys] = useState<Record<string, string>>({});
  const [modelSearch, setModelSearch] = useState("");
  const [modelSectionExpanded, setModelSectionExpanded] = useState(false);

  const pendingApiKey = provider in pendingKeys ? pendingKeys[provider] : apiKey;
  const hasUnsavedKey = pendingApiKey !== apiKey;

  const toast = useAppToast();
  const t = useTranslations("aiSettings");
  const tc = useTranslations("common");

  const providerConfig = getProviderConfig(provider);

  // Settings only needs a point-in-time catalog read. Avoid a live
  // subscription for a low-freshness settings surface.
  const queryProvider = provider === "openrouter" ? undefined : provider;
  const [rawModels, setRawModels] = useState<ModelCatalogOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelCatalogFailed, setModelCatalogFailed] = useState(false);
  const [modelCatalogRequestKey, setModelCatalogRequestKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRawModels(null);
    setLoadingModels(true);
    setModelCatalogFailed(false);

    void convex
      .query(api.models.queries.listCatalogOptions, { provider: queryProvider })
      .then((models) => {
        if (cancelled) return;
        setRawModels(models);
      })
      .catch((error) => {
        console.error("[AISettingsPage] Failed to load model catalog", error);
        if (cancelled) return;
        setModelCatalogFailed(true);
        setRawModels([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [convex, modelCatalogRequestKey, queryProvider]);

  // Map DB models to the shape the UI expects
  const models = useMemo(() => {
    if (!rawModels) return [];
    return rawModels.map((m) => ({
      id: provider === "openrouter"
        ? m.modelId
        : (m.modelId.includes("/") ? m.modelId.split("/").slice(1).join("/") : m.modelId),
      fullId: m.modelId,
      name: m.name,
      provider: m.provider,
      description: m.description,
      contextWindow: m.contextLength,
      pricing: {
        input: m.inputPricePerMillion,
        output: m.outputPricePerMillion,
      },
      category: m.category ?? m.tokenizer,
      modality: m.modality,
    }));
  }, [rawModels, provider]);

  const handleProviderChange = (newProvider: AIProvider) => {
    if (newProvider === provider) {
      return;
    }

    setProvider(newProvider);
    const defaultModel = getDefaultModelForProvider(newProvider);
    setModel(defaultModel);
    setModelSectionExpanded(false);
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    setModelSectionExpanded(false);
    setModelSearch("");
  };

  const handleRetryModelCatalog = () => {
    setModelCatalogRequestKey((current) => current + 1);
  };

  const handleSaveApiKey = () => {
    setApiKey(pendingApiKey);
    setPendingKeys((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
    sonnerToast.success(t("apiKeySaved"));
  };

  const selectedModel = models.find((m) => m.id === model);

  const filteredModels = models.filter(
    (m) =>
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.id.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  // Group filtered models by category
  const filteredGroupedModels: Record<string, typeof models> = {};
  filteredModels.forEach((m) => {
    if (provider === "openrouter") {
      const category = m.category || tc("other");
      if (!filteredGroupedModels[category]) {
        filteredGroupedModels[category] = [];
      }
      filteredGroupedModels[category].push(m);
    } else {
      const allLabel = tc("all");
      if (!filteredGroupedModels[allLabel]) {
        filteredGroupedModels[allLabel] = [];
      }
      filteredGroupedModels[allLabel].push(m);
    }
  });

  const providers: Array<{
    id: AIProvider;
    name: string;
    family: string;
    icon: typeof OpenAIIcon;
    color: string;
    borderColor: string;
    bgColor: string;
  }> = [
    {
      id: "openai",
      name: t("providerNames.openai"),
      family: t("providerFamilies.gpt"),
      icon: OpenAIIcon,
      color: "text-green-500",
      borderColor: "border-l-green-500",
      bgColor: "bg-green-500/5",
    },
    {
      id: "google",
      name: t("providerNames.google"),
      family: t("providerFamilies.gemini"),
      icon: GoogleIcon,
      color: "text-blue-500",
      borderColor: "border-l-blue-500",
      bgColor: "bg-blue-500/5",
    },
    {
      id: "anthropic",
      name: t("providerNames.anthropic"),
      family: t("providerFamilies.claude"),
      icon: AnthropicIcon,
      color: "text-orange-500",
      borderColor: "border-l-orange-500",
      bgColor: "bg-orange-500/5",
    },
    {
      id: "openrouter",
      name: t("providerNames.openrouter"),
      family: t("models300Plus"),
      icon: OpenRouterIcon,
      color: "text-purple-500",
      borderColor: "border-l-purple-500",
      bgColor: "bg-purple-500/5",
    },
  ];

  const creditsEnabled = useFeatureFlagForResolvedTier(
    "credits.enabled",
    subscriptionState.resolvedTier,
  );
  const isCreditsModeLocked = !creditsEnabled;
  const isDisabled = apiKeyMode === "credits";

  // For logged-out users: provider/model/credentials are hidden until they
  // choose the BYOK path. For logged-in users in credits mode the sections
  // are shown but dimmed (existing behaviour).
  const showFullConfig = isSignedIn ? true : showApiKeyConfig;
  const isConfigDisabled = isSignedIn ? isDisabled : false;

  // Keep showApiKeyConfig referenced (legacy local toggle, retained for parity).
  void showApiKeyConfig;
  void showFullConfig;
  void isConfigDisabled;
  void setShowApiKeyConfig;
  void router;

  // The in-browser features run client-side: BYOK config shows unless the user
  // picked Credits. Credits is gated (sign-in + credits.enabled), matching the
  // legacy mode-card logic; Smart and My-keys are always available.
  const modeCards: Array<{ id: "smart" | "local" | "credits"; label: string; desc: string; icon: typeof KeyRound }> = [
    { id: "smart", label: t("modeLabel.smart"), desc: t("modeShort.smart"), icon: Sparkles },
    { id: "local", label: t("modeLabel.local"), desc: t("modeShort.local"), icon: KeyRound },
    { id: "credits", label: t("modeLabel.credits"), desc: t("modeShort.credits"), icon: Coins },
  ];

  const handleModeClick = (id: "smart" | "local" | "credits") => {
    if (id === "credits") {
      if (isCreditsModeLocked) {
        toast.error(t("creditsModeDisabled"), t("creditsModeDisabledDescription"));
        return;
      }
      if (!isSignedIn) {
        toast.error(t("signInToUseCredits"), undefined, {
          label: tc("signIn"),
          onClick: goToSignIn,
          icon: "arrow-right",
        });
        return;
      }
    }
    setApiKeyMode(id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/40">
        <h2 className="text-lg font-semibold tracking-tight">
          {isSignedIn ? t("aiConfiguration") : t("getStartedTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isSignedIn ? t("configurePreferences") : t("getStartedDescription")}
        </p>
      </div>

      {/* Content — two buckets: server (credits) + in-browser (key or credits) */}
      <div className="p-6 space-y-4 max-w-2xl">
        {/* ── ON OUR SERVERS (credits) ── */}
        <ServerModelSection
          signedIn={isSignedIn}
          creditsEnabled={creditsEnabled}
          onSignIn={goToSignIn}
        />

        {/* ── IN YOUR BROWSER (your key or credits) ── */}
        <section className="overflow-hidden rounded-2xl border-2 border-border/60">
          <div className="space-y-1.5 border-b border-border/50 bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <h3 className="flex-1 text-sm font-semibold">{t("secondaryModelTitle")}</h3>
              <span className="flex h-6 items-center gap-1 rounded-md bg-sky-500/15 px-2 text-xs font-medium text-sky-700"><KeyRound className="h-3 w-3" /> / <Coins className="h-3 w-3" /></span>
            </div>
            <p className="text-xs text-muted-foreground">{t("secondaryModelDesc")}</p>
          </div>

          <div className="space-y-3 p-4">
            {/* mode cards — credits gated; smart/my-keys always available */}
            <div className="grid grid-cols-3 gap-2.5">
              {modeCards.map((mc) => {
                const locked = mc.id === "credits" && (isCreditsModeLocked || !isSignedIn);
                const on = apiKeyMode === mc.id && !locked;
                const ModeIcon = locked && isCreditsModeLocked ? Lock : mc.icon;
                const shownDesc = locked ? (isCreditsModeLocked ? t("modeLocked.notOnPlan") : t("modeLocked.signIn")) : mc.desc;
                return (
                  <button
                    key={mc.id}
                    type="button"
                    onClick={() => handleModeClick(mc.id)}
                    className={cn("flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all", on ? "border-l-[4px] border-l-primary border-t-border/50 border-r-border/50 border-b-border/50 bg-primary/5" : "border-border/50 hover:border-border/80 hover:bg-muted/30", locked && "opacity-60")}
                  >
                    <ModeIcon className={cn("h-6 w-6", on ? "text-primary" : "text-muted-foreground")} />
                    <span className="flex items-center gap-1 text-sm font-semibold">{mc.label}{on && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                    <span className="text-[11px] text-muted-foreground">{shownDesc}</span>
                  </button>
                );
              })}
            </div>

            {apiKeyMode === "credits" ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background p-3 text-sm text-muted-foreground">
                <Coins className="h-4 w-4 text-amber-500" /> {t("creditsInfoBanner")}
              </div>
            ) : (
              <div className="space-y-2.5 rounded-xl border border-border/50 bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><KeyRound className="h-3 w-3" /> {t("providerAndKey")}</div>

                {/* provider — compact segmented control */}
                <div className="flex gap-0.5 rounded-lg border border-border/50 bg-background p-0.5">
                  {providers.map((p) => {
                    const Icon = p.icon;
                    const sel = provider === p.id;
                    return (
                      <button key={p.id} type="button" onClick={() => handleProviderChange(p.id)} title={p.name} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-all", sel ? "bg-muted font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                        <Icon className={cn("h-4 w-4", sel ? p.color : "")} />
                        <span className="hidden sm:inline">{p.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* model picker (reuses the live catalog + grouped search) */}
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setModelSectionExpanded(!modelSectionExpanded)}
                    className="flex w-full items-center gap-2 rounded-xl border-2 border-border/50 bg-background p-3 text-left transition-colors hover:border-border/80"
                  >
                    <span className="flex-1 truncate text-sm">
                      <span className="font-medium">{selectedModel?.name || tc("selectAModel")}</span>
                      {selectedModel && <span className="ml-1.5 text-xs text-muted-foreground">${selectedModel.pricing.input.toFixed(2)} / ${selectedModel.pricing.output.toFixed(2)} {t("per1MTokens")}</span>}
                    </span>
                    {loadingModels ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : modelSectionExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>

                  {modelCatalogFailed && !loadingModels && (
                    <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5">
                      <span className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4 text-destructive" /> {tc("somethingWentWrong")}</span>
                      <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" onClick={handleRetryModelCatalog}><RotateCcw className="h-3.5 w-3.5" /> {tc("retry")}</Button>
                    </div>
                  )}

                  <AnimatePresence initial={false}>
                    {modelSectionExpanded && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: "easeInOut" }} className="overflow-hidden">
                        <div className="overflow-hidden rounded-xl border-2 border-border/50 bg-muted/20">
                          <div className="border-b border-border/40 p-2">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                              <Input placeholder={t("searchModels")} value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} className="h-8 pl-8 text-sm" />
                            </div>
                          </div>
                          <div className="max-h-64 overflow-y-auto p-1.5">
                            {loadingModels ? (
                              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loadingModels")}</div>
                            ) : filteredModels.length === 0 ? (
                              <div className="py-8 text-center text-sm text-muted-foreground">{tc("noModelsFound")}</div>
                            ) : (
                              Object.entries(filteredGroupedModels).map(([category, categoryModels]) => (
                                <div key={category}>
                                  {provider === "openrouter" && <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{category}</div>}
                                  {categoryModels.map((m) => (
                                    <button key={m.id} type="button" onClick={() => handleModelChange(m.id)} className={cn("flex w-full flex-col gap-0.5 rounded-lg border p-2 text-left transition-colors", m.id === model ? "border-primary/20 bg-primary/10" : "border-transparent hover:bg-accent")}>
                                      <span className="flex items-center gap-2">
                                        <span className="flex-1 truncate text-sm font-medium">{m.name}</span>
                                        <span className="whitespace-nowrap text-[11px] text-muted-foreground">${m.pricing.input.toFixed(2)}/${m.pricing.output.toFixed(2)}</span>
                                        {m.id === model && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                                      </span>
                                      {m.description && <span className="text-[11px] text-muted-foreground line-clamp-1">{m.description}</span>}
                                    </button>
                                  ))}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* credentials (per-provider key, save/reset, get-key link, guidance) */}
                <div className="space-y-1.5">
                  <Label htmlFor="api-key" className="sr-only">{t("apiKey")}</Label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Input
                        id="api-key"
                        type="password"
                        placeholder={t("apiKeyPlaceholder", { provider: t(`providerNames.${provider}`) })}
                        value={pendingApiKey}
                        onChange={(e) => setPendingKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter" && hasUnsavedKey) handleSaveApiKey(); }}
                        className="bg-background pr-9 font-mono text-sm"
                      />
                      <ShieldCheck className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                    </div>
                    {hasUnsavedKey && (
                      <ButtonGroup>
                        <Button size="icon" variant="outline" onClick={() => setPendingKeys((prev) => { const next = { ...prev }; delete next[provider]; return next; })}><RotateCcw className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" onClick={handleSaveApiKey}><Save className="h-3.5 w-3.5" /></Button>
                      </ButtonGroup>
                    )}
                  </div>
                  <a href={providerConfig.apiKeyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    {t("getApiKey", { provider: providerConfig.name })} <ExternalLink className="h-3 w-3" />
                  </a>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    <li>{t(`providerGuidance.${provider}.whatIs`)}</li>
                    <li>{t(`providerGuidance.${provider}.credits`)}</li>
                    <li>{t(`providerGuidance.${provider}.freeModels`)}</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
