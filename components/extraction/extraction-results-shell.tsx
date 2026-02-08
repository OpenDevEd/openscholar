"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/lib/hooks";
import { PdfCitationPanel } from "@/components/extraction/pdf-citation-panel";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { subtleSpring } from "@/lib/animation-config";

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
  panelPayload: CitationPanelPayload | null;
  mobilePane: "results" | "citation";
  onMobilePaneChange: (pane: "results" | "citation") => void;
  primaryLabel?: string;
  children: ReactNode;
};

export function ExtractionResultsShell({
  panelPayload,
  mobilePane,
  onMobilePaneChange,
  primaryLabel = "Results",
  children,
}: ExtractionResultsShellProps) {
  const isMobile = useIsMobile();
  const hasActiveCitationPanel = panelPayload !== null;
  const prevPaneRef = useRef<"results" | "citation">(mobilePane);
  const directionRef = useRef<Direction>(1);

  useEffect(() => {
    if (prevPaneRef.current === mobilePane) return;
    directionRef.current = mobilePane === "citation" ? 1 : -1;
    prevPaneRef.current = mobilePane;
  }, [mobilePane]);

  if (isMobile) {
    if (!hasActiveCitationPanel) {
      return <div className="min-w-0 overflow-x-hidden">{children}</div>;
    }

    return (
      <div className="min-w-0 overflow-x-hidden">
        <Tabs
          value={mobilePane}
          onValueChange={(value) => onMobilePaneChange(value as "results" | "citation")}
          className="flex min-w-0 flex-col gap-0"
        >
          <TabsList className="grid h-11 w-full grid-cols-2">
            <TabsTrigger value="results" className="gap-1.5">
              <FileText className="size-3.5" />
              {primaryLabel}
            </TabsTrigger>
            <TabsTrigger value="citation">Citation</TabsTrigger>
          </TabsList>

          <div className="relative min-h-[420px] flex-1 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={directionRef.current}>
              {mobilePane === "results" ? (
                <motion.div
                  key="results"
                  custom={directionRef.current}
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
                  custom={directionRef.current}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={subtleSpring}
                  className="absolute inset-0 overflow-auto"
                >
                  <div className="h-full min-h-[420px]">
                    <PdfCitationPanel payload={panelPayload} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Tabs>
      </div>
    );
  }

  return <div className="min-w-0 overflow-x-hidden">{children}</div>;
}
