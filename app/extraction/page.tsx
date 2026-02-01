"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Plus, Database } from "lucide-react";
import { useState } from "react";
import { motion } from "motion/react";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { JobCreator } from "@/components/extraction/job-creator";
import { PageWrapper } from "@/components/PageWrapper";

export default function ExtractionPage() {
  const [showCreator, setShowCreator] = useState(false);
  const jobs = useQuery(api.extraction.queries.getMyJobs, {});

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="space-y-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Data Extraction</h1>
              <p className="text-sm text-muted-foreground">
                Extract structured data from papers using AI-powered analysis
              </p>
            </div>
            <Button onClick={() => setShowCreator(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Extraction Job
            </Button>
          </div>

          {/* Main Content */}
          {showCreator ? (
            <JobCreator onCancel={() => setShowCreator(false)} />
          ) : (
            <ExtractionCommandCenter jobs={jobs || []} />
          )}
        </motion.div>
      </div>
    </PageWrapper>
  );
}
