"use client"

import React from 'react'
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Key } from "lucide-react"
import { useAIConfigStore } from "@/lib/store"
import { AIProvider } from "@/app/actions/ai-enhance"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export function AIConfig() {
  const { provider, apiKey, setProvider, setApiKey, budget, setBudget, dollarsUsed } = useAIConfigStore()

  const handleProviderChange = (value: AIProvider) => {
    setProvider(value)
    toast.success("Provider Updated", {
      description: `AI provider set to ${value}`,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          AI Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
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
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  provider === 'openai' 
                    ? 'bg-green-500' 
                    : 'bg-muted'
                )}>
                  <div className={cn(
                    "w-4 h-4 rounded-full",
                    provider === 'openai' ? 'bg-white' : 'bg-green-500'
                  )}></div>
                </div>
                <div>
                  <div className="text-sm font-medium">OpenAI</div>
                  <div className="text-xs text-muted-foreground">GPT-4</div>
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
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  provider === 'google' 
                    ? 'bg-blue-500' 
                    : 'bg-muted'
                )}>
                  <div className={cn(
                    "w-4 h-4 rounded-full",
                    provider === 'google' ? 'bg-white' : 'bg-blue-500'
                  )}></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Google</div>
                  <div className="text-xs text-muted-foreground">Gemini</div>
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* API Key Input */}
        <div className="space-y-2">
          <Label htmlFor="ai-config-api-key">API Key</Label>
          <Input
            id="ai-config-api-key"
            type="password"
            placeholder={`Enter your ${provider} API key`}
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
          />
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
      </CardContent>
    </Card>
  )
} 