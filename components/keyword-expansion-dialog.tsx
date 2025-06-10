"use client"

import React, { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Trash2, Plus, Edit2, BookOpen } from "lucide-react"
import { useKeywordExpansionStore } from "@/lib/store"
import { toast } from "sonner"

interface KeywordExpansionDialogProps {
  children: React.ReactNode
}

export function KeywordExpansionDialog({ children }: KeywordExpansionDialogProps) {
  const { keywords, addKeyword, updateKeyword, removeKeyword, clearKeywords } = useKeywordExpansionStore()
  const [isOpen, setIsOpen] = useState(false)
  const [newShorthand, setNewShorthand] = useState('')
  const [newExpansion, setNewExpansion] = useState('')

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
    setNewShorthand('')
    setNewExpansion('')
    toast.success(`Keyword "${shorthand}" added successfully`)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Keyword Expansion
          </DialogTitle>
          <DialogDescription>
            Create shortcuts for commonly used search terms. Use "keyword..." in your search to expand them automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Card>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="shorthand">Keyword</Label>
                    <Input
                      id="shorthand"
                      placeholder="e.g., ml, ai, nlp"
                      value={newShorthand}
                      onChange={(e) => setNewShorthand(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expansion">Expansion</Label>
                    <Input
                      id="expansion"
                      placeholder="e.g., machine learning"
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
                <li>• Example: "ml..." will be expanded to "machine learning"</li>
                <li>• Keywords are case-sensitive and can contain letters, numbers, and dashes</li>
                <li>• You'll see a warning if a keyword isn't found</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 