"use client";

// An open screening, across the whole window: Overview, Screen and Papers over the same votes,
// at either stage. Placeholder data throughout (./data.ts).

import { useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useParams } from "next/navigation";
import { useQueryState } from "nuqs";
import { BarChart3, Check, Download, Eye, ListChecks, Settings2, Table2, Users } from "@/components/icons";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Chip } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Link from "@/components/workspace-link";
import { REVIEWERS, SCREENINGS, STAGES, type Stage } from "./data";
import { Overview } from "./overview";
import { Papers, type PapersFilter } from "./papers";
import { ReviewerStack, useScreening } from "./parts";
import { Screen, type Queue } from "./screen";

const VIEWS = ["overview", "screen", "papers"] as const;
type View = (typeof VIEWS)[number];
const EXPORTS = [
  { name: "Every vote", detail: "CSV or Excel, one row per reviewer per paper" },
  { name: "Flow diagram", detail: "PRISMA 2020, as SVG or PDF" },
  { name: "Methods paragraph", detail: "Reviewers, models, rule and agreement" },
];

export function ScreeningWorkspace() {
  const { id } = useParams<{ id: string }>();
  const row = SCREENINGS.find((one) => one.id === id) ?? SCREENINGS[0]!;
  const [viewParam, setView] = useQueryState("view");
  const [stageParam, setStage] = useQueryState("stage");
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "overview";
  const stage: Stage = stageParam === "fullText" ? "fullText" : "abstract";
  const screening = useScreening(stage);
  const [queue, setQueue] = useState<Queue>("todo");
  const [filter, setFilter] = useState<PapersFilter>("all");
  const [exporting, setExporting] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        {/* Faces fade in as they load, where they would otherwise appear in one frame. */}
        <div className={`contents ${AVATARS_FADE_IN}`}>
        <LibraryPageShell
          wide
          icon={ListChecks}
          title={row.name}
          backHref="/screening/mock"
          backLabel="All screenings"
          tabs={
            <Segmented
              label="View"
              value={view}
              onChange={(next) => void setView(next === "overview" ? null : next)}
              options={[
                { id: "overview", label: "Overview", icon: BarChart3 },
                { id: "screen", label: "Screen", icon: ListChecks, detail: screening.toDo.length ? <span className="tabular-nums text-muted-foreground">{screening.toDo.length}</span> : undefined },
                { id: "papers", label: "Papers", icon: Table2 },
              ]}
            />
          }
          actions={
            <>
              <Popover open={exporting} onOpenChange={setExporting}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={BAR_ACTION}><Download /><span className={BAR_LABEL}>Export</span></Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-1.5">
                  {EXPORTS.map((one) => (
                    <button key={one.name} type="button" onClick={() => setExporting(false)} className="flex w-full flex-col rounded-lg px-3 py-2 text-start transition-colors hover:bg-muted">
                      <span className="text-sm font-medium">{one.name}</span>
                      <span className="text-xs text-muted-foreground">{one.detail}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              <Button asChild variant="outline" size="sm" className={BAR_ACTION}>
                <Link href="/screening/mock/new"><Settings2 /><span className={BAR_LABEL}>Setup</span></Link>
              </Button>
            </>
          }
          intro={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
              <Segmented
                label="Stage"
                value={stage}
                onChange={(next) => void setStage(next === "abstract" ? null : next)}
                options={(Object.keys(STAGES) as Stage[]).map((one) => ({ id: one, label: STAGES[one].label, detail: <span className="tabular-nums text-muted-foreground">{STAGES[one].papers.length}</span> }))}
              />
              {/* How a paper is decided here, in three facts. */}
              <div className="flex min-w-0 items-center gap-1.5 max-xl:hidden">
                <Chip icon={Users}>Every model and 2 people read each paper</Chip>
                <Chip icon={Check}>Settled when they all agree</Chip>
                <Chip icon={Eye}>Votes show after yours</Chip>
              </div>
              <div className="ms-auto"><ReviewerStack reviewers={REVIEWERS.filter((reviewer) => row.reviewers.includes(reviewer.id))} /></div>
            </div>
          }
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${view}:${stage}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.3, ease: EASE }}>
              {view === "overview" ? (
                <Overview
                  screening={screening}
                  onOpen={(next, what) => {
                    if (next === "screen") setQueue(what === "conflicts" ? "conflicts" : "todo");
                    else setFilter(what && what !== "conflicts" && what !== "todo" ? what : "all");
                    void setView(next);
                  }}
                />
              ) : view === "screen" ? (
                <Screen screening={screening} queue={queue} onQueue={setQueue} />
              ) : (
                <Papers screening={screening} filter={filter} onFilter={setFilter} />
              )}
            </motion.div>
          </AnimatePresence>
        </LibraryPageShell>
        </div>
      </PageWrapper>
    </MotionConfig>
  );
}
