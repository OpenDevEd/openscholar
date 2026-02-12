"use client";

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateSearchFilter, useCurrentSearchFormState } from "@/lib/hooks";
import { appToast } from "@/lib/toast";
import { cn, isCitesFilterActive, isCitedByFilterActive, isRelatedToFilterActive } from "@/lib/utils";
import { Quote, Network, ExternalLink, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface WorkIdFilterProps {
  type: 'cites' | 'cited_by' | 'related';
  icon?: LucideIcon;
  colorScheme?: {
    primary: string;
    secondary: string;
    bg: string;
    darkBg: string;
    textPrimary: string;
    textSecondary: string;
    codeBg: string;
    darkCodeBg: string;
  };
}

const defaultColorSchemes = {
  cites: {
    primary: 'text-orange-500',
    secondary: 'text-orange-600',
    bg: 'bg-orange-50',
    darkBg: 'dark:bg-orange-950/20',
    textPrimary: 'text-orange-700',
    textSecondary: 'dark:text-orange-300',
    codeBg: 'bg-orange-100',
    darkCodeBg: 'dark:bg-orange-900/40',
  },
  cited_by: {
    primary: 'text-green-500',
    secondary: 'text-green-600',
    bg: 'bg-green-50',
    darkBg: 'dark:bg-green-950/20',
    textPrimary: 'text-green-700',
    textSecondary: 'dark:text-green-300',
    codeBg: 'bg-green-100',
    darkCodeBg: 'dark:bg-green-900/40',
  },
  related: {
    primary: 'text-blue-500',
    secondary: 'text-blue-600',
    bg: 'bg-blue-50',
    darkBg: 'dark:bg-blue-950/20',
    textPrimary: 'text-blue-700',
    textSecondary: 'dark:text-blue-300',
    codeBg: 'bg-blue-100',
    darkCodeBg: 'dark:bg-blue-900/40',
  },
};

export function WorkIdFilter({ 
  type, 
  icon,
  colorScheme 
}: WorkIdFilterProps) {
  const t = useTranslations("workId");
  
  const {
    citesItemId,
    citedByItemId,
    relatedToItemId,
  } = useCurrentSearchFormState();
  
  const updateFilter = useUpdateSearchFilter();

  const config = {
    cites: {
      label: 'Citation filter',
      description: 'Enter an OpenAlex work ID to find papers that cite that work',
      applyText: 'Apply Filter',
      successMessage: 'Cites filter applied',
      successDescription: (id: string) => `Showing papers that cite work ${id}`,
      clearMessage: 'Cites filter cleared',
      statusText: 'Finding papers that cite: ',
      icon: Quote,
      itemId: citesItemId,
      isActive: isCitesFilterActive(citesItemId),
      updateField: 'citesItemId',
    },
    cited_by: {
      label: 'Cited by filter',
      description: 'Enter an OpenAlex work ID to find papers that are cited by that work',
      applyText: 'Apply Filter',
      successMessage: 'Cited by filter applied',
      successDescription: (id: string) => `Showing papers cited by work ${id}`,
      clearMessage: 'Cited by filter cleared',
      statusText: 'Finding papers cited by: ',
      icon: Quote,
      itemId: citedByItemId,
      isActive: isCitedByFilterActive(citedByItemId),
      updateField: 'citedByItemId',
    },
    related: {
      label: 'Related works filter', 
      description: 'Enter an OpenAlex work ID to find papers related to that work',
      applyText: 'Apply Filter',
      successMessage: 'Related works filter applied',
      successDescription: (id: string) => `Showing papers related to work ${id}`,
      clearMessage: 'Related works filter cleared',
      statusText: 'Finding papers related to: ',
      icon: Network,
      itemId: relatedToItemId,
      isActive: isRelatedToFilterActive(relatedToItemId),
      updateField: 'relatedToItemId',
    },
  };

  const colors = colorScheme || defaultColorSchemes[type];
  const typeConfig = config[type];
  const Icon = icon || typeConfig.icon;
  
  // Get the appropriate store values and methods based on type
  const itemId: string = typeConfig.itemId;
  const isActive = typeConfig.isActive;
  
  const setItemId = (id: string) => {
    const updateData = { [typeConfig.updateField]: id };
    updateFilter(updateData);
  };
  
  const clearFilter = () => {
    const updateData = { [typeConfig.updateField]: '' };
    updateFilter(updateData);
  };
  
  const [inputValue, setInputValue] = useState(itemId || '');
  
  const currentConfig = config[type];
  
  const handleApplyFilter = () => {
    if (!inputValue.trim()) {
      appToast.validation.failed("Please enter a work ID.");
      return;
    }
    
    // Clean and validate the input
    const cleanId = inputValue.trim();
    let validatedId = cleanId;
    
    // If it's a full URL, extract the ID
    if (cleanId.startsWith('https://openalex.org/')) {
      validatedId = cleanId.replace('https://openalex.org/', '');
    }
    
    // Validate the ID format (should start with 'W' for works)
    if (!validatedId.match(/^W\d+$/)) {
      appToast.validation.failed(
        'Work IDs should start with "W" followed by numbers (e.g., W2741809807).'
      );
      return;
    }
    
    // Update the filter in the store
    setItemId(validatedId);
    
    appToast.entity.updated("Work ID filter", currentConfig.successDescription(validatedId));
  };
  
  const handleClearFilter = () => {
    setInputValue('');
    clearFilter();
    
    appToast.entity.cleared("Work ID filter");
  };
  
  const handleInputChange = (value: string) => {
    setInputValue(value);
  };
  
  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleApplyFilter();
    }
  };
  
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${type}-input`} className="text-sm font-medium">
          Work ID
        </Label>
        <div className="relative">
          <Input
            id={`${type}-input`}
            placeholder={t("placeholder")}
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyPress={handleKeyPress}
            className="pr-10"
          />
          {inputValue && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInputValue('')}
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {currentConfig.description}
        </p>
      </div>
      
      <div className="flex gap-2">
        <Button
          onClick={handleApplyFilter}
          disabled={!inputValue.trim()}
          size="sm"
          className="flex-1"
        >
          <Icon className="h-3 w-3 mr-2" />
          {currentConfig.applyText}
        </Button>
        
        {isActive && (
          <Button
            onClick={handleClearFilter}
            variant="outline"
            size="sm"
            className="px-3"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      
             {isActive && itemId && (
         <div className={cn(
           "text-xs text-muted-foreground p-2 rounded-lg space-y-1",
           colors.bg,
           colors.darkBg
         )}>
           <div className="flex items-center gap-2">
             <Icon className={cn("h-3 w-3 flex-shrink-0", colors.primary)} />
             <span className="flex-shrink-0">{currentConfig.statusText}</span>
             <a
               href={itemId.startsWith('https://') ? itemId : `https://openalex.org/${itemId}`}
               target="_blank"
               rel="noopener noreferrer"
               className={cn("ml-auto flex-shrink-0 hover:opacity-80", colors.secondary)}
             >
               <ExternalLink className="h-3 w-3" />
             </a>
           </div>
           <div className="w-full">
             <code className={cn(
               "block w-full px-1 py-0.5 rounded text-xs break-all word-break-all",
               colors.codeBg,
               colors.darkCodeBg,
               colors.textPrimary,
               colors.textSecondary
             )}>
               {itemId.startsWith('https://openalex.org/') ? itemId.replace('https://openalex.org/', '') : itemId}
             </code>
           </div>
         </div>
       )}
    </div>
  );
} 
