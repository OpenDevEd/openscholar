"use client"

import React from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Trash2, Plus, BookOpen, Save } from "lucide-react"
import { useKeywordExpansionStore, useKeywordExpansionDialogStore } from "@/lib/store"
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { KeywordExpansionPreview } from "./keyword-expansion-preview"
import { PageHeader } from "@/components/ui/page-header"
import { useEffectiveQuery } from "@/lib/hooks"
import { useSearchOptional } from "@/lib/search"

interface KeywordExpansionPageProps {
  /** Optional initial query to suggest for saving as keyword */
  initialSuggestedQuery?: string
  /** Whether to show back navigation */
  showBackButton?: boolean
  /** Custom back navigation function */
  onBack?: () => void
}

export function KeywordExpansionPage({ 
  initialSuggestedQuery = "",
  showBackButton = true,
  onBack
}: KeywordExpansionPageProps) {
  const router = useRouter()
  const { keywords, addKeyword, removeKeyword } = useKeywordExpansionStore()
  const search = useSearchOptional()
  const currentQuery = search?.originalQuery || ''
  const effectiveQuery = useEffectiveQuery()
  
  // Use dialog store for form state (reusing existing logic)
  const { 
    newShorthand, 
    newExpansion, 
    currentKeyword,
    suggestedQuery,
    setNewShorthand,
    setNewExpansion,
    setCurrentKeyword,
    setSuggestedQuery,
    resetForm
  } = useKeywordExpansionDialogStore()

  // Note: setSuggestedQuery is now handled centrally by QuerySyncProvider
  // The suggestedQuery will automatically sync with the navbar query

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return "Bookmark name cannot be empty"
    if (!/^[a-zA-Z0-9-]+$/.test(keyword)) return "Bookmark name can only contain letters, numbers, and dashes"
    if (keyword.includes(' ')) return "Bookmark name cannot contain spaces"
    return null
  }

  const handleAddKeyword = () => {
    const shorthand = newShorthand.trim()
    const expansion = newExpansion.trim()
    
    const validationError = validateKeyword(shorthand)
    if (validationError) {
      toast.error(validationError)
      return
    }
    
    if (!expansion) {
      toast.error("Expansion text cannot be empty")
      return
    }
    
    if (keywords[shorthand]) {
      toast.error(`Bookmark "${shorthand}" already exists`)
      return
    }
    
    addKeyword(shorthand, expansion)
    resetForm()
    toast.success(`Bookmark "${shorthand}" added successfully`)
  }

  const handleSaveCurrentQuery = () => {
    const keyword = currentKeyword.trim()
    
    if (!suggestedQuery.trim()) {
      toast.error("No query to save")
      return
    }
    
    const validationError = validateKeyword(keyword)
    if (validationError) {
      toast.error(validationError)
      return
    }
    
    if (keywords[keyword]) {
      toast.error(`Bookmark "${keyword}" already exists`)
      return
    }
    
    // Expand the query before saving it as a keyword
    const { expandedQuery } = validateAndExpandKeywordsSilently(suggestedQuery)
    
    addKeyword(keyword, expandedQuery)
    setCurrentKeyword('')
    setSuggestedQuery('')
    toast.success(`Search saved as bookmark "${keyword}"`)
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
        title="Bookmarks"
        description="Create shortcuts for commonly used search terms"
        icon={BookOpen}
        showBackButton={showBackButton}
        onBack={handleBack}
        stats={{
          count: Object.keys(keywords).length,
          label: 'Bookmarks',
          singularLabel: 'Bookmark'
        }}
        infoItems={[
          { label: 'Use bookmark... format in search', color: 'bg-green-500' },
          { label: 'Auto-expands to full search terms', color: 'bg-blue-500' },
          { label: 'Saves time on complex queries', color: 'bg-purple-500' }
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Forms (2/3 width on large screens) */}
        <div className="lg:col-span-2 space-y-6">
          {suggestedQuery ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Save Current Search Section */}
              <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-emerald-900 dark:text-emerald-100">
                    <Save className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    Save Current Search as Bookmark
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="suggested-query">Query to Save:</Label>
                      <Textarea
                        id="suggested-query"
                        value={suggestedQuery}
                        onChange={(e) => setSuggestedQuery(e.target.value)}
                        className="text-sm font-mono min-h-[120px] text-emerald-700 dark:text-emerald-300 bg-background border-emerald-200 dark:border-emerald-800 focus:border-emerald-400 dark:focus:border-emerald-600"
                        placeholder="Edit the query that will be saved as bookmark..."
                      />
                    </div>
                    
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <Input
                          placeholder="Enter bookmark name (e.g., my-search)"
                          value={currentKeyword}
                          onChange={(e) => setCurrentKeyword(e.target.value)}
                        />
                      </div>
                      <Button 
                        onClick={handleSaveCurrentQuery}
                        disabled={!currentKeyword.trim() || !suggestedQuery.trim()}
                        className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </Button>
                    </div>
                    
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      The query above will be saved as a bookmark.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Add New Keyword Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Add New Bookmark
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="shorthand">Bookmark</Label>
                        <Input
                          id="shorthand"
                          placeholder="e.g., ml"
                          value={newShorthand}
                          onChange={(e) => setNewShorthand(e.target.value)}
                          className="text-base"
                        />
                        <p className="text-xs text-muted-foreground">
                          Letters, numbers, and dashes only. No spaces.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="expansion">Expansion</Label>
                        <Textarea
                          id="expansion"
                          placeholder={`e.g., AI OR ML OR "artificial intelligence" OR "machine learning"`}
                          value={newExpansion}
                          onChange={(e) => setNewExpansion(e.target.value)}
                          className="min-h-[120px] text-base"
                        />
                        <p className="text-xs text-muted-foreground">
                          The full search terms that will replace your bookmark.
                        </p>
                      </div>
                    </div>
                    <Button 
                      onClick={handleAddKeyword}
                      disabled={!newShorthand.trim() || !newExpansion.trim()}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Bookmark
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            /* Add New Keyword Section - Full width when no suggestion */
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Add New Bookmark
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="shorthand-solo">Bookmark</Label>
                      <Input
                        id="shorthand-solo"
                        placeholder="e.g., ml"
                        value={newShorthand}
                        onChange={(e) => setNewShorthand(e.target.value)}
                        className="text-base"
                      />
                      <p className="text-xs text-muted-foreground">
                        Letters, numbers, and dashes only. No spaces.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="expansion-solo">Expansion</Label>
                      <Textarea
                        id="expansion-solo"
                        placeholder={`e.g., AI OR ML OR "artificial intelligence" OR "machine learning"`}
                        value={newExpansion}
                        onChange={(e) => setNewExpansion(e.target.value)}
                        className="min-h-[120px] text-base"
                      />
                      <p className="text-xs text-muted-foreground">
                        The full search terms that will replace your bookmark.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={handleAddKeyword}
                    disabled={!newShorthand.trim() || !newExpansion.trim()}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Bookmark
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Usage Instructions */}
          <Card className="bg-muted/50">
            <CardHeader>
              <CardTitle className="text-lg">How to use</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  Type your bookmark's name followed by "..." in the search box
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  Example: <code className="bg-muted px-1 rounded text-xs">(ml...)</code> will be expanded to <code className="bg-muted px-1 rounded text-xs">(AI OR ML OR "artificial intelligence" OR "machine learning")</code>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  Bookmarks are case-sensitive and can contain letters, numbers, and dashes
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  You'll see a warning if a bookmark isn't found
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Keywords List (1/3 width, full height) */}
        <div className="lg:col-span-1 space-y-6">
          {/* Keywords List */}
          <Card className="h-fit max-h-[800px] lg:flex lg:flex-col">
            <CardHeader className="lg:flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>Your Bookmarks</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{Object.keys(keywords).length}</Badge>
                  {Object.keys(keywords).length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (confirm('Are you sure you want to clear all bookmarks?')) {
                          Object.keys(keywords).forEach(keyword => removeKeyword(keyword))
                        }
                      }}
                      className="text-destructive hover:bg-destructive/10 h-7 px-2 text-xs"
                    >
                      Clear All
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="lg:flex-1 lg:overflow-hidden lg:flex lg:flex-col">
              {Object.keys(keywords).length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-center py-12 text-muted-foreground">
                  <div>
                    <BookOpen className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">No bookmarks defined yet</p>
                    <p className="text-sm">Add your first bookmark using the forms above.</p>
                  </div>
                </div>
              ) : (
                                <div className="lg:flex-1 lg:overflow-y-auto lg:pr-2 space-y-2">
                  {Object.entries(keywords)
                    .sort(([a], [b]) => a.localeCompare(b)) // Sort alphabetically
                    .map(([shorthand, expansion]) => (
                    <div 
                      key={shorthand} 
                      className="group p-4 rounded-lg border bg-card hover:bg-accent/50 transition-all duration-200 hover:border-primary/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-primary"></div>
                              <span className="font-mono text-sm font-semibold text-foreground">
                                {shorthand}...
                              </span>
                            </div>
                            <div className="h-4 w-px bg-border"></div>
                            <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                              Expands to
                            </span>
                          </div>
                          <div className="pl-5">
                            <div className="text-sm font-mono text-muted-foreground leading-relaxed break-words bg-muted/20 px-3 py-2 rounded border-l-2 border-primary/20">
                              {expansion}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeKeyword(shorthand)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0 transition-all duration-200 rounded-full"
                          title={`Delete bookmark "${shorthand}"`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
} 