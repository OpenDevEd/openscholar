"use client"

import React from 'react'
import { useTranslations } from "next-intl"
import { useKeywordExpansionStore } from "@/lib/store"
import { Badge } from "@/components/ui/badge"
import { TooltipHint } from "@/components/ui/tooltip"

interface KeywordExpansionPreviewProps {
  query: string
}

export function KeywordExpansionPreview({ query }: KeywordExpansionPreviewProps) {
  const tb = useTranslations("bookmarksPage")
  const tl = useTranslations("labels")
  const { expandQuery, keywords } = useKeywordExpansionStore()
  
  if (!query.trim()) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">{tb("bookmarkExpansionPreview")}</p>
        <p className="text-xs text-muted-foreground">
          {tb("typeQueryToPreview")}
        </p>
      </div>
    )
  }

  // Check if query contains any expandable keywords
  const hasKeywords = /(\w[\w-]*)\.\.\./g.test(query)
  
  if (!hasKeywords) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">{tb("bookmarkExpansionPreview")}</p>
        <div className="p-2 bg-muted/50 rounded text-xs">
          <span className="text-muted-foreground">{tl("original")}: </span>
          <span>{query}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {tb("noExpandableBookmarks")}
        </p>
      </div>
    )
  }

  const { expandedQuery } = expandQuery(query)
  const hasExpansions = expandedQuery !== query

  // Parse the query to identify expanded vs original parts
  const parts: Array<{ text: string; isExpanded: boolean; originalKeyword?: string }> = []
  let lastIndex = 0
  
  query.replace(/(\w[\w-]*)\.\.\./g, (match, keyword, index) => {
    // Add text before the keyword
    if (index > lastIndex) {
      parts.push({ text: query.slice(lastIndex, index), isExpanded: false })
    }
    
    // Add the expansion or original if not found
    const bookmarkData = keywords[keyword]
    if (bookmarkData?.expansion) {
      parts.push({ text: bookmarkData.expansion, isExpanded: true, originalKeyword: keyword })
    } else {
      parts.push({ text: match, isExpanded: false })
    }
    
    lastIndex = index + match.length
    return match
  })
  
  // Add any remaining text
  if (lastIndex < query.length) {
    parts.push({ text: query.slice(lastIndex), isExpanded: false })
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{tb("bookmarkExpansionPreview")}</p>
      
      <div className="space-y-2">
        <div className="p-2 bg-muted/30 rounded-md">
          <p className="text-xs text-muted-foreground mb-1">{tl("original")}:</p>
          <p className="text-sm font-mono">{query}</p>
        </div>
        
        {hasExpansions && (
          <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
            <p className="text-xs text-muted-foreground mb-2">{tb("expanded")}</p>
            <div className="flex flex-wrap gap-1 text-sm break-words">
              {parts.map((part) => (
                <span key={`${part.originalKeyword ?? ""}-${part.text}`} className="inline-flex">
                  {part.isExpanded ? (
                    <TooltipHint label={tb("expandedFrom", { keyword: part.originalKeyword ?? "" })}>
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 text-xs rounded-md break-words whitespace-normal max-w-full inline-block"
                      >
                        <span className="break-words overflow-wrap-anywhere">{part.text}</span>
                      </Badge>
                    </TooltipHint>
                  ) : (
                    <span className="text-foreground break-words overflow-wrap-anywhere">{part.text}</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {!hasExpansions && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {tb("someBookmarksNotFound")}
        </p>
      )}
      
      <div className="text-xs text-muted-foreground pt-1 border-t">
        <p>{tb("bookmarksHighlighted")}</p>
      </div>
    </div>
  )
} 