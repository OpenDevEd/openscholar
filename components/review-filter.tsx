"use client";

import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useCurrentSearchFormState, useUpdateSearchFilter } from '@/lib/hooks';
import { updateCurrentSearchFilters } from '@/lib/search-actions';
import { toast } from 'sonner';

export function ReviewFilter() {
  const { reviewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleToggle = async (checked: boolean) => {
    updateFilter({ reviewFilter: checked });
    await updateCurrentSearchFilters();
    toast.success(checked ? "Review filter applied" : "Review filter removed");
  };

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <Label htmlFor="review-filter" className="text-sm font-medium">
          Only show reviews
        </Label>
        <p className="text-xs text-muted-foreground">
          Filter for review papers, syntheses, and meta-analyses
        </p>
      </div>
      <Switch
        id="review-filter"
        checked={reviewFilter}
        onCheckedChange={handleToggle}
      />
    </div>
  );
} 