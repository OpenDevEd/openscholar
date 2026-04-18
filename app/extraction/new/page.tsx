"use client";

import { Suspense } from "react";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer } from "@/components/command-center";
import { JobCreator } from "@/components/extraction/job-creator";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";

export default function NewExtractionPage() {
  return (
    <div className="flex w-full flex-1 flex-col overflow-x-clip">
      <TwoColumnLayout
        leftColumn={<BucketSidebar />}
        rightColumn={
          <PageWrapper>
            <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
              <CommandCenterContainer>
                <Suspense fallback={null}>
                  <JobCreator />
                </Suspense>
              </CommandCenterContainer>
            </div>
          </PageWrapper>
        }
      />
    </div>
  );
}
