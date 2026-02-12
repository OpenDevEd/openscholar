"use client";

import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PageWrapper } from "@/components/PageWrapper";
import { HistoryCommandCenter } from "@/components/history-command-center";

function HistoryPageContent() {
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <HistoryCommandCenter />
      </div>
    </PageWrapper>
  );
}

function HistoryPageFallback() {
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    </PageWrapper>
  );
}

export function HistoryPageClient() {
  return (
    <Suspense fallback={<HistoryPageFallback />}>
      <HistoryPageContent />
    </Suspense>
  );
}
