"use client"

import React from 'react'
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { KeywordExpansionDialog } from "./keyword-expansion-dialog"
import { KeywordExpansionPreview } from "./keyword-expansion-preview"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

interface KeywordExpansionTooltipProps {
  query: string
  side?: "top" | "bottom" | "left" | "right"
  buttonClassName?: string
}

export function KeywordExpansionTooltip({ 
  query, 
  side = "bottom", 
  buttonClassName = "" 
}: KeywordExpansionTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <KeywordExpansionDialog>
            <Button 
              type="button" 
              variant="outline"
              className={`flex-shrink-0 ${buttonClassName}`}
              size="icon"
              title="Keyword Expansion Preview"
            >
              <BookOpen className="h-4 w-4" />
            </Button>
          </KeywordExpansionDialog>
        </div>
      </TooltipTrigger>
      <TooltipContent 
        side={side} 
        className="w-80 bg-background text-foreground border shadow-lg p-0 max-w-xs max-h-96 overflow-y-auto scrollbar-hide break-words"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          overflowWrap: 'anywhere'
        }}
      >
        <div className="p-3 break-words" style={{ scrollbarWidth: 'none', overflowWrap: 'anywhere' }}>
          <KeywordExpansionPreview query={query} />
        </div>
      </TooltipContent>
    </Tooltip>
  )
} 