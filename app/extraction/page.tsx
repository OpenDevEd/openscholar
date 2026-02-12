"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Database, Loader2 } from "lucide-react";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer, CommandCenterHeader } from "@/components/command-center";
import { useSearchParams } from "next/navigation";
import { useAppToast } from "@/lib/toast";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

export default function ExtractionPage() {
  const router = useRouter();
  const tc = useTranslations('common');
  const te = useTranslations('extraction');
  const tcc = useTranslations('commandCenter');
  const { data: jobs, isDeferred } = useProtectedQuery(
    api.extraction.queries.getMyJobs,
    {},
  );

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <Suspense fallback={null}>
          <ZoteroCallbackToast />
        </Suspense>

        <CommandCenterContainer>
          <CommandCenterHeader
            icon={Database}
            title={tc("extraction")}
            description={te("extractDescription")}
            count={jobs?.length ?? 0}
            singular={tcc("jobSingular")}
            plural={tcc("jobPlural")}
          />

          <div>
            {isDeferred || jobs === undefined ? (
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
  const toast = useAppToast();

  useEffect(() => {
    const connected = searchParams.get("zotero_connected");
    const error = searchParams.get("zotero_error");
    if (connected) {
      toast.zotero.connected();
    }
    if (error) {
      toast.zotero.failed(error);
    }
  }, [searchParams, toast]);

  return null;
}
