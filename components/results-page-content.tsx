"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ResultsList } from "./results-list";
import {
  downloadItem,
  downloadEssentialItem,
  downloadAll,
} from "@/lib/search-actions";
import { useAppToast } from "@/lib/toast";
import { useSearch } from "@/lib/search";
import { SearchSidebar } from "./search-sidebar";
import { TwoColumnLayout } from "./layout/two-column-layout";
import { PageWrapper } from "./PageWrapper";
import { useIsMobile } from "@/lib/hooks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListFilter, FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { subtleSpring } from "@/lib/animation-config";
import { useTranslations } from "next-intl";

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
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const toast = useAppToast();
  const downloadLabels = {
    item: tToast("entityItem"),
    essentialItem: tToast("entityEssentialItem"),
    results: tToast("entityResults"),
  };
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

  // Tab state and animation direction (for mobile)
  const [activeTab, setActiveTab] = useState<"results" | "filters">("results");
  // results → filters = going right (1), filters → results = going left (-1)
  const direction: Direction = activeTab === "filters" ? 1 : -1;

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
              className="flex-1 h-full rounded-none transition-colors data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground"
            >
              <FileText className="h-4 w-4 mr-2" />
              {tc("results")}
            </TabsTrigger>
            <TabsTrigger 
              value="filters" 
              className="flex-1 h-full rounded-none transition-colors data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground"
            >
              <ListFilter className="h-4 w-4 mr-2" />
              {tc("filters")}
            </TabsTrigger>
          </TabsList>
          
          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              {activeTab === "results" ? (
                <motion.div
                  key="results"
                  custom={direction}
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
                            downloadItem(item, format, toast, searchState, downloadLabels)
                          }
                          onDownloadEssentialItem={(item, format) =>
                            downloadEssentialItem(item, format, toast, searchState, downloadLabels)
                          }
                          onDownloadAllJSON={() =>
                            downloadAll("json", toast, false, searchState, results, downloadLabels)
                          }
                          onDownloadAllCSV={() =>
                            downloadAll("csv", toast, false, searchState, results, downloadLabels)
                          }
                          onDownloadAllEssentialJSON={() =>
                            downloadAll("json", toast, true, searchState, results, downloadLabels)
                          }
                          onDownloadAllEssentialCSV={() =>
                            downloadAll("csv", toast, true, searchState, results, downloadLabels)
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
                  custom={direction}
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
                    downloadItem(item, format, toast, searchState, downloadLabels)
                  }
                  onDownloadEssentialItem={(item, format) =>
                    downloadEssentialItem(item, format, toast, searchState, downloadLabels)
                  }
                  onDownloadAllJSON={() =>
                    downloadAll("json", toast, false, searchState, results, downloadLabels)
                  }
                  onDownloadAllCSV={() =>
                    downloadAll("csv", toast, false, searchState, results, downloadLabels)
                  }
                  onDownloadAllEssentialJSON={() =>
                    downloadAll("json", toast, true, searchState, results, downloadLabels)
                  }
                  onDownloadAllEssentialCSV={() =>
                    downloadAll("csv", toast, true, searchState, results, downloadLabels)
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
