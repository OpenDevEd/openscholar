"use client";

import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useCurrentSearchFormState, useUpdateSearchFilter } from '@/lib/hooks';
import { useAppToast } from '@/lib/toast';
import { useTranslations } from 'next-intl';

export function ReviewFilter() {
  const toast = useAppToast();
  const tf = useTranslations("searchFilters");
  const { reviewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleToggle = (checked: boolean) => {
    updateFilter({ reviewFilter: checked });
    toast.entity.updated(
      tf("reviewFilter"),
      checked ? tf("reviewFilterEnabled") : tf("reviewFilterDisabled")
    );
  };

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <Label htmlFor="review-filter" className="text-sm font-medium">
          {tf("reviewFilterLabel")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {tf("reviewFilterDescription")}
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
