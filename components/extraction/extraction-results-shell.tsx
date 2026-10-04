"use client";

import type { ReactNode } from "react";
import { FileText, PanelLeftOpen } from "@/components/icons";
import { motion, AnimatePresence } from "motion/react";
import { ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { useIsMobile } from "@/lib/hooks";
import { AnswerPanel, openAnswerKey, type OpenAnswer } from "@/components/extraction/answer-panel";
import { subtleSpring } from "@/lib/animation-config";
import { useTranslations } from "next-intl";

type Direction = 1 | -1;

const slideVariants = {
  enter: (direction: Direction) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: Direction) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
  }),
};

type ExtractionResultsShellProps = {
  answer: OpenAnswer | null;
  mobilePane: "results" | "citation";
  onMobilePaneChange: (pane: "results" | "citation") => void;
  primaryLabel?: string;
  children: ReactNode;
};

export function ExtractionResultsShell({
  answer,
  mobilePane,
  onMobilePaneChange,
  primaryLabel,
  children,
}: ExtractionResultsShellProps) {
  const t = useTranslations("extractionView");
  const tc = useTranslations("common");
  const isMobile = useIsMobile();
  const label = primaryLabel ?? t("results");
  const hasActiveCitationPanel = answer !== null;
  // results → citation = going right (1), citation → results = going left (-1)
  const direction: Direction = mobilePane === "citation" ? 1 : -1;

  if (isMobile) {
    if (!hasActiveCitationPanel) {
      return <div className="min-w-0 overflow-x-hidden">{children}</div>;
    }

    return (
      <div className="min-w-0 overflow-x-hidden">
        <div className="flex min-w-0 flex-col gap-0">
          {/* The shared tabs: the results, or the answer opened from them. */}
          <div className="border-b border-border-subtle px-4 py-3">
            <ListViewTabs
              label={label}
              value={mobilePane}
              onChange={onMobilePaneChange}
              tabs={[
                { value: "results", label, icon: <FileText className="size-3.5" /> },
                { value: "citation", label: tc("details"), icon: <PanelLeftOpen className="size-3.5" /> },
              ]}
            />
          </div>

          <div className="relative min-h-[420px] flex-1 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              {mobilePane === "results" ? (
                <motion.div
                  key="results"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={subtleSpring}
                  className="absolute inset-0 overflow-auto"
                >
                  {children}
                </motion.div>
              ) : (
                <motion.div
                  key="citation"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={subtleSpring}
                  className="absolute inset-0 overflow-auto"
                >
                  <div className="h-full min-h-[420px]">
                    <AnswerPanel key={openAnswerKey(answer) ?? ""} answer={answer} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  }

  return <div className="min-w-0 overflow-x-hidden">{children}</div>;
}
