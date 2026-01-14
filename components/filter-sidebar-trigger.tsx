"use client";

import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import { useState } from "react";
import { SearchSidebar } from "./search-sidebar";
import { useIsMobile, useCurrentSearchFormState } from "@/lib/hooks";
import { motion } from "motion/react";
import { countActiveFilters } from "@/lib/filters";
import { cn } from "@/lib/utils";

const hoverSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 25,
  mass: 0.6,
};

export function FilterSidebarTrigger() {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  
  // Get active filter count for badge
  const {
    dateRange,
    filterType,
    yearRange,
    isYearRangeEnabled,
    ratingRange,
    onlyRatedPapers,
    selectedRegions,
    selectedCountryFocus,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    reviewFilter,
  } = useCurrentSearchFormState();
  
  const activeFiltersCount = countActiveFilters({
    dateRange,
    filterType,
    yearRange,
    isYearRangeEnabled,
    ratingRange,
    onlyRatedPapers,
    selectedRegions,
    selectedCountryFocus,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    reviewFilter,
  });
  
  if (!isMobile) return null;
  
  return (
    <>
      <motion.div
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={hoverSpring}
        className="relative"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="lg:hidden relative"
        >
          <Filter className="h-5 w-5" />
          {activeFiltersCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center text-[10px] font-bold bg-gradient-to-r from-[oklch(0.75_0.15_55)] to-[oklch(0.62_0.16_52)] text-white rounded-full"
            >
              {activeFiltersCount > 9 ? '9+' : activeFiltersCount}
            </motion.span>
          )}
        </Button>
      </motion.div>
      
      <SearchSidebar 
        mode="sheet" 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)}
        isMobile={isMobile}
      />
    </>
  );
}
