"use client";

import { Suspense } from "react";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer } from "@/components/command-center";
import { JobCreator } from "@/components/extraction/job-creator";

export default function NewExtractionPage() {
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <CommandCenterContainer>
          <Suspense fallback={null}>
            <JobCreator />
          </Suspense>
        </CommandCenterContainer>
      </div>
    </PageWrapper>
  );
}
