"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Filter } from 'lucide-react';
import { SearchSidebar } from '@/components/search-sidebar';
import { PageHeader } from '@/components/ui/page-header';
import { useSearchFormStore } from '@/lib/store';

export default function FiltersPage({ params }: { params: Promise<{ searchId: string }> }) {
  const router = useRouter();
  const [searchId, setSearchId] = React.useState<string>('');
  const { 
    isFilterActive, 
    isRatingFilterActive, 
    isCountryFilterActive,
    isCountryFocusActive,
    currentSearchField,
    sortBy 
  } = useSearchFormStore();

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

  // Calculate active filters count
  const getActiveFiltersCount = () => {
    let count = 0;
    if (isFilterActive) count++;
    if (isRatingFilterActive) count++;
    if (isCountryFilterActive) count++;
    if (isCountryFocusActive) count++;
    if (currentSearchField !== "title_and_abstract") count++;
    if (sortBy !== "relevance_score:desc") count++;
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