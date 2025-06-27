"use client"

import React from 'react'
import { Button } from "@/components/ui/button"
import { ArrowLeft, LucideIcon } from "lucide-react"

interface InfoItem {
  label: string
  color: string
}

interface PageHeaderProps {
  /** The main page title */
  title: string
  /** Subtitle/description text */
  description: string
  /** Icon to display in the header */
  icon: LucideIcon
  /** Whether to show the back button */
  showBackButton?: boolean
  /** Custom back button handler */
  onBack?: () => void
  /** Statistics to display (number and label) - deprecated, will be ignored */
  stats?: {
    count: number
    label: string
    singularLabel?: string
  }
  /** Quick info items to display in the info bar */
  infoItems?: InfoItem[]
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  showBackButton = false,
  onBack,
  stats, // Keep for backwards compatibility but ignore
  infoItems = []
}: PageHeaderProps) {
  return (
    <div className="mb-8">
      {/* Header content - consistent layout for mobile and desktop */}
      <div className="mb-6">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          {/* Back button - always inline with title */}
          {showBackButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              className="gap-2 flex-shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Button>
          )}
          
          {/* Icon */}
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-primary/20 to-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          </div>
          
          {/* Title and description */}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent break-words">
              {title}
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base lg:text-lg mt-1 break-words">
              {description}
            </p>
          </div>
        </div>
      </div>
      
      {/* Quick Info Bar - Improved mobile layout */}
      {infoItems.length > 0 && (
        <div className="p-3 sm:p-4 bg-muted/30 rounded-lg border">
          <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2 sm:gap-4">
            {infoItems.map((item, index) => (
              <React.Fragment key={index}>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <div className={`w-2 h-2 rounded-full ${item.color} flex-shrink-0`}></div>
                  <span className="break-words">{item.label}</span>
                </div>
                {index < infoItems.length - 1 && (
                  <div className="w-full sm:w-px sm:h-4 h-px bg-border sm:hidden"></div>
                )}
                {index < infoItems.length - 1 && (
                  <div className="w-px h-4 bg-border hidden sm:block"></div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
} 