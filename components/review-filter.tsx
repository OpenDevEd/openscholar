"use client";

import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useCurrentSearchFormState, useUpdateSearchFilter } from '@/lib/hooks';
import { appToast } from '@/lib/toast';

export function ReviewFilter() {
  const { reviewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleToggle = (checked: boolean) => {
    updateFilter({ reviewFilter: checked });
    appToast.entity.updated(
      "Review filter",
      checked ? "Review filter is enabled." : "Review filter is disabled."
    );
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
