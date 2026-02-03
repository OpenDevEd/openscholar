"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Plus, Database, Loader2 } from "lucide-react";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { JobCreator } from "@/components/extraction/job-creator";
import { PageWrapper } from "@/components/PageWrapper";

export default function ExtractionPage() {
  const [showCreator, setShowCreator] = useState(false);
  const jobs = useQuery(api.extraction.queries.getMyJobs, {});

  return (
    <PageWrapper>
      <div className="min-h-screen bg-background">
        {/* Hero Header Section */}
        <div className="bg-card border-b border-border py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6"
            >
              <div className="space-y-2">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                  className="flex items-center gap-2 text-primary"
                >
                  <Database className="w-5 h-5" />
                  <span className="text-sm font-medium tracking-wider uppercase">
                    Data Pipeline
                  </span>
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.15 }}
                  className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-card-foreground"
                >
                  Extraction Jobs
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.25 }}
                  className="text-muted-foreground text-lg max-w-xl"
                >
                  Transform unstructured research papers into structured datasets using AI-powered extraction
                </motion.p>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.3 }}
              >
                <Button
                  onClick={() => setShowCreator(true)}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-6 text-base shadow-lg transition-all duration-200 hover:-translate-y-0.5"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  New Extraction Job
                </Button>
              </motion.div>
            </motion.div>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-background">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {showCreator ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <JobCreator onCancel={() => setShowCreator(false)} />
              </motion.div>
            ) : jobs === undefined ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <ExtractionCommandCenter jobs={jobs || []} />
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
