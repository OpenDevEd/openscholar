# Adding New Filters to OpenAlex Search

This guide provides a comprehensive step-by-step process for adding new filters to the OpenAlex search application. Follow these steps in order to ensure proper integration across all components.

## Overview

The filter system is built with:
- **Type safety**: TypeScript interfaces ensure consistency
- **State management**: Zustand store handles filter state
- **Query enhancement**: Filters modify search queries sent to OpenAlex API
- **UI components**: Reusable filter components with consistent styling
- **History tracking**: All filters are saved and displayed in search history

## Step-by-Step Implementation

### 1. Update Type Definitions (`lib/types.ts`)

Add your new filter property to the `SearchFilters` interface:

```typescript
export interface SearchFilters {
  // ... existing filters
  
  // Add your new filter
  yourNewFilter: boolean; // or string, number, array, etc.
}
```

### 2. Update Default Values (`lib/utils.ts`)

Add the default value to the `DEFAULT_FILTERS` object:

```typescript
export const DEFAULT_FILTERS = {
  // ... existing defaults
  
  yourNewFilter: false, // or appropriate default value
} as const;
```

Update the `createDefaultFilters()` function:

```typescript
export function createDefaultFilters(): SearchFilters {
  return {
    // ... existing filters
    
    yourNewFilter: DEFAULT_FILTERS.yourNewFilter,
  };
}
```

Add a utility function to check if your filter is active:

```typescript
export function isYourNewFilterActive(filterValue: any): boolean {
  return filterValue !== DEFAULT_FILTERS.yourNewFilter;
}
```

### 3. Update Store State (`lib/store.ts`)

Add your filter to the `SearchResult` type:

```typescript
export interface SearchResult {
  // ... existing properties
  
  yourNewFilter?: boolean; // or appropriate type
}
```

### 4. Update State Management (`lib/hooks.ts`)

Add your filter to the `useCurrentSearchFormState()` hook:

```typescript
export function useCurrentSearchFormState() {
  // ... existing code
  
  return {
    // ... existing filters
    
    yourNewFilter: getField('yourNewFilter', DEFAULT_FILTERS.yourNewFilter),
  };
}
```

Update the SWR key in `useSearchResults()` to include your filter:

```typescript
const swrKey = searchState ? [
  'search-results',
  // ... existing parameters
  searchState.yourNewFilter,
] : null;
```

Update the filters object in the fetcher function:

```typescript
const filters: SearchFilters = {
  // ... existing filters
  
  yourNewFilter: searchState?.yourNewFilter || DEFAULT_FILTERS.yourNewFilter,
};
```

### 5. Update Search Actions (`lib/search-actions.ts`)

Update the `createSearchStateWithEffectiveRanges` function:

```typescript
const filters: SearchFilters = {
  // ... existing filters
  
  yourNewFilter: DEFAULT_FILTERS.yourNewFilter, // Will be filled from current search state
};
```

### 6. Update Search Utils (`lib/search-utils.ts`)

Add your filter to the `createSearchStateFromStore` function:

```typescript
export function createSearchStateFromStore(
  query: string,
  filters: SearchFilters,
  resultsCount?: number
) {
  return {
    // ... existing properties
    
    yourNewFilter: filters.yourNewFilter
  };
}
```

Add your filter to the `searchResultToFilters` function:

```typescript
export function searchResultToFilters(searchResult: any): SearchFilters {
  return {
    // ... existing filters
    
    yourNewFilter: searchResult.yourNewFilter || DEFAULT_FILTERS.yourNewFilter
  };
}
```

**If your filter affects the search query**, add query enhancement logic in `getSearchResultsWithFilters`:

```typescript
// Add your filter logic if it modifies the search query
if (filters.yourNewFilter) {
  const yourFilterTerms = '(your search terms here)';
  if (finalApiQuery) {
    finalApiQuery = `(${finalApiQuery}) AND ${yourFilterTerms}`;
  } else {
    finalApiQuery = yourFilterTerms;
  }
}
```

### 7. Create Filter Component (`components/your-new-filter.tsx`)

Create a dedicated component for your filter:

```typescript
"use client";

import React from 'react';
import { Switch } from '@/components/ui/switch'; // or other UI components
import { Label } from '@/components/ui/label';
import { useCurrentSearchFormState, useUpdateSearchFilter } from '@/lib/hooks';
import { updateCurrentSearchFilters } from '@/lib/search-actions';
import { toast } from 'sonner';

export function YourNewFilter() {
  const { yourNewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleChange = async (newValue: any) => {
    updateFilter({ yourNewFilter: newValue });
    await updateCurrentSearchFilters();
    toast.success(newValue ? "Filter applied" : "Filter removed");
  };

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <Label htmlFor="your-filter" className="text-sm font-medium">
          Your Filter Label
        </Label>
        <p className="text-xs text-muted-foreground">
          Description of what this filter does
        </p>
      </div>
      <Switch
        id="your-filter"
        checked={yourNewFilter}
        onCheckedChange={handleChange}
      />
    </div>
  );
}
```

