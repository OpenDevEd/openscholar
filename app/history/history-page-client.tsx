"use client";

import React, { Suspense } from "react";
import { PageWrapper } from "@/components/PageWrapper";
import { HistoryCommandCenter, HistoryLoading } from "@/components/history-command-center";

export function HistoryPageClient() {
  return (
    <PageWrapper>
      <Suspense fallback={<HistoryLoading />}>
        <HistoryCommandCenter />
      </Suspense>
    </PageWrapper>
  );
}
