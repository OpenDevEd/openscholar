import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAIConfigStore, useKeywordExpansionStore } from "@/lib/store";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Send, Settings, Search, Sparkles, Key, Brain, ArrowRight, CheckCircle, AlertTriangle } from "lucide-react";
import { enhanceSearchQuery, AIProvider } from "@/app/actions/ai-enhance";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { validateAndExpandKeywords, validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";

interface AIConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
}

export function AIConfigDialog({ open, onOpenChange, query, onQueryChange }: AIConfigDialogProps) {
  const { provider, apiKey, setProvider, setApiKey } = useAIConfigStore();
  const { expandQuery } = useKeywordExpansionStore();
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState<{
    enhancedQuery: string;
    explanation: string;
  } | null>(null);

  const handleProviderChange = (value: AIProvider) => {
    setProvider(value);
    toast.success("Provider Updated", {
      description: `AI provider set to ${value}`,
    });
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (value) {
      toast.success("API Key Updated", {
        description: "Your API key has been saved securely",
      });
    }
  };

  const handleEnhanceQuery = async () => {
    if (!apiKey) {
      toast.error("API Key Required", {
        description: "Please enter your API key first",
      });
      return;
    }

    if (!query.trim()) {
      toast.error("Query Required", {
        description: "Please enter a search query first",
      });
      return;
    }

    try {
      setIsEnhancing(true);
      
      // Validate and expand keywords before sending to AI
      const validation = validateAndExpandKeywords(query);
      if (!validation.isValid) {
        // Validation already showed warning toasts, just stop the enhancement
        return;
      }
      
      // Send the expanded query to AI enhancement
      const result = await enhanceSearchQuery(validation.expandedQuery, provider, apiKey);
      setEnhancedPreview(result);
    } catch (error) {
      toast.error("Enhancement Failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleUseEnhancedQuery = () => {
    if (enhancedPreview) {
      onQueryChange(enhancedPreview.enhancedQuery);
      onOpenChange(false);
      toast.success("Enhanced Query Applied", {
        description: "The enhanced query has been added to the search box",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[475px] max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0 border-b pb-6">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                <Brain className="h-5 w-5 text-slate-600 dark:text-slate-400" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                <Sparkles className="h-2.5 w-2.5 text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg font-semibold text-foreground mb-1">
                AI Query Enhancement
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                Enhance your search queries with AI-powered synonyms, operators, and semantic improvements
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div 
          className="grid gap-6 py-4 overflow-y-auto overflow-x-hidden flex-1 min-h-0 scrollbar-hide" 
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {/* Configuration Section */}
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4 space-y-4">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                AI Provider
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleProviderChange('openai')}
                  className={`p-3 rounded-xl border-2 transition-all duration-200 ${
                    provider === 'openai'
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/50'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      provider === 'openai' 
                        ? 'bg-green-500' 
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}>
                      <div className={`w-3 h-3 rounded-full ${
                        provider === 'openai' ? 'bg-white' : 'bg-green-500'
                      }`}></div>
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
                  className={`p-3 rounded-xl border-2 transition-all duration-200 ${
                    provider === 'google'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      provider === 'google' 
                        ? 'bg-blue-500' 
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}>
                      <div className={`w-3 h-3 rounded-full ${
                        provider === 'google' ? 'bg-white' : 'bg-blue-500'
                      }`}></div>
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
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  API Key
                </Label>
                {apiKey && (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-xs text-green-600 dark:text-green-400">Active</span>
                  </div>
                )}
              </div>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="sk-..."
                className="bg-white dark:bg-slate-800 border-0 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>
          
          {/* Current Query */}
          <div className="p-4 border rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 transition-all duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
                <Search className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <Label className="font-medium text-sm">Current Query</Label>
            </div>
            <div className="text-sm p-3 border rounded-lg bg-white/60 dark:bg-slate-900/60 font-mono">
              {query || (
                <span className="text-muted-foreground italic">No query entered</span>
              )}
            </div>
            {(() => {
              if (!query.trim()) return null;
              const validation = validateAndExpandKeywordsSilently(query);
              // Only show preview if validation passes and query actually expanded
              if (!validation.isValid || validation.expandedQuery === query) return null;
              return (
                <div className="mt-4 animate-in fade-in-50 duration-300">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <Label className="text-xs text-muted-foreground">Will be enhanced as:</Label>
                  </div>
                  <div className="p-3 border rounded-lg bg-green-100 dark:bg-green-950/50 border-green-200 dark:border-green-800">
                    <span className="text-green-800 dark:text-green-100 break-words overflow-wrap-anywhere font-mono text-sm">
                      {validation.expandedQuery}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Enhanced Query Preview */}
          {enhancedPreview && (
            <div className="p-4 border rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 animate-in fade-in-50 slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400 animate-pulse" />
                </div>
                <Label className="font-medium text-sm">AI Enhanced Query</Label>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                  Ready
                </Badge>
              </div>
              <div className="text-sm p-3 border rounded-lg bg-white/60 dark:bg-slate-900/60 break-words font-mono">
                {enhancedPreview.enhancedQuery.split(/(\(|\)|\bAND\b|\bOR\b)/).map((part, i) => {
                  if (part === "AND" || part === "OR") {
                    return <Badge key={i} variant="outline" className="mx-1 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">{part}</Badge>;
                  }
                  return <span key={i}>{part}</span>;
                })}
              </div>
              <div className="mt-3 p-3 rounded-lg bg-emerald-100/50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium mb-1">AI Explanation:</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  {enhancedPreview.explanation}
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2 px-1">
            <Button
              onClick={handleEnhanceQuery}
              disabled={isEnhancing || !query.trim() || !apiKey}
              className="flex-1 transition-all duration-200 hover:scale-[1.02] hover:shadow-md"
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
                className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 transition-all duration-200 hover:scale-[1.02] hover:shadow-md"
                size="lg"
              >
                <Send className="mr-2 h-4 w-4" />
                Use Query
              </Button>
            )}
          </div>
          
          {/* Status Messages */}
          {!apiKey && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <p className="text-xs text-yellow-700 dark:text-yellow-300">
                Please configure your API key to enhance queries
              </p>
            </div>
          )}
          
          {!query.trim() && apiKey && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <Search className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Enter a search query to get started
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 