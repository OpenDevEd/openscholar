"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { Badge } from "@/components/ui/badge";

export function BucketGate({ children }: { children: ReactNode }) {
  const enabled = useFeatureFlag("extraction.bucket_v2");
  if (enabled) return <>{children}</>;

  return (
    <div
      data-testid="bucket-rollout-notice"
      className="rounded-2xl border border-border/60 bg-muted/30 p-8 text-center"
    >
      <Badge variant="secondary" className="mb-4 gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        Rolling out
      </Badge>
      <h2 className="mt-3 text-xl font-semibold text-foreground">
        Unified paper selection is rolling out
      </h2>
      <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
        The cross-source bucket selection UX is being enabled gradually. It will
        appear on your account automatically.
      </p>
    </div>
  );
}
