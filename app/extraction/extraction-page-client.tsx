"use client";

import React, { Suspense, useEffect } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { PageWrapper } from "@/components/PageWrapper";
import { ExtractionCommandCenter } from "@/components/extraction/extraction-command-center";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function ExtractionPageContent() {
  const searchParams = useSearchParams();
  const isZoteroConnected = searchParams.get("zotero_connected") === "true";

  useEffect(() => {
    if (isZoteroConnected) {
      const timer = setTimeout(() => {
        window.close();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isZoteroConnected]);

  if (isZoteroConnected) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md text-center border-emerald-500/20 bg-emerald-500/5">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            </div>
            <CardTitle className="text-2xl font-bold text-foreground">
              Connection Successful
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Your Zotero account has been successfully connected. You can now
              close this window and return to the application.
            </p>
            <div className="pt-4">
              <Button
                onClick={() => window.close()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Close Window
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/50">
              This window will close automatically...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
