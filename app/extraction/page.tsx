"use client";

import { Suspense, useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { PageWrapper } from "@/components/PageWrapper";
import { useSearchParams } from "next/navigation";
import { useAppToast } from "@/lib/toast";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

export default function ExtractionPage() {
  const { data: jobs, isDeferred } = useProtectedQuery(
    api.extraction.queries.getMyJobs,
    {},
  );

  return (
    <PageWrapper>
      <Suspense fallback={null}>
        <ZoteroCallbackToast />
      </Suspense>
      <ExtractionCommandCenter jobs={isDeferred ? undefined : jobs} />
    </PageWrapper>
  );
}

function ZoteroCallbackToast() {
  const searchParams = useSearchParams();
  const toast = useAppToast();

  useEffect(() => {
    const error = searchParams.get("zotero_error");
    if (error) {
      toast.zotero.failed(error);
    }
  }, [searchParams, toast]);

  return null;
}
