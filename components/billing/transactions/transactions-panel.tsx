import { Suspense } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { TransactionsPanelClient } from "./transactions-panel-client";
import { TransactionsListSkeleton } from "./transactions-list-skeleton";

export interface TransactionsPanelSearchParams {
  jobId?: string | string[];
}

interface Props {
  searchParams: TransactionsPanelSearchParams;
}

export function TransactionsPanel({ searchParams }: Props) {
  const rawJobId = searchParams.jobId;
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;

  return (
    <Suspense fallback={<TransactionsPanelFallback />}>
      <TransactionsPanelClient
        jobId={jobId as Id<"extractionJobs"> | undefined}
      />
    </Suspense>
  );
}

function TransactionsPanelFallback() {
  return (
    <section
      aria-busy="true"
      data-transactions-panel-fallback=""
      className="flex h-[60vh] flex-col rounded-xl border border-border/40 bg-card/90 shadow-sm"
    >
      <TransactionsListSkeleton count={6} />
    </section>
  );
}
