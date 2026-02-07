"use client";

import { Suspense, useEffect } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Database, Loader2 } from "lucide-react";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer, CommandCenterHeader } from "@/components/command-center";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

export default function ExtractionPage() {
  const router = useRouter();
  const jobs = useQuery(api.extraction.queries.getMyJobs, {});

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <Suspense fallback={null}>
          <ZoteroCallbackToast />
        </Suspense>

        <CommandCenterContainer>
          <CommandCenterHeader
            icon={Database}
            title="Extraction Jobs"
            description="Extract structured data from research papers"
            count={jobs?.length ?? 0}
            singular="job"
            plural="jobs"
          />

          <div>
            {jobs === undefined ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <ExtractionCommandCenter jobs={jobs || []} onNewJob={() => router.push("/extraction/new")} />
            )}
          </div>
        </CommandCenterContainer>
      </div>
    </PageWrapper>
  );
}

function ZoteroCallbackToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const connected = searchParams.get("zotero_connected");
    const error = searchParams.get("zotero_error");
    if (connected) {
      toast.success("Zotero connected.");
    }
    if (error) {
      toast.error(`Zotero connection failed: ${error}`);
    }
  }, [searchParams]);

  return null;
}
