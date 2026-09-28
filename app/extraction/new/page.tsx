"use client";

import { Suspense } from "react";
import { PageWrapper } from "@/components/PageWrapper";
import { JobCreator } from "@/components/extraction/job-creator";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";
import { PAPER_LIMIT } from "@/lib/extraction/limits";

export default function NewExtractionPage() {
  const paperLimit = PAPER_LIMIT;

  return (
    <div className="flex w-full flex-1 flex-col overflow-x-clip">
      <TwoColumnLayout
        sidebarSide="right"
        leftColumn={<BucketSidebar paperLimit={paperLimit} />}
        rightColumn={
          <PageWrapper>
            <Suspense fallback={null}>
              <JobCreator paperLimit={paperLimit} />
            </Suspense>
          </PageWrapper>
        }
      />
    </div>
  );
}
