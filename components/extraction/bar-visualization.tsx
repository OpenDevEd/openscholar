"use client";

import dynamic from "next/dynamic";
import type { StackedAnswerBarsProps } from "./stacked-answer-bars";

export type BarVisualizationProps = StackedAnswerBarsProps;

/**
 * Lazy-loading wrapper for the Recharts bar visualization.
 *
 * Uses next/dynamic with ssr=false so the Recharts bundle (~65KB gzipped)
 * is only fetched when this component is first rendered — not on page load.
 *
 * IMPORTANT: Do NOT import "recharts" directly in this file. The bundle split
 * only works because Recharts is imported in bar-chart-content.tsx (the dynamic
 * target). Importing it here would defeat the lazy loading.
 */
const BarChartContent = dynamic(() => import("./bar-chart-content"), {
  loading: () => (
    <div className="space-y-3 animate-pulse">
      <div className="h-6 bg-muted rounded" />
      <div className="h-6 bg-muted rounded w-4/5" />
      <div className="h-6 bg-muted rounded w-3/5" />
    </div>
  ),
  ssr: false, // Recharts uses browser DOM APIs; required
});

/**
 * Named export — the public API for lazy-loaded bar charts.
 *
 * Usage:
 *   import { BarVisualization } from "./bar-visualization";
 *   <BarVisualization answers={mappedAnswers} maxCount={maxCount} />
 */
export function BarVisualization(props: BarVisualizationProps) {
  return <BarChartContent {...props} />;
}
