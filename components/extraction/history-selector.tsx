"use client";

import { motion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useExtractionStore } from "@/lib/store/extraction";
import { useSearchHistoryStore } from "@/lib/store";
import { formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Search, Calendar, Check } from "lucide-react";

export function HistorySelector() {
  const { draftJob, setSelectedHistoryId } = useExtractionStore();
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);

  if (searchHistory.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No search history found. Perform some searches first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {searchHistory.map((entry: any, index: number) => (
        <motion.div
          key={entry.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <Card
            className={cn(
              "cursor-pointer transition-all duration-200",
              draftJob.selectedHistoryId === entry.id
                ? "ring-2 ring-primary border-primary"
                : "hover:bg-muted/50"
            )}
            onClick={() => setSelectedHistoryId(entry.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5",
                    draftJob.selectedHistoryId === entry.id
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  )}
                >
                  {draftJob.selectedHistoryId === entry.id && (
                    <Check className="w-3 h-3 text-primary-foreground" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium truncate">{entry.query}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span>{formatTimeAgo(new Date(entry.createdAt))}</span>
                    <span className="mx-1">•</span>
                    <Badge variant="secondary" className="text-xs">
                      {entry.count} results
                    </Badge>
                  </div>

                  {entry.screeningQuestions?.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {entry.screeningQuestions.length} screening questions
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
