"use client";

import { motion } from "motion/react";
import { useExtractionStore } from "@/lib/store/extraction";
import { useSearchHistoryStore } from "@/lib/store";
import { formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Search, Calendar, Check, FileText } from "lucide-react";

export function HistorySelector() {
  const { draftJob, setSelectedHistoryId } = useExtractionStore();
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);

  if (searchHistory.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-16 px-4 bg-muted rounded-xl border border-border"
      >
        <Search className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No search history found
        </h3>
        <p className="text-muted-foreground">
          Perform some searches first to create an extraction job.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-0 divide-y divide-border border border-border rounded-xl overflow-hidden">
      {searchHistory.map((entry: any, index: number) => {
        const isSelected = draftJob.selectedHistoryId === entry.id;
        
        return (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.4,
              delay: index * 0.05,
              ease: [0.22, 1, 0.36, 1],
            }}
            onClick={() => setSelectedHistoryId(entry.id)}
            className={cn(
              "cursor-pointer transition-all duration-200 p-4",
              index % 2 === 0 ? "bg-background" : "bg-muted/30",
              isSelected
                ? "bg-primary/5 border-l-4 border-l-primary"
                : "hover:bg-muted/50 border-l-4 border-l-transparent"
            )}
          >
            <div className="flex items-start gap-4">
              {/* Selection Indicator */}
              <motion.div
                animate={{
                  scale: isSelected ? 1 : 0.9,
                }}
                className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                  isSelected 
                    ? "bg-primary border-primary" 
                    : "bg-transparent border-muted-foreground/30"
                )}
              >
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  >
                    <Check className="w-4 h-4 text-primary-foreground" />
                  </motion.div>
                )}
              </motion.div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-foreground truncate">
                    {entry.query}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatTimeAgo(new Date(entry.createdAt))}</span>
                  </div>

                  <span className="w-1 h-1 rounded-full bg-border" />

                  <div className="flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    <span>{entry.count?.toLocaleString() || 0} results</span>
                  </div>

                  {entry.screeningQuestions?.length > 0 && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span>
                        {entry.screeningQuestions.length} screening questions
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
