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
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface AIConfigProps {
  variant?: 'card' | 'plain'
}

export function AIConfig({ variant = 'card' }: AIConfigProps) {
  const { provider, model, setProvider, setModel, apiKey, setApiKey, budget, setBudget, dollarsUsed } = useAIConfigStore()

  const [openModels, setOpenModels] = useState(false)
  const [models, setModels] = useState<AIModel[]>([])
  const [modelSearch, setModelSearch] = useState("")
  const [loadingModels, setLoadingModels] = useState(false)

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
    setOpenModels(false)
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

  const groupedModels: Record<string, AIModel[]> = {}
  models.forEach((model) => {
    if (provider === 'openrouter') {
      const category = model.category || 'Other'
      if (!groupedModels[category]) {
        groupedModels[category] = []
      }
      groupedModels[category].push(model)
    } else {
      if (!groupedModels['All']) {
        groupedModels['All'] = []
      }
      groupedModels['All'].push(model)
    }
  })

  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    model.id.toLowerCase().includes(modelSearch.toLowerCase())
  )

  const content = (
    <div className="space-y-6">
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
                <div className="text-xs text-muted-foreground">GPT-4o, o1</div>
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
        <Popover open={openModels} onOpenChange={setOpenModels}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "w-full flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                !selectedModel && "text-muted-foreground"
              )}
            >
              <span className="truncate">
                {selectedModel ? selectedModel.name : `Select ${providerConfig.name} model...`}
              </span>
              {loadingModels && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search models..."
                value={modelSearch}
                onValueChange={setModelSearch}
                className="border-0 focus:ring-0"
              />
              <CommandList>
                {loadingModels ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    Loading models...
                  </div>
                ) : filteredModels.length === 0 ? (
                  <CommandEmpty>No models found</CommandEmpty>
                ) : (
                  Object.entries(groupedModels).map(([category, categoryModels]) => (
                    <CommandGroup key={category} heading={category}>
                      {categoryModels
                        .filter((model) =>
                          model.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
                          model.id.toLowerCase().includes(modelSearch.toLowerCase())
                        )
                        .map((model) => (
                          <CommandItem
                            key={model.id}
                            value={model.id}
                            onSelect={handleModelChange}
                            className="flex flex-col items-start gap-1"
                          >
                            <div className="flex items-center justify-between w-full gap-2">
                              <span className="font-medium truncate min-w-0 flex-1">{model.name}</span>
                              <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                                ${model.pricing.input.toFixed(2)}/${model.pricing.output.toFixed(2)}
                              </span>
                            </div>
                            {model.description && (
                              <span className="text-xs text-muted-foreground line-clamp-1">
                                {model.description}
                              </span>
                            )}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  ))
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
        {content}
      </CardContent>
    </Card>
  )
}
