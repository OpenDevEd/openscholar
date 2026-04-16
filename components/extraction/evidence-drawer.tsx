"use client";

import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { EvidenceQuote } from "@/components/extraction/evidence-quote";
import { CriticVerdictBadge } from "@/components/extraction/critic-verdict-badge";
import type { Id } from "@/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Evidence data shape passed when opening the drawer.
 * Matches the EvidenceDrawerProps contract defined in Plan 03 for WorkbenchShell.
 */
export interface EvidenceDrawerData {
  paperId: string;
  startChar: number;
  endChar: number;
  questionText: string;
  parsingSource?: string;
  modelUsed?: string;
  criticVerdict?: string;
}

interface EvidenceDrawerProps extends Partial<EvidenceDrawerData> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvidenceDrawer({
  open,
  onOpenChange,
  paperId,
  startChar,
  endChar,
  questionText,
  parsingSource,
  modelUsed,
  criticVerdict,
}: EvidenceDrawerProps) {
  const t = useTranslations("extraction.workbench");

  const hasValidEvidence =
    paperId &&
    startChar !== undefined &&
    endChar !== undefined &&
    startChar !== endChar;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base font-semibold">
            {t("evidenceDrawerTitle")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("evidenceDrawerTitle")}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="space-y-6 px-5 py-4">
            {/* Question */}
            {questionText && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("evidenceDrawerQuestion")}
                </p>
                <p className="text-sm leading-[1.43]">{questionText}</p>
              </div>
            )}

            {/* Evidence verbatim slice */}
            {hasValidEvidence && (
              <div>
                <EvidenceQuote
                  paperId={paperId as Id<"extractionPapers">}
                  startChar={startChar!}
                  endChar={endChar!}
                />
              </div>
            )}

            {/* Parsing source badge (GAP-01) */}
            {parsingSource && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("evidenceDrawerSource")}
                </p>
                <Badge variant="secondary">{parsingSource}</Badge>
              </div>
            )}

            {/* Model used */}
            {modelUsed && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("evidenceDrawerModel")}
                </p>
                <p className="text-sm">{modelUsed}</p>
              </div>
            )}

            {/* Critic verdict */}
            {criticVerdict && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("evidenceDrawerVerdict")}
                </p>
                <CriticVerdictBadge
                  verdict={
                    criticVerdict as
                      | "supported"
                      | "unsupported"
                      | "partial"
                      | "timeout"
                  }
                />
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
