"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CITATION_STATUS_COLORS } from "../../lib/extraction/bar-scaling";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CitationStatusMix {
  grounded: number;
  best_effort: number;
  insufficient_evidence: number;
  extraction_error: number;
}

export interface AnswerItem {
  answer: string;
  count: number;
  citationStatusMix: CitationStatusMix;
}

export interface StackedAnswerBarsProps {
  /** One item per distinct answer value. */
  answers: AnswerItem[];
  /** The maximum count across ALL answers in the question — used for a consistent X axis domain. */
  maxCount: number;
}

// ─── Tooltip renderer (exported for direct unit testing) ──────────────────────

export interface TooltipPayloadItem {
  name: string;
  value: number;
  payload: CitationStatusMix;
}

export interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

/**
 * Pure function that generates tooltip JSX for Recharts Tooltip content.
 * Exported so tests can call it directly without simulating DOM events.
 *
 * Returns null when inactive or payload is empty (prevents flickering empty tooltip).
 * Always shows integer counts and integer percentages — never raw decimal fractions.
 */
export function renderTooltipContent({
  active,
  payload,
}: TooltipProps): React.ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;

  const item = payload[0];
  const statusKey = item.name as keyof CitationStatusMix;
  const count = item.value;
  const mix = item.payload;

  // Total of all segments to compute percentage
  const total =
    (mix.grounded ?? 0) +
    (mix.best_effort ?? 0) +
    (mix.insufficient_evidence ?? 0) +
    (mix.extraction_error ?? 0);
  const safeTotal = total > 0 ? total : 1;
  const percentage = Math.round((count / safeTotal) * 100);

  // Human-readable label for the status key
  const labelMap: Record<keyof CitationStatusMix, string> = {
    grounded: "Grounded",
    best_effort: "Best effort",
    insufficient_evidence: "Insufficient evidence",
    extraction_error: "Extraction error",
  };
  const label = labelMap[statusKey] ?? statusKey;

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 4,
        padding: "6px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div>
        {count} ({percentage}%)
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders one horizontal stacked bar per answer item.
 *
 * Each bar shows citation status segments (grounded / best_effort /
 * insufficient_evidence / extraction_error) colored according to
 * CITATION_STATUS_COLORS. A Recharts BarChart with layout="vertical" is used
 * so bars grow left-to-right while answers are stacked top-to-bottom.
 *
 * Edge-case guards:
 * - If all answers have count=0 a muted "No answers" message is shown instead.
 * - safMax = Math.max(maxCount, 1) prevents XAxis domain=[0,0].
 */
export function StackedAnswerBars({
  answers,
  maxCount,
}: StackedAnswerBarsProps): React.ReactElement {
  const allEmpty = answers.every((a) => a.count === 0);

  if (allEmpty) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No answers
      </div>
    );
  }

  const safMax = Math.max(maxCount, 1);

  return (
    <div className="flex flex-col gap-2">
      {answers.map((answer, idx) => {
        // Build chart data — one data point with all four status keys so Recharts
        // stacks them into a single bar row.
        const chartData = [answer.citationStatusMix];

        return (
          <div
            key={idx}
            data-testid="answer-bar-row"
            className="flex items-center gap-3"
          >
            {/* Answer label */}
            <span
              className="text-sm text-foreground truncate min-w-0 w-32 shrink-0"
              title={answer.answer}
            >
              {answer.answer}
            </span>

            {/* Count */}
            <span className="text-sm font-mono text-muted-foreground shrink-0 w-8 text-right">
              {answer.count}
            </span>

            {/* Stacked bar chart */}
            <div className="flex-1" style={{ height: 28 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                >
                  <XAxis
                    type="number"
                    domain={[0, safMax]}
                    hide
                  />
                  <YAxis type="category" hide />
                  <Tooltip
                    content={(props: TooltipProps) =>
                      renderTooltipContent(props)
                    }
                  />
                  <Bar
                    dataKey="grounded"
                    stackId="status"
                    fill={CITATION_STATUS_COLORS.grounded}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="best_effort"
                    stackId="status"
                    fill={CITATION_STATUS_COLORS.best_effort}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="insufficient_evidence"
                    stackId="status"
                    fill={CITATION_STATUS_COLORS.insufficient_evidence}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="extraction_error"
                    stackId="status"
                    fill={CITATION_STATUS_COLORS.extraction_error}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
