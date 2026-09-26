"use client";

import { Suspense } from "react";
import { useQuery } from "convex/react";
import { PageWrapper } from "@/components/PageWrapper";
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
            <Suspense fallback={null}>
              <JobCreator paperLimit={paperLimit} />
            </Suspense>
          </PageWrapper>
        }
      />
    </div>
  );
}
