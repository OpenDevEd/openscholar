"use client"

import React, { useEffect, useState } from 'react'
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getProviderIcon, OpenAIIcon, GoogleIcon, AnthropicIcon, OpenRouterIcon } from "@/components/icons/provider-icons"
import { useAIConfigStore } from "@/lib/store"
import { getProviderConfig, getDefaultModelForProvider, getModelsForProvider } from "@/lib/ai-models"
import { fetchOpenRouterModels } from "@/app/actions/openrouter"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { AIModel, AIProvider } from "@/lib/types/ai.types"
import { ArrowLeft, Check, ChevronRight, Search } from "lucide-react"

interface AIConfigProps {
  variant?: 'card' | 'plain'
  onViewChange?: (view: 'config' | 'model-select') => void
}

type View = 'config' | 'model-select'

export function AIConfig({ variant = 'card', onViewChange }: AIConfigProps) {
  const { provider, model, setProvider, setModel, apiKey, setApiKey, budget, setBudget, dollarsUsed } = useAIConfigStore()

  const [view, setViewState] = useState<View>('config')
  const [models, setModels] = useState<AIModel[]>([])
  const [modelSearch, setModelSearch] = useState("")
  const [loadingModels, setLoadingModels] = useState(false)

  const setView = (newView: View) => {
    setViewState(newView)
    onViewChange?.(newView)
  }

  const providerConfig = getProviderConfig(provider)
  const ProviderIcon = getProviderIcon(provider)

  const handleProviderChange = (newProvider: AIProvider) => {
    setProvider(newProvider)
    const defaultModel = getDefaultModelForProvider(newProvider)
    setModel(defaultModel)
    setModels([])
    toast.success("Provider Updated", {
      description: `AI provider set to ${newProvider}`,
    })
  }

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    setView('config')
    setModelSearch("")
    toast.success("Model Updated", {
      description: `AI model set to ${newModel}`,
    })
  }

  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    if (value) {
      toast.success("API Key Updated", {
        description: "Your API key has been saved securely",
      })
    }
  }

  const handleBudgetChange = (value: string) => {
    const num = parseFloat(value)
    if (!isNaN(num) && num >= 0) {
      setBudget(num)
      toast.success("Budget Updated", {
        description: num === 0 ? "Unlimited budget set" : `Budget set to $${num.toFixed(2)}`,
      })
    }
  }

  useEffect(() => {
    const loadModels = async () => {
      if (provider === 'openrouter') {
        setLoadingModels(true)
        try {
          const openRouterModels = await fetchOpenRouterModels()
          setModels(openRouterModels)
        } catch (error) {
          toast.error("Failed to load OpenRouter models", {
            description: error instanceof Error ? error.message : "Unknown error",
          })
        } finally {
          setLoadingModels(false)
        }
      } else {
        setModels(getModelsForProvider(provider))
      }
    }

    loadModels()
  }, [provider, apiKey])

  const selectedModel = models.find((m) => m.id === model)

  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    model.id.toLowerCase().includes(modelSearch.toLowerCase())
  )

  // Group filtered models by category
  const filteredGroupedModels: Record<string, AIModel[]> = {}
  filteredModels.forEach((m) => {
    if (provider === 'openrouter') {
      const category = m.category || 'Other'
      if (!filteredGroupedModels[category]) {
        filteredGroupedModels[category] = []
      }
      filteredGroupedModels[category].push(m)
    } else {
      if (!filteredGroupedModels['All']) {
        filteredGroupedModels['All'] = []
      }
      filteredGroupedModels['All'].push(m)
    }
  })

  // Model Selection View
  const modelSelectView = (
    <div className="p-6 pt-0">
      {/* Sticky Header + Search */}
      <div className="flex-shrink-0 sticky top-0 bg-background pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 pb-4 border-b">
          <button
            type="button"
            onClick={() => {
              setView('config')
              setModelSearch("")
            }}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h3 className="font-semibold">Select Model</h3>
            <p className="text-xs text-muted-foreground">{providerConfig.name}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative py-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search models..."
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Model List - Scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {loadingModels ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent mx-auto mb-2" />
            Loading models...
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No models found
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {Object.entries(filteredGroupedModels).map(([category, categoryModels]) => (
              <div key={category}>
                {provider === 'openrouter' && (
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
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
                          : "hover:bg-accent border border-transparent"
                      )}
                    >
                      <div className="flex items-center justify-between w-full gap-2 min-w-0">
                        <span className="font-medium truncate min-w-0 flex-1">{m.name}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            ${m.pricing.input.toFixed(2)}/${m.pricing.output.toFixed(2)}
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
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const content = (
    <div className="space-y-6 p-6">
      {/* Provider Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">AI Provider</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleProviderChange('openai')}
            className={cn(
              "p-4 rounded-xl border-2 transition-all duration-200",
              provider === 'openai'
                ? 'border-green-500 bg-green-50 dark:bg-green-950/50'
                : 'border-border hover:border-border/80'
            )}
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <OpenAIIcon className={cn(
                "h-10 w-10",
                provider === 'openai' ? 'text-green-500' : 'text-muted-foreground'
              )} />
              <div>
                <div className="text-sm font-medium">OpenAI</div>
                <div className="text-xs text-muted-foreground">GPT</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleProviderChange('google')}
            className={cn(
              "p-4 rounded-xl border-2 transition-all duration-200",
              provider === 'google'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50'
                : 'border-border hover:border-border/80'
            )}
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <GoogleIcon className={cn(
                "h-10 w-10",
                provider === 'google' ? 'text-blue-500' : 'text-muted-foreground'
              )} />
              <div>
                <div className="text-sm font-medium">Google</div>
                <div className="text-xs text-muted-foreground">Gemini</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleProviderChange('anthropic')}
            className={cn(
              "p-4 rounded-xl border-2 transition-all duration-200",
              provider === 'anthropic'
                ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/50'
                : 'border-border hover:border-border/80'
            )}
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <AnthropicIcon className={cn(
                "h-10 w-10",
                provider === 'anthropic' ? 'text-orange-500' : 'text-muted-foreground'
              )} />
              <div>
                <div className="text-sm font-medium">Anthropic</div>
                <div className="text-xs text-muted-foreground">Claude</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleProviderChange('openrouter')}
            className={cn(
              "p-4 rounded-xl border-2 transition-all duration-200",
              provider === 'openrouter'
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/50'
                : 'border-border hover:border-border/80'
            )}
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <OpenRouterIcon className={cn(
                "h-10 w-10",
                provider === 'openrouter' ? 'text-purple-500' : 'text-muted-foreground'
              )} />
              <div>
                <div className="text-sm font-medium">OpenRouter</div>
                <div className="text-xs text-muted-foreground">300+ Models</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Model Selection */}
      <div className="space-y-2">
        <Label>Model</Label>
        <button
          type="button"
          onClick={() => setView('model-select')}
          className={cn(
            "w-full flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent/50 transition-colors",
            !selectedModel && "text-muted-foreground"
          )}
        >
          <span className="truncate">
            {selectedModel ? selectedModel.name : `Select ${providerConfig.name} model...`}
          </span>
          <div className="flex items-center gap-2">
            {loadingModels && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </button>
      </div>

      {/* API Key Input */}
      <div className="space-y-2">
        <Label htmlFor="ai-config-api-key">API Key</Label>
        <Input
          id="ai-config-api-key"
          type="password"
          placeholder={providerConfig.apiKeyPlaceholder}
          value={apiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <a
            href={providerConfig.apiKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Get your {providerConfig.name} API key →
          </a>
        </div>
      </div>

      {/* Budget Input */}
      <div className="space-y-2">
        <Label htmlFor="ai-config-budget">Budget (USD)</Label>
        <Input
          id="ai-config-budget"
          type="number"
          min={0}
          step={0.01}
          value={budget === 0 ? "" : budget.toString()}
          placeholder="Unlimited"
          onChange={(e) => handleBudgetChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {`Leave empty or 0 for no limit. Current spent: $${dollarsUsed.toFixed(2)}`}
        </p>
      </div>
    </div>
  )

  if (variant === 'plain') {
    if (view === 'model-select') {
      return modelSelectView
    }
    return content
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ProviderIcon className="h-5 w-5" />
          AI Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        {view === 'model-select' ? modelSelectView : content}
      </CardContent>
    </Card>
  )
}
