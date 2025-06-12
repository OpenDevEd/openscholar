"use client"

import React from 'react'
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { KeywordExpansionDialog } from "./keyword-expansion-dialog"
import { KeywordExpansionPreview } from "./keyword-expansion-preview"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { useKeywordExpansionDialogStore, useKeywordExpansionStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import Link from "next/link"

interface KeywordExpansionTooltipProps {
  query: string
  side?: "top" | "bottom" | "left" | "right"
  buttonClassName?: string
  asLink?: boolean
  href?: string
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  [key: string]: any // Allow data attributes
}

export function KeywordExpansionTooltip({ 
  query, 
  side = "bottom", 
  buttonClassName = "",
  asLink = false,
  href,
  variant = "ghost",
  ...props
}: KeywordExpansionTooltipProps) {
  const { isOpen } = useKeywordExpansionDialogStore()
  const { keywords } = useKeywordExpansionStore()

  // Analyze the query for keyword expansion info
  const analyzeQuery = (query: string) => {
    const keywordMatches = [...query.matchAll(/(\w[\w-]*)\.\.\./g)]
    const foundKeywords: string[] = []
    const missingKeywords: string[] = []

    keywordMatches.forEach(match => {
      const keyword = match[1]
      if (keywords[keyword]) {
        foundKeywords.push(keyword)
      } else {
        missingKeywords.push(keyword)
      }
    })

    return {
      expandableCount: foundKeywords.length,
      missingCount: missingKeywords.length,
      hasKeywords: keywordMatches.length > 0
    }
  }

  const { expandableCount, missingCount, hasKeywords } = analyzeQuery(query)

  // Create button content with badges
  const buttonContent = (
    <>
      <BookOpen className="h-4 w-4" />
      <span>Keywords</span>
      
      {/* Badges */}
      {hasKeywords && (
        <div className="absolute -top-1 -right-1 flex flex-col gap-0.5">
          {/* Missing keywords badge (red) */}
          {missingCount > 0 && (
            <span className="h-3 w-3 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold leading-none">
              !
            </span>
          )}
          
          {/* Expandable keywords count badge */}
          {expandableCount > 0 && (
            <span className="h-3 w-3 bg-primary rounded-full text-[8px] text-primary-foreground flex items-center justify-center font-bold leading-none">
              {expandableCount > 9 ? '9+' : expandableCount}
            </span>
          )}
        </div>
      )}
    </>
  )

  const buttonElement = asLink && href ? (
    <Button 
      asChild
      variant={variant}
      size="sm"
      className={cn("flex-shrink-0 relative", buttonClassName)}
      title="Keyword Expansion Preview"
      {...props}
    >
      <Link href={href} className="flex items-center gap-2">
        {buttonContent}
      </Link>
    </Button>
  ) : (
    <KeywordExpansionDialog>
      <Button 
        type="button" 
        variant="outline"
        className={cn("flex-shrink-0 relative", buttonClassName)}
        size="icon"
        title="Keyword Expansion Preview"
        {...props}
      >
        <BookOpen className="h-4 w-4" />
        
        {/* Badges */}
        {hasKeywords && (
          <div className="absolute -top-1 -right-1 flex flex-col gap-0.5">
            {/* Missing keywords badge (red) */}
            {missingCount > 0 && (
              <span className="h-3 w-3 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold leading-none">
                !
              </span>
            )}
            
            {/* Expandable keywords count badge */}
            {expandableCount > 0 && (
              <span className="h-3 w-3 bg-primary rounded-full text-[8px] text-primary-foreground flex items-center justify-center font-bold leading-none">
                {expandableCount > 9 ? '9+' : expandableCount}
              </span>
            )}
          </div>
        )}
      </Button>
    </KeywordExpansionDialog>
  )

  // Don't show tooltip when dialog is open
  if (isOpen) {
    return buttonElement
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          {buttonElement}
        </div>
      </TooltipTrigger>
      <TooltipContent 
        side={side} 
        className="w-80 bg-background text-foreground border shadow-lg p-0 max-w-xs max-h-96 overflow-y-auto scrollbar-hide break-words wrap-anywhere"
      >
        <div className="p-3 break-words wrap-anywhere scrollbar-hide">
          <KeywordExpansionPreview query={query} />
        </div>
      </TooltipContent>
    </Tooltip>
  )
} 