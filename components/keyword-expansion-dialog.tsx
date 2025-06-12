"use client"

import React from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ModalHeader } from "@/components/ui/modal-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Trash2, Plus, BookOpen, Save } from "lucide-react"
import { useKeywordExpansionStore, useResultsStore, useKeywordExpansionDialogStore, useSearchFormStore } from "@/lib/store"
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation"
import { useEffectiveSearchId } from "@/lib/hooks"
import { toast } from "sonner"
import { useRouter, usePathname } from "next/navigation"

interface KeywordExpansionDialogProps {
  children: React.ReactNode
}

export function KeywordExpansionDialog({ children }: KeywordExpansionDialogProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { keywords, addKeyword, updateKeyword, removeKeyword, clearKeywords } = useKeywordExpansionStore()
  const { currentQuery } = useResultsStore()
  const { 
    isOpen, 
    newShorthand, 
    newExpansion, 
    currentKeyword,
    suggestedQuery,
    setIsOpen,
    setNewShorthand,
    setNewExpansion,
    setCurrentKeyword,
    setSuggestedQuery,
    resetForm
  } = useKeywordExpansionDialogStore()

  const isOnResultsPage = pathname?.startsWith('/results')
  const effectiveSearchId = useEffectiveSearchId()

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return "Keyword cannot be empty"
    if (!/^[a-zA-Z0-9-]+$/.test(keyword)) return "Keywords can only contain letters, numbers, and dashes"
    if (keyword.includes(' ')) return "Keywords cannot contain spaces"
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
      toast.error(`Keyword "${shorthand}" already exists`)
      return
    }
    
    addKeyword(shorthand, expansion)
    resetForm()
    toast.success(`Keyword "${shorthand}" added successfully`)
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
      toast.error(`Keyword "${keyword}" already exists`)
      return
    }
    
    addKeyword(keyword, suggestedQuery)
    setCurrentKeyword('')
    setSuggestedQuery('')
    toast.success(`Search saved as keyword "${keyword}"`)
  }





  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
                      <DialogContent className="sm:max-w-[475px] max-h-[90vh] flex flex-col">
          <ModalHeader
            icon={BookOpen}
            title="Keyword Expansion"
            description='Create shortcuts for commonly used search terms. Use "keyword..." in your search to expand them automatically.'
          />

          <div className="space-y-6 overflow-y-auto overflow-x-hidden flex-1 min-h-0 scrollbar-hide">
          {/* Save Current Search Section */}
          {suggestedQuery && (
            <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800">
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Save className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="font-medium text-emerald-900 dark:text-emerald-100">Save Current Search as Keyword</h4>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="suggested-query">Query to Save:</Label>
                      <Textarea
                        id="suggested-query"
                        value={suggestedQuery}
                        onChange={(e) => setSuggestedQuery(e.target.value)}
                        className="text-sm font-mono min-h-[80px] text-emerald-700 dark:text-emerald-300 bg-background border-emerald-200 dark:border-emerald-800 focus:border-emerald-400 dark:focus:border-emerald-600"
                        placeholder="Edit the query that will be saved as keyword..."
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          placeholder="Enter keyword name (e.g., my-search)"
                          value={currentKeyword}
                          onChange={(e) => setCurrentKeyword(e.target.value)}
                        />
                      </div>
                      <Button 
                        onClick={handleSaveCurrentQuery}
                        disabled={!currentKeyword.trim() || !suggestedQuery.trim()}
                        className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                      >
                        <Save className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                    </div>
                    
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      The query above will be saved as a reusable keyword.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="shorthand">Keyword</Label>
                    <Input
                      id="shorthand"
                      placeholder="e.g., ml"
                      value={newShorthand}
                      onChange={(e) => setNewShorthand(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expansion">Expansion</Label>
                    <Input
                      id="expansion"
                      placeholder={`e.g., AI OR ML OR "artificial intelligence" OR "machine learning"`}
                      value={newExpansion}
                      onChange={(e) => setNewExpansion(e.target.value)}
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleAddKeyword}
                  disabled={!newShorthand.trim() || !newExpansion.trim()}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Keyword
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold">
              Your Keywords ({Object.keys(keywords).length})
            </h3>

            {Object.keys(keywords).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No keywords defined yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(keywords).map(([shorthand, expansion]) => (
                  <Card key={shorthand}>
                    <CardContent>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="secondary" className="flex-shrink-0">{shorthand}...</Badge>
                            <span className="text-muted-foreground flex-shrink-0">→</span>
                          </div>
                          <div className="text-sm break-words overflow-wrap-anywhere">
                            {expansion}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeKeyword(shorthand)}
                          className="text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <Card className="bg-muted/50">
            <CardContent>
              <h4 className="font-medium mb-2">How to use:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Type your keyword followed by "..." in the search box</li>
                <li>{`• Example: (ml...) will be expanded to (AI OR ML OR "artificial intelligence" OR "machine learning")`}</li>
                <li>• Keywords are case-sensitive and can contain letters, numbers, and dashes</li>
                <li>• You'll see a warning if a keyword isn't found</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Close
          </Button>
          <Button 
            variant="outline" 
            onClick={() => {
              setIsOpen(false)
              router.push(isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/keyword-expansion` : '/keyword-expansion')
            }}
          >
            Open Full Page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 