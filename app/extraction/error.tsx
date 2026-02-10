"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ExtractionErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/extraction/error]", error);
  }, [error]);

  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-semibold">Extraction page unavailable</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          This extraction view encountered an unexpected issue. Retry, or go back to your job list.
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={reset}>Retry</Button>
          <Button variant="outline" asChild>
            <Link href="/extraction">Back to Jobs</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
