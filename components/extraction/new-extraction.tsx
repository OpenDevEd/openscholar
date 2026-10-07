"use client";

import { Suspense } from "react";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import { PageWrapper } from "@/components/PageWrapper";
import { JobCreator } from "@/components/extraction/job-creator";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";
import type { api } from "@/convex/_generated/api";

export function NewExtraction({ preloadedLimits }: { preloadedLimits: Preloaded<typeof api.billing.accounts.myLimits> }) {
  // A plan that sets no limit takes any number of papers.
  const paperLimit = usePreloadedQuery(preloadedLimits)?.request_papers ?? Infinity;

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
