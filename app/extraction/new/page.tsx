"use client";

import { Suspense } from "react";
import { useQuery } from "convex/react";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer } from "@/components/command-center";
import { JobCreator } from "@/components/extraction/job-creator";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";
import { api } from "@/convex/_generated/api";

export default function NewExtractionPage() {
  const paperLimit =
    useQuery(api.extraction.bucket.queries.getMyPaperLimit, {}) ?? 1000;

  return (
    <div className="flex w-full flex-1 flex-col overflow-x-clip">
      <TwoColumnLayout
        sidebarSide="right"
        leftColumn={<BucketSidebar paperLimit={paperLimit} />}
        rightColumn={
          <PageWrapper>
            <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
              <CommandCenterContainer allowOverflow>
                <Suspense fallback={null}>
                  <JobCreator paperLimit={paperLimit} />
                </Suspense>
              </CommandCenterContainer>
            </div>
          </PageWrapper>
        }
      />
    </div>
  );
}