### 8. Update Search Sidebar (`components/search-sidebar.tsx`)

Import your new filter and utility function:

```typescript
import { isYourNewFilterActive } from "@/lib/utils";
import { YourNewFilter } from "./your-new-filter";
```

Add your filter to the state destructuring:

```typescript
const {
  // ... existing filters
  yourNewFilter,
} = useCurrentSearchFormState();
```

Add your filter to the active state calculations:

```typescript
const isYourNewFilterActive = isYourNewFilterActive(yourNewFilter);
```

Create a filter panel component:

```typescript
function YourNewFilterPanel() {
  const { yourNewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = isYourNewFilterActive(yourNewFilter);

  const handleClearFilter = async () => {
    updateFilter({ yourNewFilter: DEFAULT_FILTERS.yourNewFilter });
    await updateCurrentSearchFilters();
  };

  return (
    <FilterWrapper
      title="Your Filter Title"
      icon={YourIcon} // Import appropriate icon
      colorScheme="blue" // Choose: purple, orange, emerald, blue, green, pink
      isActive={isActive}
    >
      <div className="space-y-4">
        <YourNewFilter />
        {isActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearFilter}
            className="w-full h-9 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-950/50"
          >
            <X className="h-4 w-4 mr-2" />
            Clear your filter
          </Button>
        )}
      </div>
    </FilterWrapper>
  );
}
```

Add your filter to the clear all filters function:

```typescript
const handleClearAllFilters = async () => {
  updateFilter({
    // ... existing filters
    yourNewFilter: DEFAULT_FILTERS.yourNewFilter,
  });
  await updateCurrentSearchFilters();
};
```

Add your filter to the active filters count:

```typescript
const getActiveFiltersCount = () => {
  let count = 0;
  // ... existing checks
  if (isYourNewFilterActive) count++;
  return count;
};
```

Add your filter panel to the `SidebarContent`:

```typescript
const SidebarContent = () => (
  <div className="space-y-6">
    {/* ... existing filter panels */}
    
    {/* Your New Filter - Floating Panel */}
    <YourNewFilterPanel />
  </div>
);
```

### 9. Update Search History Display (`components/search-history.tsx`)

Add your filter badge to the filter display section in the `SearchItem` component:

```typescript
{result.yourNewFilter && (
  <span className={cn(
    "bg-blue-50 text-blue-700 py-1 flex items-center gap-1 shrink-0",
    variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
  )}>
    🔧 Your Filter Label
  </span>
)}
```

## Testing Checklist

After implementing your filter, verify these behaviors:

- [ ] **Type safety**: No TypeScript errors
- [ ] **Default state**: Filter starts with correct default value
- [ ] **UI interaction**: Filter component responds to user input
- [ ] **Search updates**: Changing filter triggers search refresh
- [ ] **Query enhancement**: Filter properly modifies search query (if applicable)
- [ ] **Clear functionality**: Individual clear button works
- [ ] **Clear all**: Filter is reset when "Clear all" is clicked
- [ ] **Filter counting**: Active filter count updates correctly
- [ ] **History display**: Filter shows in search history when active
- [ ] **State persistence**: Filter state persists when navigating between searches
- [ ] **SWR caching**: Filter changes invalidate cache appropriately

## Common Patterns

### Boolean Filters (Switch/Toggle)
Use `Switch` component for simple on/off filters like the review filter.

### Range Filters (Sliders)
Use `Slider` component for numeric ranges like rating or year ranges.

### Selection Filters (Dropdowns)
Use `Select` component for choosing from predefined options.

### Multi-select Filters
Use custom components with checkboxes or tag inputs for multiple selections.

### Text Input Filters
Use `Input` component for text-based filters like work IDs.

## Color Schemes

Choose from these predefined color schemes for consistent styling:
- **purple**: Date/time filters
- **orange**: Rating and citation filters  
- **emerald**: Geographic filters
- **blue**: Scope and relation filters
- **green**: Sort options
- **pink**: Content type filters

## Notes

- Always update the SWR cache key when adding new filters
- Server-side filters require `await updateCurrentSearchFilters()`
- Client-side filters (like rating) don't need server updates
- Filter order in sidebar can be customized based on importance
- ID filters (cites, related) automatically move to top when active
- Consider mobile responsive design for your filter UI 