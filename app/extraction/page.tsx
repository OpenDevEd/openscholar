"use client";

import { Suspense, useEffect } from "react";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { PageWrapper } from "@/components/PageWrapper";
import { useSearchParams } from "next/navigation";
import { useAppToast } from "@/lib/toast";

export default function ExtractionPage() {
  return (
    <PageWrapper>
      <Suspense fallback={null}>
        <ZoteroCallbackToast />
      </Suspense>
      <ExtractionCommandCenter />
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
