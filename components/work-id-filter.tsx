"use client";

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Quote, Network, ExternalLink, LucideIcon } from "lucide-react";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { updateCurrentSearchFilters } from "@/lib/search-actions";
import { toast } from 'sonner';
import { cn, isCitesFilterActive, isRelatedToFilterActive, DEFAULT_FILTERS } from "@/lib/utils";

interface WorkIdFilterProps {
  type: 'cites' | 'related';
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
  const {
    citesItemId,
    relatedToItemId,
  } = useCurrentSearchFormState();
  
  const updateFilter = useUpdateSearchFilter();

  const colors = colorScheme || defaultColorSchemes[type];
  const Icon = icon || (type === 'cites' ? Quote : Network);
  
  // Get the appropriate store values and methods based on type
  const itemId: string = type === 'cites' ? citesItemId : relatedToItemId;
  const isActive = type === 'cites' ? isCitesFilterActive(citesItemId) : isRelatedToFilterActive(relatedToItemId);
  
  const setItemId = (id: string) => {
    if (type === 'cites') {
      updateFilter({ citesItemId: id });
    } else {
      updateFilter({ relatedToItemId: id });
    }
  };
  
  const clearFilter = () => {
    if (type === 'cites') {
      updateFilter({ citesItemId: '' });
    } else {
      updateFilter({ relatedToItemId: '' });
    }
  };
  
  const [inputValue, setInputValue] = useState(itemId || '');
  
  const config = {
    cites: {
      label: 'Citation filter',
      description: 'Enter an OpenAlex work ID to find papers that cite that work',
      applyText: 'Apply Filter',
      successMessage: 'Cites filter applied',
      successDescription: (id: string) => `Showing papers that cite work ${id}`,
      clearMessage: 'Cites filter cleared',
      statusText: 'Finding papers that cite: ',
    },
    related: {
      label: 'Related works filter', 
      description: 'Enter an OpenAlex work ID to find papers related to that work',
      applyText: 'Apply Filter',
      successMessage: 'Related works filter applied',
      successDescription: (id: string) => `Showing papers related to work ${id}`,
      clearMessage: 'Related works filter cleared',
      statusText: 'Finding papers related to: ',
    },
  };
  
  const currentConfig = config[type];
  
  const handleApplyFilter = async () => {
    if (!inputValue.trim()) {
      toast.error('Please enter a work ID');
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
      toast.error('Invalid work ID format', {
        description: 'Work IDs should start with "W" followed by numbers (e.g., W2741809807)'
      });
      return;
    }
    
    // Update the filter in the store
    setItemId(validatedId);
    
    // Trigger search update with the new filter
    try {
      await updateCurrentSearchFilters();
      toast.success(currentConfig.successMessage, {
        description: currentConfig.successDescription(validatedId)
      });
    } catch (error) {
      console.error('Error updating search with filter:', error);
      toast.error('Failed to apply filter', {
        description: 'Could not update search results with the new filter. Please try again.'
      });
    }
  };
  
  const handleClearFilter = async () => {
    setInputValue('');
    clearFilter();
    
    // Trigger search update after clearing the filter
    try {
      await updateCurrentSearchFilters();
      toast.success(currentConfig.clearMessage);
    } catch (error) {
      console.error('Error updating search after clearing filter:', error);
      toast.error('Failed to clear filter', {
        description: 'Could not update search results after clearing the filter. Please try again.'
      });
    }
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
            placeholder="e.g., W2741809807 or https://openalex.org/W2741809807"
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
               {itemId}
             </code>
           </div>
         </div>
       )}
    </div>
  );
} 