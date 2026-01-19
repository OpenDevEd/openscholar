"use client";

import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PageWrapper } from "@/components/PageWrapper";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";

function ExtractionPageContent() {
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <ExtractionCommandCenter />
      </div>
    </PageWrapper>
  );
}

function ExtractionPageFallback() {
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    </PageWrapper>
  );
}

export function ExtractionPageClient() {
  return (
    <Suspense fallback={<ExtractionPageFallback />}>
      <ExtractionPageContent />
    </Suspense>
  );
}
