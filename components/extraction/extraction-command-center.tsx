"use client";

import { useState, useMemo } from "react";
import { motion } from "motion/react";
import type { Doc } from "@/convex/_generated/dataModel";
import type { ViewMode } from "@/lib/types";
import { JobListItem } from "./job-list-item";
import { Database, Plus, SearchX, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ExtractionJob = Doc<"extractionJobs">;

interface ExtractionCommandCenterProps {
  jobs: ExtractionJob[];
  onNewJob: () => void;
}

export function ExtractionCommandCenter({ jobs, onNewJob }: ExtractionCommandCenterProps) {
  const [viewMode] = useState<ViewMode>("list-detail");
  const [searchFilter, setSearchFilter] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "name">("recent");

  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    if (searchFilter.trim()) {
      const query = searchFilter.toLowerCase();
      result = result.filter(
        (job) =>
          job.name.toLowerCase().includes(query) ||
          (job.description?.toLowerCase().includes(query) ?? false)
      );
    }

    switch (sortBy) {
      case "recent":
        result.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case "oldest":
        result.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case "name":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return result;
  }, [jobs, searchFilter, sortBy]);

  const handleClearFilters = () => {
    setSearchFilter("");
  };

  if (filteredJobs.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="py-24 px-4"
      >
        <div className="max-w-md mx-auto text-center space-y-2">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex justify-center mb-6"
          >
            {searchFilter ? (
              <SearchX className="h-12 w-12 text-muted-foreground opacity-40" />
            ) : (
              <Database className="h-12 w-12 text-muted-foreground opacity-40" />
            )}
          </motion.div>

          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            {searchFilter ? "No matches found" : "No extraction jobs"}
          </h3>

          <p className="text-muted-foreground text-base mb-8">
            {searchFilter
              ? `No jobs matching "${searchFilter}"`
              : "Create your first extraction job to get started with AI-powered data extraction"}
          </p>

          {searchFilter ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
            >
              Clear filter
            </Button>
          ) : null}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Toolbar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between pb-4 border-b border-border/40"
      >
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Input
              type="text"
              placeholder="Search jobs..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="h-11"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {[
              { value: "recent", label: "Recent" },
              { value: "oldest", label: "Oldest" },
              { value: "name", label: "Name" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setSortBy(option.value as typeof sortBy)}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200",
                  sortBy === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="hidden sm:flex items-center gap-2"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filter
          </Button>

          <Button size="sm" onClick={onNewJob}>
            <Plus className="w-4 h-4 mr-1.5" />
            New
          </Button>
        </div>
      </motion.div>

      {/* Jobs Count */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="text-sm text-muted-foreground"
      >
        Showing <span className="font-semibold text-foreground">{filteredJobs.length}</span>{" "}
        {filteredJobs.length === 1 ? "job" : "jobs"}
      </motion.div>

      {/* Jobs List */}
      <div className="space-y-0 divide-y divide-border">
        {filteredJobs.map((job, index) => (
          <JobListItem
            key={job._id}
            job={job}
            viewMode={viewMode}
            index={index}
          />
        ))}
      </div>
    </motion.div>
  );
}
