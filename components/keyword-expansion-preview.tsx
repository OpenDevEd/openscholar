"use client"

import React from 'react'
import { useKeywordExpansionStore } from "@/lib/store"
import { Badge } from "@/components/ui/badge"

interface KeywordExpansionPreviewProps {
  query: string
}

export function KeywordExpansionPreview({ query }: KeywordExpansionPreviewProps) {
  const { expandQuery, keywords } = useKeywordExpansionStore()
  
  if (!query.trim()) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Keyword Expansion Preview</p>
        <p className="text-xs text-muted-foreground">
          Type a query with "keyword..." to see expansion preview
        </p>
      </div>
    )
  }

  // Check if query contains any expandable keywords
  const hasKeywords = /(\w[\w-]*)\.\.\./g.test(query)
  
  if (!hasKeywords) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Keyword Expansion Preview</p>
        <div className="p-2 bg-muted/50 rounded text-xs">
          <span className="text-muted-foreground">Original: </span>
          <span>{query}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          No expandable keywords found. Use "keyword..." format.
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
    const expansion = keywords[keyword]
    if (expansion) {
      parts.push({ text: expansion, isExpanded: true, originalKeyword: keyword })
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
      <p className="text-sm font-medium">Keyword Expansion Preview</p>
      
      <div className="space-y-2">
        <div className="p-2 bg-muted/30 rounded-md">
          <p className="text-xs text-muted-foreground mb-1">Original:</p>
          <p className="text-sm font-mono">{query}</p>
        </div>
        
        {hasExpansions && (
          <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
            <p className="text-xs text-muted-foreground mb-2">Expanded:</p>
            <div className="flex flex-wrap gap-1 text-sm break-words">
              {parts.map((part, index) => (
                <span key={index} className="inline-flex">
                  {part.isExpanded ? (
                    <Badge 
                      variant="secondary" 
                      className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 text-xs rounded-md break-words whitespace-normal max-w-full inline-block"
                      title={`Expanded from "${part.originalKeyword}..."`}
                    >
                      <span className="break-words overflow-wrap-anywhere">{part.text}</span>
                    </Badge>
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
          Some keywords were not found in your expansion list.
        </p>
      )}
      
      <div className="text-xs text-muted-foreground pt-1 border-t">
        <p>💡 Keywords are highlighted when expanded</p>
      </div>
    </div>
  )
} 