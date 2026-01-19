"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Database, Plus, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CommandCenterContainer, CommandCenterHeader } from "@/components/command-center";
import { AnalysisListItem } from "./analysis-list-item";
import { AnalysisCreateDialog } from "./analysis-create-dialog";
import { motion } from "motion/react";
import { subtleSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";

export function ExtractionCommandCenter() {
  const router = useRouter();
  const [searchFilter, setSearchFilter] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Get current user to fetch their analyses
  const currentUser = useQuery(api.users.queries.me);
  const analyses = useQuery(
    api.extraction.analyses.list,
    currentUser ? { userId: currentUser._id } : "skip"
  );

  // Filter analyses
  const filteredAnalyses = React.useMemo(() => {
    if (!analyses || !searchFilter.trim()) return analyses || [];
    const query = searchFilter.toLowerCase();
    return analyses.filter((a) => {
      const matchesName = a.name.toLowerCase().includes(query);
      const matchesDescription = a.description?.toLowerCase().includes(query);
      return matchesName || matchesDescription;
    });
  }, [analyses, searchFilter]);

  const handleCreateAnalysis = () => {
    setCreateDialogOpen(true);
  };

  const handleAnalysisCreated = (analysisId: string) => {
    setCreateDialogOpen(false);
    router.push(`/extraction/${analysisId}`);
  };

  if (!currentUser) {
    return (
      <CommandCenterContainer>
        <div className="p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
        </div>
      </CommandCenterContainer>
    );
  }

  return (
    <>
      <CommandCenterContainer>
        <CommandCenterHeader
          icon={Database}
          title="Data Extraction"
          description="Extract structured data from academic papers"
          count={filteredAnalyses.length}
          singular="analysis"
          plural="analyses"
        />

        {/* Simple Toolbar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...subtleSpring, delay: 0.15 }}
          className="px-4 md:px-6 py-3 border-b border-border/40 flex items-center gap-3"
        >
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search analyses..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className={cn(
                "pl-9 pr-9 h-9",
                "bg-muted/30 dark:bg-muted/20",
                "border-border/50"
              )}
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button onClick={handleCreateAnalysis} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Analysis
          </Button>
        </motion.div>

        {/* List */}
        <div className="p-6">
          {filteredAnalyses.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={subtleSpring}
              className="flex flex-col items-center justify-center py-16 px-4"
            >
              <div className="w-16 h-16 rounded-2xl mb-6 bg-gradient-to-br from-muted/80 to-muted/40 flex items-center justify-center border border-border/50">
                {searchFilter ? (
                  <Search className="h-7 w-7 text-muted-foreground" />
                ) : (
                  <Database className="h-7 w-7 text-muted-foreground" />
                )}
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {searchFilter ? "No analyses found" : "No analyses yet"}
              </h3>
              <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
                {searchFilter
                  ? "Try adjusting your search"
                  : "Create your first data extraction analysis"}
              </p>
              {!searchFilter && (
                <Button onClick={handleCreateAnalysis}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Analysis
                </Button>
              )}
            </motion.div>
          ) : (
            <div className="space-y-3">
              {filteredAnalyses.map((analysis) => (
                <AnalysisListItem
                  key={analysis._id}
                  analysis={analysis}
                  onClick={() => router.push(`/extraction/${analysis._id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </CommandCenterContainer>

      <AnalysisCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleAnalysisCreated}
      />
    </>
  );
}
