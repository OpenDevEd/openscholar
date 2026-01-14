"use client";

import React, { useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ResultsList } from "./results-list";
import {
  downloadItem,
  downloadEssentialItem,
  downloadAll,
} from "@/lib/search-actions";
import { useSearch } from "@/lib/search";
import { SearchSidebar } from "./search-sidebar";
import { TwoColumnLayout } from "./layout/two-column-layout";
import { PageWrapper } from "./PageWrapper";
import { useIsMobile } from "@/lib/hooks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListFilter, FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Animation configs matching the search command center
const subtleSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
  mass: 0.6,
};

type Direction = 1 | -1;

const slideVariants = {
  enter: (direction: Direction) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: Direction) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
  }),
};

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({
  searchId,
}: ResultsPageContentProps) {
  const router = useRouter();
  const isMobile = useIsMobile();

  // Use the new search context
  const {
    params,
    results,
    totalCount,
    isLoading,
    isValidating,
    toSearchFilters,
  } = useSearch();

  const query = params.q;

  // Create a searchState-like object for download functions
  const searchState = React.useMemo(() => {
    const filters = toSearchFilters();
    return {
      query,
      field: filters.searchField,
      dateRange: filters.dateRange,
      yearRange: filters.yearRange,
    };
  }, [query, toSearchFilters]);

  const handleBackToHome = () => {
    router.push("/");
  };

  // Tab state and animation direction tracking (for mobile)
  const [activeTab, setActiveTab] = useState<"results" | "filters">("results");
  const prevTabRef = useRef<"results" | "filters">(activeTab);
  const directionRef = useRef<Direction>(1);

  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      // results → filters = going right (1), filters → results = going left (-1)
      directionRef.current = activeTab === "filters" ? 1 : -1;
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  // Mobile tab-based layout
  if (isMobile) {

    return (
      <div className="flex flex-col flex-1 w-full h-full">
        <Tabs 
          value={activeTab} 
          onValueChange={(value) => setActiveTab(value as "results" | "filters")}
          className="flex flex-col flex-1 h-full gap-0"
        >
          <TabsList className="w-full rounded-none border-b bg-background h-12 p-0">
            <TabsTrigger 
              value="results" 
              className="flex-1 h-full rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary"
            >
              <FileText className="h-4 w-4 mr-2" />
              Results
            </TabsTrigger>
            <TabsTrigger 
              value="filters" 
              className="flex-1 h-full rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary"
            >
              <ListFilter className="h-4 w-4 mr-2" />
              Filters
            </TabsTrigger>
          </TabsList>
          
          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={directionRef.current}>
              {activeTab === "results" ? (
                <motion.div
                  key="results"
                  custom={directionRef.current}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={subtleSpring}
                  className="absolute inset-0 overflow-auto"
                >
                  <PageWrapper>
                    <div className="container mx-auto p-4 max-w-6xl">
                      <main className="w-full">
                        <ResultsList
                          onDownloadItem={(item, format) =>
                            downloadItem(item, format, searchState)
                          }
                          onDownloadEssentialItem={(item, format) =>
                            downloadEssentialItem(item, format, searchState)
                          }
                          onDownloadAllJSON={() =>
                            downloadAll("json", false, searchState, results)
                          }
                          onDownloadAllCSV={() =>
                            downloadAll("csv", false, searchState, results)
                          }
                          onDownloadAllEssentialJSON={() =>
                            downloadAll("json", true, searchState, results)
                          }
                          onDownloadAllEssentialCSV={() =>
                            downloadAll("csv", true, searchState, results)
                          }
                          isLoading={isLoading}
                          isValidating={isValidating}
                          currentQuery={query}
                          onBackToHome={handleBackToHome}
                        />
                      </main>
                    </div>
                  </PageWrapper>
                </motion.div>
              ) : (
                <motion.div
                  key="filters"
                  custom={directionRef.current}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={subtleSpring}
                  className="absolute inset-0 overflow-auto"
                >
                  <SearchSidebar mode="page" isMobile={true} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Tabs>
      </div>
    );
  }

  // Desktop two-column layout
  return (
    <div className="flex flex-col flex-1 w-full">
      <TwoColumnLayout
        leftColumn={<SearchSidebar mode="panel" />}
        rightColumn={
          <PageWrapper>
            <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
              <main className="w-full">
                <ResultsList
                  onDownloadItem={(item, format) =>
                    downloadItem(item, format, searchState)
                  }
                  onDownloadEssentialItem={(item, format) =>
                    downloadEssentialItem(item, format, searchState)
                  }
                  onDownloadAllJSON={() =>
                    downloadAll("json", false, searchState, results)
                  }
                  onDownloadAllCSV={() =>
                    downloadAll("csv", false, searchState, results)
                  }
                  onDownloadAllEssentialJSON={() =>
                    downloadAll("json", true, searchState, results)
                  }
                  onDownloadAllEssentialCSV={() =>
                    downloadAll("csv", true, searchState, results)
                  }
                  isLoading={isLoading}
                  isValidating={isValidating}
                  currentQuery={query}
                  onBackToHome={handleBackToHome}
                />
              </main>
            </div>
          </PageWrapper>
        }
      />
    </div>
  );
}
