"use client";

import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  cardEntrance,
  cardEntranceTransition,
} from "@/lib/animation-config";
import { ConfidenceBadge } from "@/components/extraction/confidence-badge";
import { CriticVerdictBadge } from "@/components/extraction/critic-verdict-badge";
import { EvidenceQuote } from "@/components/extraction/evidence-quote";
import { InsufficientEvidenceCard } from "@/components/extraction/insufficient-evidence-card";
import { StatusBadge } from "@/components/extraction/status-badge";

interface PaperResult {
  _id: Id<"extractionPapers">;
  title: string;
  openalexId: string;
  doi?: string;
  status:
    | "pending"
    | "parsing"
    | "extracting"
    | "completed"
    | "failed"
    | "cancelled";
  parsingSource?: string;
  results: Array<{
    questionId: string;
    answer: string | null;
    confidence?: "high" | "medium" | "low";
    evidenceStartChar?: number;
    evidenceEndChar?: number;
    reasoning?: string;
    modelUsed?: string;
    criticVerdict?: string;
  }>;
}

interface PaperResultCardProps {
  paper: PaperResult;
  questions: Array<{ key: string; question: string }>;
  index: number;
  className?: string;
}

export function PaperResultCard({
  paper,
  questions,
  index,
  className,
}: PaperResultCardProps) {
  const t = useTranslations("extraction");
  const shouldReduceMotion = useReducedMotion();

  // Build a lookup from questionId -> question text
  const questionMap = new Map(questions.map((q) => [q.key, q.question]));

  const cardContent = (
    <Card className={cn(className)} role="article">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          {paper.title}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={paper.status} />
          {paper.parsingSource && (
            <Badge variant="secondary" className="text-xs">
              {t("results.parsingSource", { source: paper.parsingSource })}
            </Badge>
          )}
          {paper.doi && (
            <a
              href={`https://doi.org/${paper.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              {paper.doi}
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {paper.results.map((result, resultIndex) => {
          const questionText =
            questionMap.get(result.questionId) ?? result.questionId;
          const isLast = resultIndex === paper.results.length - 1;
          const isInsufficientEvidence =
            result.answer === "insufficient_evidence";

          return (
            <div key={result.questionId}>
              {isInsufficientEvidence ? (
                <InsufficientEvidenceCard
                  questionText={questionText}
                  reasoning={result.reasoning}
                />
              ) : (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">{questionText}</h4>

                  {/* Answer row with badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm">{result.answer}</p>
                    {result.confidence && (
                      <ConfidenceBadge confidence={result.confidence} />
                    )}
                    {result.criticVerdict && (
                      <CriticVerdictBadge verdict={result.criticVerdict as "supported" | "unsupported" | "partial" | "timeout"} />
                    )}
                  </div>

                  {/* Evidence quote */}
                  {result.evidenceStartChar !== undefined &&
                    result.evidenceEndChar !== undefined &&
                    result.evidenceStartChar !== result.evidenceEndChar && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("results.evidenceHeading")}
                        </p>
                        <EvidenceQuote
                          paperId={paper._id}
                          startChar={result.evidenceStartChar}
                          endChar={result.evidenceEndChar}
                        />
                      </div>
                    )}

                  {/* Reasoning */}
                  {result.reasoning && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("results.reasoningHeading")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {result.reasoning}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!isLast && <Separator className="mt-4" />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  // Wrap with motion animation unless reduced motion is preferred
  if (shouldReduceMotion) {
    return cardContent;
  }

  return (
    <motion.div
      {...cardEntrance}
      transition={cardEntranceTransition(index * 0.05)}
    >
      {cardContent}
    </motion.div>
  );
}
