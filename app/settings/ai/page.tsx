"use client";
"use no memo"; // try/finally in handlers

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Search,
  ExternalLink,
  Check,
  AlertCircle,
  Lock,
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
  getModelsForProvider,
} from "@/lib/ai-models";
import { fetchOpenRouterModels } from "@/app/actions/openrouter";
import { useTranslations } from "next-intl";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { creditsFeatureFlags } from "@/lib/credits/feature-flags";
import type { AIModel, AIProvider } from "@/lib/types/ai.types";

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
  const router = useRouter();

  const [models, setModels] = useState<AIModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelSectionExpanded, setModelSectionExpanded] = useState(false);

  const toast = useAppToast();
  const t = useTranslations("aiSettings");
  const tc = useTranslations("common");

  const providerConfig = getProviderConfig(provider);

  const handleProviderChange = (newProvider: AIProvider) => {
    if (newProvider === provider) {
      return;
    }

    setProvider(newProvider);
    const defaultModel = getDefaultModelForProvider(newProvider);
    setModel(defaultModel);
    setModels([]);
    setModelSectionExpanded(false);
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    setModelSectionExpanded(false);
    setModelSearch("");
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
  };

  useEffect(() => {
    const loadModels = async () => {
      if (provider === "openrouter") {
        setLoadingModels(true);
        try {
          const openRouterModels = await fetchOpenRouterModels();
          setModels(openRouterModels);
        } catch (error) {
          toast.ai.failed(t("loadingOpenRouterModels"), error);
        } finally {
          setLoadingModels(false);
        }
      } else {
        setModels(getModelsForProvider(provider));
      }
    };

    loadModels();
  }, [provider, apiKey]);

  const selectedModel = models.find((m) => m.id === model);

  const filteredModels = models.filter(
    (model) =>
      model.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      model.id.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  // Group filtered models by category
  const filteredGroupedModels: Record<string, AIModel[]> = {};
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

  const isCreditsModeLocked = !creditsFeatureFlags.enabled;
  const isDisabled = apiKeyMode === "credits";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/40">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("aiConfiguration")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("configurePreferences")}
        </p>
      </div>

      {/* Content */}
      <div className="p-6 space-y-8 max-w-2xl">
        {/* Mode Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <Bot className="w-4 h-4" />
            <span>{tc("mode")}</span>
          </div>

          <div className="space-y-3">
            <motion.button
              type="button"
              onClick={() => {
                setApiKeyMode("smart");
              }}
              whileHover={{ scale: 1.01 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-200",
                apiKeyMode === "smart"
                  ? "border-l-[4px] border-l-primary border-t-border/50 border-r-border/50 border-b-border/50 bg-primary/5"
                  : "border-border/50 hover:border-border/80 hover:bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                  apiKeyMode === "smart" ? "bg-primary/20" : "bg-muted/50",
                )}
              >
                {apiKeyMode === "smart" && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold text-base">{t("useSmartMode")}</div>
                <div className="text-sm text-muted-foreground">
                  {t("smartModeDescription")}
                </div>
              </div>
            </motion.button>

            <motion.button
              type="button"
              onClick={() => {
                setApiKeyMode("local");
              }}
              whileHover={{ scale: 1.01 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-200",
                apiKeyMode === "local"
                  ? "border-l-[4px] border-l-primary border-t-border/50 border-r-border/50 border-b-border/50 bg-primary/5"
                  : "border-border/50 hover:border-border/80 hover:bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                  apiKeyMode === "local" ? "bg-primary/20" : "bg-muted/50",
                )}
              >
                {apiKeyMode === "local" && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold text-base">{t("useMyApiKeys")}</div>
                <div className="text-sm text-muted-foreground">
                  {t("bringYourOwn")}
                </div>
              </div>
            </motion.button>

            <motion.button
              type="button"
              onClick={() => {
                if (isCreditsModeLocked) {
                  toast.error(
                    t("creditsModeDisabled"),
                    t("creditsModeDisabledDescription"),
                  );
                  return;
                }
                if (!isSignedIn) {
                  toast.error(t("signInToUseCredits"), undefined, {
                    label: tc("signIn"),
                    onClick: () => router.push("/sign-in"),
                    icon: "arrow-right",
                  });
                  return;
                }
                setApiKeyMode("credits");
              }}
              whileHover={
                isSignedIn && !isCreditsModeLocked ? { scale: 1.01 } : undefined
              }
              transition={{ duration: 0.2 }}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-200",
                apiKeyMode === "credits"
                  ? "border-l-[4px] border-l-primary border-t-border/50 border-r-border/50 border-b-border/50 bg-primary/5"
                  : "border-border/50 hover:border-border/80 hover:bg-muted/30",
                (!isSignedIn || isCreditsModeLocked) && "opacity-60",
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                  apiKeyMode === "credits" ? "bg-primary/20" : "bg-muted/50",
                )}
              >
                {apiKeyMode === "credits" ? (
                  <Check className="w-5 h-5 text-primary" />
                ) : isCreditsModeLocked ? (
                  <Lock className="w-4 h-4 text-muted-foreground" />
                ) : null}
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold text-base">{t("useCredits")}</div>
                <div className="text-sm text-muted-foreground">
                  {isCreditsModeLocked
                    ? t("creditsModeDisabledDescription")
                    : t("accountBalance")}
                </div>
              </div>
            </motion.button>
          </div>
        </div>

        {/* Disabled Info Banner */}
        <AnimatePresence>
          {isDisabled && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 32 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 30,
              }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-border/50 bg-muted/30 p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  {isCreditsModeLocked
                    ? t("creditsModeDisabledDescription")
                    : t("creditsInfoBanner")}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Provider Section */}
        <div
          className={cn(
            "space-y-4 transition-opacity duration-300",
            isDisabled && "opacity-50 pointer-events-none",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <span>{tc("provider")}</span>
          </div>

          <div className="space-y-2">
            {providers.map((p) => {
              const Icon = p.icon;
              const isSelected = provider === p.id;

              return (
                <motion.button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id)}
                  whileHover={{ scale: 1.01 }}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-200",
                    isSelected
                      ? `border-l-[4px] ${p.borderColor} border-t-border/50 border-r-border/50 border-b-border/50 ${p.bgColor}`
                      : "border-border/50 hover:border-border/80 hover:bg-muted/30",
                  )}
                >
                  <Icon
                    className={cn(
                      "w-10 h-10 transition-colors",
                      isSelected ? p.color : "text-muted-foreground",
                    )}
                  />
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-lg">{p.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {p.family}
                    </div>
                  </div>
                  {isSelected && <Check className={cn("w-5 h-5", p.color)} />}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Model Section */}
        <div
          className={cn(
            "space-y-4 transition-opacity duration-300",
            isDisabled && "opacity-50 pointer-events-none",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <span>{tc("model")}</span>
          </div>

          <div className="space-y-2">
            {/* Current Model Display */}
            <button
              type="button"
              onClick={() => setModelSectionExpanded(!modelSectionExpanded)}
              className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-border/50 hover:border-border/80 hover:bg-muted/30 transition-all duration-200"
            >
              <div className="flex-1 text-left">
                <div className="font-semibold text-base">
                  {selectedModel?.name || tc("selectAModel")}
                </div>
                {selectedModel && (
                  <div className="text-sm text-muted-foreground">
                    ${selectedModel.pricing.input.toFixed(2)} / $
                    {selectedModel.pricing.output.toFixed(2)} {t("per1MTokens")}
                  </div>
                )}
              </div>
              {loadingModels ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : modelSectionExpanded ? (
                <ChevronUp className="w-5 h-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-5 h-5 text-muted-foreground" />
              )}
            </button>

            {/* Expandable Model List */}
            <AnimatePresence>
              {modelSectionExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border-2 border-border/50 bg-muted/20 overflow-hidden">
                    {/* Search */}
                    <div className="p-3 border-b border-border/40">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={t("searchModels")}
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          className="pl-9 h-9"
                        />
                      </div>
                    </div>

                    {/* Model List */}
                    <div className="max-h-[400px] overflow-y-auto p-2">
                      {loadingModels ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent mx-auto mb-2" />
                          {tc("loadingModels")}
                        </div>
                      ) : filteredModels.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          {tc("noModelsFound")}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {Object.entries(filteredGroupedModels).map(
                            ([category, categoryModels]) => (
                              <div key={category}>
                                {provider === "openrouter" && (
                                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 py-1">
                                    {category}
                                  </div>
                                )}
                                <div className="space-y-1">
                                  {categoryModels.map((m) => (
                                    <button
                                      key={m.id}
                                      type="button"
                                      onClick={() => handleModelChange(m.id)}
                                      className={cn(
                                        "w-full flex flex-col items-start gap-1 p-3 rounded-lg text-left transition-colors",
                                        m.id === model
                                          ? "bg-primary/10 border border-primary/20"
                                          : "hover:bg-accent border border-transparent",
                                      )}
                                    >
                                      <div className="flex items-center justify-between w-full gap-2 min-w-0">
                                        <span className="font-medium truncate min-w-0 flex-1">
                                          {m.name}
                                        </span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                                            ${m.pricing.input.toFixed(2)}/$
                                            {m.pricing.output.toFixed(2)}
                                          </span>
                                          {m.id === model && (
                                            <Check className="h-4 w-4 text-primary" />
                                          )}
                                        </div>
                                      </div>
                                      {m.description && (
                                        <span className="text-xs text-muted-foreground line-clamp-1 w-full">
                                          {m.description}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Credentials Section */}
        <div
          className={cn(
            "space-y-4 transition-opacity duration-300",
            isDisabled && "opacity-50 pointer-events-none",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <span>{t("credentials")}</span>
          </div>

          <div className="space-y-4">
            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-sm font-medium">
                {t("apiKey")}
              </Label>
              <Input
                id="api-key"
                type="password"
                placeholder={t("apiKeyPlaceholder", { provider: t(`providerNames.${provider}`) })}
                value={apiKey}
                disabled={isDisabled}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                className="font-mono text-sm"
              />
              <div className="flex items-center gap-2">
                <a
                  href={providerConfig.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  {t("getApiKey", { provider: providerConfig.name })}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{t(`providerGuidance.${provider}.whatIs`)}</p>
                <p>{t(`providerGuidance.${provider}.credits`)}</p>
                <p>{t(`providerGuidance.${provider}.freeModels`)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
