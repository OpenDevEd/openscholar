"use client";

import { validateBarData } from "@/lib/extraction/bar-validation";
import { StackedAnswerBars } from "./stacked-answer-bars";
import type { StackedAnswerBarsProps } from "./stacked-answer-bars";

export type BarChartContentProps = StackedAnswerBarsProps;

/**
 * The Recharts implementation — loaded on demand via next/dynamic.
 *
 * This is the DEFAULT export because next/dynamic requires a default export.
 * Do NOT import this file directly from application code — import
 * BarVisualization from bar-visualization.tsx instead, which lazily loads this.
 */
export default function BarChartContent({ answers, maxCount }: BarChartContentProps) {
  const validation = validateBarData(
    answers.map((a) => ({ answer: a.answer, count: a.count }))
  );

  if (validation.isEmpty) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No answer data available
      </div>
    );
  }

  return <StackedAnswerBars answers={answers} maxCount={maxCount} />;
}
