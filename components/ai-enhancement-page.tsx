"use client"

import React from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, RefreshCw, Send, Sparkles, Key, Brain, CheckCircle, AlertTriangle, Search } from "lucide-react"
import { useAIConfigStore, useAIConfigDialogStore, useKeywordExpansionDialogStore } from "@/lib/store"
import { enhanceSearchQuery, AIProvider } from "@/app/actions/ai-enhance"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useEffectiveQuery, useCurrentSearchFormState } from "@/lib/hooks"
import { PageHeader } from "@/components/ui/page-header"
import { cn } from "@/lib/utils"
import { submitSearchAndLoadResults } from "@/lib/search-actions"
import { isDateFilterActive } from "@/lib/utils"

interface AIEnhancementPageProps {
  /** Optional initial query to enhance */
  initialQuery?: string
  /** Whether to show back navigation */
  showBackButton?: boolean
  /** Custom back navigation function */
  onBack?: () => void
  /** Function to handle using the enhanced query */
  onQueryChange?: (query: string) => void
}

// Note: Query state is now managed by SWR and search history, not a separate store

export function AIEnhancementPage({ 
  initialQuery = "",
  showBackButton = true,
  onBack,
  onQueryChange
}: AIEnhancementPageProps) {
  const router = useRouter()
  const { provider, apiKey, setProvider, setApiKey } = useAIConfigStore()
  const { isEnhancing, enhancedPreview, setIsEnhancing, setEnhancedPreview } = useAIConfigDialogStore()
  const { suggestedQuery, setSuggestedQuery } = useKeywordExpansionDialogStore()
  const effectiveQuery = useEffectiveQuery()
  
  // Get current search form state for filters
  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
  } = useCurrentSearchFormState()
  
  // Computed filter active state
  const isFilterActive = isDateFilterActive(dateRange, yearRange, filterType)

  // Note: setSuggestedQuery is now handled centrally by QuerySyncProvider
  // No manual initialization needed here

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

  const handleEnhanceQuery = async () => {
    if (!apiKey) {
      toast.error("API Key Required", {
        description: "Please enter your API key first",
      })
      return
    }

    if (!suggestedQuery.trim()) {
      toast.error("Query Required", {
        description: "Please enter a search query to enhance with AI",
      })
      return
    }

    try {
      setIsEnhancing(true)
      
      // Send the expanded query to AI enhancement
      const result = await enhanceSearchQuery(suggestedQuery, provider, apiKey)
      setEnhancedPreview(result)
    } catch (error) {
      toast.error("Enhancement Failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      })
    } finally {
      setIsEnhancing(false)
    }
  }

  const handleUseEnhancedQuery = async () => {
    if (enhancedPreview) {
      try {
        // Create FormData with the enhanced query
        const formData = new FormData()
        formData.set("query", enhancedPreview.enhancedQuery)

        // Submit search and load results with current filters
        const { searchId } = await submitSearchAndLoadResults(
          formData,
          currentSearchField,
          dateRange,
          sortBy,
          yearRange,
          filterType,
          isFilterActive
        )

        // Navigate to the new search results if successful
        if (searchId) {
          toast.success("Enhanced Query Applied", {
            description: "Search completed with enhanced query",
          })
          router.push(`/results/${searchId}`)
        }
      } catch (error) {
        toast.error("Search Failed", {
          description: error instanceof Error ? error.message : "Failed to apply enhanced query",
        })
      }
    }
  }

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else {
      router.back()
    }
  }

  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="AI Query Enhancement"
        description="Enhance your search queries with AI-powered synonyms, operators, and semantic improvements"
        icon={Brain}
        showBackButton={showBackButton}
        onBack={handleBack}
        infoItems={[
          { label: 'AI-powered query optimization', color: 'bg-purple-500' },
          { label: 'Semantic search improvements', color: 'bg-blue-500' },
          { label: 'Advanced operator suggestions', color: 'bg-green-500' }
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Configuration and Query Input (2/3 width on large screens) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Configuration Section */}
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
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder={`Enter your ${provider} API key`}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Query Input Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Query to Enhance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="query">Query to Enhance:</Label>
                <Textarea
                  id="query"
                  value={suggestedQuery}
                  onChange={(e) => setSuggestedQuery(e.target.value)}
                  className="text-sm font-mono min-h-[120px]"
                  placeholder="Enter the search query you want to enhance..."
                />
                <p className="text-xs text-muted-foreground">
                  Edit the query above before enhancing it with AI.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleEnhanceQuery}
                  disabled={isEnhancing || !suggestedQuery.trim() || !apiKey}
                  className="flex-1"
                  variant={enhancedPreview ? "outline" : "default"}
                  size="lg"
                >
                  {isEnhancing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      <span className="animate-pulse">Enhancing...</span>
                    </>
                  ) : enhancedPreview ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Generate New
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Enhance Query
                    </>
                  )}
                </Button>
                {enhancedPreview && (
                  <Button
                    onClick={handleUseEnhancedQuery}
                    variant="default"
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                    size="lg"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Apply Enhanced Query
                  </Button>
                )}
              </div>

              {/* Status Messages */}
              {!apiKey && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Please configure your API key to enhance queries
                  </p>
                </div>
              )}
              
              {!suggestedQuery.trim() && apiKey && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <Search className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Enter a search query to get started
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Enhanced Query Preview (1/3 width on large screens) */}
        <div className="space-y-6">
          {enhancedPreview ? (
            <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-900 dark:text-emerald-100">
                  <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  AI Enhanced Query
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                    Ready
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm p-3 border rounded-lg bg-background/60 break-words font-mono">
                  {enhancedPreview.enhancedQuery.split(/(\(|\)|\bAND\b|\bOR\b)/).map((part, i) => {
                    if (part === "AND" || part === "OR") {
                      return <Badge key={i} variant="outline" className="mx-1 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">{part}</Badge>
                    }
                    return <span key={i}>{part}</span>
                  })}
                </div>
                <div className="p-3 rounded-lg bg-emerald-100/50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium mb-1">AI Explanation:</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    {enhancedPreview.explanation}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Enhancement Yet</h3>
                <p className="text-muted-foreground text-sm">
                  Configure your AI settings and enhance a query to see the results here.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Usage Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">1</span>
                </div>
                <div>
                  <p className="text-sm font-medium">Configure AI Provider</p>
                  <p className="text-xs text-muted-foreground">Choose OpenAI or Google and enter your API key</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-green-600 dark:text-green-400">2</span>
                </div>
                <div>
                  <p className="text-sm font-medium">Enter Search Query</p>
                  <p className="text-xs text-muted-foreground">Type the query you want to enhance</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-purple-600 dark:text-purple-400">3</span>
                </div>
                <div>
                  <p className="text-sm font-medium">Get AI Enhancement</p>
                  <p className="text-xs text-muted-foreground">AI will suggest improvements with explanations</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
} 