"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface InsufficientEvidenceCardProps {
  questionText: string;
  reasoning?: string;
  className?: string;
}

export function InsufficientEvidenceCard({
  questionText,
  reasoning,
  className,
}: InsufficientEvidenceCardProps) {
  const t = useTranslations("extraction");

  return (
    <Card
      className={cn("opacity-75 border-dashed", className)}
      role="status"
      aria-live="polite"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          {questionText}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Info
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Badge variant="secondary" className="text-xs font-semibold">
            {t("insufficientEvidence")}
          </Badge>
        </div>
        {reasoning && (
          <p className="text-sm text-muted-foreground leading-[1.43]">
            {reasoning}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
