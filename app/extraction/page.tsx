"use client";

import { Suspense, useEffect, useState } from "react";
import { motion } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Database, Loader2 } from "lucide-react";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { JobCreator } from "@/components/extraction/job-creator";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer, CommandCenterHeader } from "@/components/command-center";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

export default function ExtractionPage() {
  const [showCreator, setShowCreator] = useState(false);
  const jobs = useQuery(api.extraction.queries.getMyJobs, {});

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <Suspense fallback={null}>
          <ZoteroCallbackToast />
        </Suspense>

        <CommandCenterContainer>
          <CommandCenterHeader
            icon={Database}
            title="Extraction Jobs"
            description="Transform research papers into structured datasets using AI-powered extraction"
            count={jobs?.length ?? 0}
            singular="job"
            plural="jobs"
          />

          <div className="p-4 md:p-6 !py-4">
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
              <ExtractionCommandCenter jobs={jobs || []} onNewJob={() => setShowCreator(true)} />
            )}
          </div>
        </CommandCenterContainer>
      </div>
    </PageWrapper>
  );
}

function ZoteroCallbackToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const connected = searchParams.get("zotero_connected");
    const error = searchParams.get("zotero_error");
    if (connected) {
      toast.success("Zotero connected.");
    }
    if (error) {
      toast.error(`Zotero connection failed: ${error}`);
    }
  }, [searchParams]);

  return null;
}
