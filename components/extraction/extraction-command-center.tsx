"use client";

import { useState, useMemo } from "react";
import { motion } from "motion/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { CommandCenterHeader } from "@/components/command-center/command-center-header";
import { CommandCenterToolbar } from "@/components/command-center/command-center-toolbar";
import { CommandCenterList } from "@/components/command-center/command-center-list";
import { JobListItem } from "./job-list-item";
import { Database, SearchX } from "lucide-react";
import type { ViewMode } from "@/lib/types";
import { Button } from "@/components/ui/button";

type ExtractionJob = Doc<"extractionJobs">;

interface ExtractionCommandCenterProps {
  jobs: ExtractionJob[];
}

export function ExtractionCommandCenter({ jobs }: ExtractionCommandCenterProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("list-detail");
  const [searchFilter, setSearchFilter] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "name">("recent");

  // Filter and sort jobs
  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    // Apply search filter
    if (searchFilter.trim()) {
      const query = searchFilter.toLowerCase();
      result = result.filter(
        (job) =>
          job.name.toLowerCase().includes(query) ||
          (job.description?.toLowerCase().includes(query) ?? false)
      );
    }

    // Apply sorting
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

  return (
    <CommandCenterContainer>
      <CommandCenterHeader
        icon={Database}
        title="Extraction Jobs"
        description="Manage and monitor your data extraction jobs"
        count={filteredJobs.length}
        singular="job"
        plural="jobs"
      />

      <CommandCenterToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sortOptions={[
          { value: "recent", label: "Most Recent" },
          { value: "oldest", label: "Oldest First" },
          { value: "name", label: "Name (A-Z)" },
        ]}
        currentSort={sortBy}
        onSortChange={(sort) => setSortBy(sort as typeof sortBy)}
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        placeholder="Search jobs..."
        onDownloadJSON={() => {}}
        onDownloadCSV={async () => {}}
        onUploadJSON={async () => {}}
        onUploadCSV={async () => {}}
        onClearAll={() => {}}
        clearTooltip="Clear all jobs"
        totalCount={filteredJobs.length}
      />

      <CommandCenterList
        items={filteredJobs}
        viewMode={viewMode}
        renderItem={(job) => (
          <JobListItem key={job._id} job={job} viewMode={viewMode} />
        )}
        keyExtractor={(job) => job._id}
        emptyIcon={searchFilter ? SearchX : Database}
        emptyTitle={searchFilter ? "No matches found" : "No extraction jobs"}
        emptyDescription={
          searchFilter
            ? `No jobs matching "${searchFilter}"`
            : "Create your first extraction job to get started"
        }
        emptyAction={
          searchFilter ? (
            <Button variant="outline" size="sm" onClick={handleClearFilters}>
              Clear filter
            </Button>
          ) : undefined
        }
        hasFilter={!!searchFilter}
        onClearFilter={handleClearFilters}
      />
    </CommandCenterContainer>
  );
}
