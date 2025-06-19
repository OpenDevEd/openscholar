"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Filter } from 'lucide-react';
import { SearchSidebar } from '@/components/search-sidebar';
import { PageHeader } from '@/components/ui/page-header';
import { useCurrentSearchFormState } from '@/lib/hooks';
import { isDateFilterActive, isRatingFilterActive, isCountryFilterActive, isCountryFocusActive, isCitesFilterActive, isRelatedToFilterActive, DEFAULT_FILTERS } from '@/lib/utils';

interface FiltersPageProps {
  params: Promise<{ searchId: string }>;
}

export default function FiltersPage({ params }: FiltersPageProps) {
  const router = useRouter();
  const [searchId, setSearchId] = React.useState<string>('');
  const {
    selectedRegions,
    selectedCountryFocus,
    currentSearchField,
    sortBy,
    dateRange,
    yearRange,
    filterType,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    relatedToItemId,
  } = useCurrentSearchFormState();

  React.useEffect(() => {
    params.then(({ searchId }) => setSearchId(searchId));
  }, [params]);

  const handleBack = () => {
    if (searchId) {
      router.push(`/results/${searchId}`);
    } else {
      router.back();
    }
  };

  // Calculate active filters count using utility functions
  const getActiveFiltersCount = () => {
    let count = 0;
    if (isDateFilterActive(dateRange, yearRange, filterType)) count++;
    if (isRatingFilterActive(ratingRange, onlyRatedPapers)) count++;
    if (isCountryFilterActive(selectedRegions)) count++;
    if (isCountryFocusActive(selectedCountryFocus)) count++;
    if (isCitesFilterActive(citesItemId)) count++;
    if (isRelatedToFilterActive(relatedToItemId)) count++;
    if (currentSearchField !== DEFAULT_FILTERS.field) count++;
    if (sortBy !== DEFAULT_FILTERS.sortBy) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Search Filters"
        description="Refine your search results with advanced filtering options"
        icon={Filter}
        showBackButton={true}
        onBack={handleBack}
        stats={{
          count: activeFiltersCount,
          label: 'Active Filters',
          singularLabel: 'Active Filter'
        }}
      />

      <SearchSidebar mode="page" />
    </div>
  );
} 