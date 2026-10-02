"use client";

// A mock of a full Screen all page in the settings shell: scripted data, no backend
// beyond the model catalog. See ./data.ts.
import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { EASE } from "@/components/settings/model-map";
import { CircleCheck, Hourglass, ListChecks, LoaderCircle, Plus, Square } from "lucide-react";
import { PageWrapper } from "@/components/PageWrapper";
import { Button } from "@/components/ui/button";
import { ConfigurationLayout, ConfigurationNavigation } from "@/components/evidence-libraries/configuration/configuration-layout";
import { RailGroup, RailLink } from "@/components/evidence-libraries/configuration/navigation-rail";
import { BAR_ACTION, BAR_LABEL, PanelHeader } from "@/components/evidence-libraries/configuration/panel-header";
import { cn } from "@/lib/utils";
import { CREDITS_PER_PAPER, START_JOBS, paperIds, type Answer, type Job } from "./data";
import { JobView, countsOf } from "./job-view";
import { SetupView, type Setup } from "./setup-view";

/** How often the scripted screenings move on, and by how many papers. */
const TICK_MS = 700;

export function ScreeningMock() {
  const [jobs, setJobs] = useState<Job[]>(START_JOBS);
  const [selected, setSelected] = useState<string>("j1");
  const [starting, setStarting] = useState(false);

  // The scripted backend: running screenings move on; when one ends, the person's oldest
  // waiting screening starts. A timer, the one outside system this mock has.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setJobs((all) => {
        let freed = false;
        const next = all.map((job) => {
          if (job.status !== "running") return job;
          const done = Math.min(job.paperIds.length, job.done + 1 + Math.floor(Math.random() * 3));
          if (done === job.paperIds.length) freed = true;
          return { ...job, done, status: done === job.paperIds.length ? ("completed" as const) : job.status };
        });
        if (!freed) return next;
        const waiting = next.filter((j) => j.status === "waiting").at(-1);
        return waiting ? next.map((j) => (j.id === waiting.id ? { ...j, status: "running" as const } : j)) : next;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const update = (id: string, change: (job: Job) => Job) => setJobs((all) => all.map((j) => (j.id === id ? change(j) : j)));
  const job = jobs.find((j) => j.id === selected);
  const blocker = jobs.find((j) => j.status === "running");

  const start = (setup: Setup) => {
    setStarting(true);
    // The server reads the papers before the job shows (#341): about 2 s for 1,000.
    window.setTimeout(() => {
      const id = `j${Date.now()}`;
      const count = setup.last - setup.first + 1;
      setJobs((all) => [
        {
          id,
          name: setup.source.label.charAt(0).toUpperCase() + setup.source.label.slice(1),
          source: setup.source,
          questions: setup.questions,
          minScore: setup.minScore,
          paperIds: paperIds(Math.min(count, 1_000)),
          done: 0,
          status: all.some((j) => j.status === "running") ? "waiting" : "running",
          model: setup.model,
          startedAt: "Just now",
          hold: Math.ceil(Math.min(count, 1_000) * CREDITS_PER_PAPER),
          overrides: {},
          saveTo: setup.saveTo,
          prune: setup.prune,
        },
        ...all,
      ]);
      setSelected(id);
      setStarting(false);
    }, 1_800);
  };

  const answer = (paperId: string, questionKey: string, value: Answer | null) =>
    update(selected, (j) => {
      const forPaper = { ...j.overrides[paperId] };
      if (value === null) delete forPaper[questionKey];
      else forPaper[questionKey] = value;
      return { ...j, overrides: { ...j.overrides, [paperId]: forPaper } };
    });

  const active = jobs.filter((j) => j.status === "running" || j.status === "waiting");
  const past = jobs.filter((j) => j.status === "completed" || j.status === "cancelled");

  return (
    <MotionConfig reducedMotion="user">
    <PageWrapper>
      <ConfigurationLayout
        header={
          <PanelHeader icon={ListChecks} title="Screening">
            <Button size="sm" className={BAR_ACTION} onClick={() => setSelected("new")}>
              <Plus /><span className={BAR_LABEL}>New screening</span>
            </Button>
          </PanelHeader>
        }
        navigation={
          <ConfigurationNavigation label="Screenings">
            <RailGroup label="Start">
              <RailLink href="#new" icon={Plus} active={selected === "new"} onClick={() => setSelected("new")}>
                <span className="flex-1 truncate">New screening</span>
              </RailLink>
            </RailGroup>
            {/* One layout group, so a screening that finishes glides from Running to Done. */}
            <LayoutGroup>
              {active.length ? (
                <RailGroup label="Running">
                  {active.map((j) => (
                    <RailItem key={j.id} id={j.id}>
                      <JobLink job={j} active={selected === j.id} onClick={() => setSelected(j.id)} />
                    </RailItem>
                  ))}
                </RailGroup>
              ) : null}
              <RailGroup label="Done">
                {past.map((j) => (
                  <RailItem key={j.id} id={j.id}>
                    <JobLink job={j} active={selected === j.id} onClick={() => setSelected(j.id)} />
                  </RailItem>
                ))}
              </RailGroup>
            </LayoutGroup>
          </ConfigurationNavigation>
        }
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={selected === "new" || !job ? "new" : job.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.3, ease: EASE }}
          >
        {selected === "new" || !job ? (
          <SetupView busy={starting} screenings={jobs} waitingFor={blocker?.name} onStart={start} />
        ) : (
          <JobView
            job={job}
            blocker={job.status === "waiting" ? blocker : undefined}
            onCancel={() => update(job.id, (j) => ({ ...j, status: "cancelled" }))}
            onRunAgain={() => setSelected("new")}
            onAnswer={answer}
          />
        )}
          </motion.div>
        </AnimatePresence>
      </ConfigurationLayout>
    </PageWrapper>
    </MotionConfig>
  );
}

const ICON = { running: LoaderCircle, waiting: Hourglass, completed: CircleCheck, cancelled: Square } as const;

function JobLink({ job, active, onClick }: { job: Job; active: boolean; onClick: () => void }) {
  const counts = countsOf(job);
  const total = job.paperIds.length;
  return (
    <RailLink href={`#${job.id}`} icon={ICON[job.status]} active={active} onClick={onClick} className="h-auto items-start whitespace-normal py-2 [&>svg]:mt-0.5">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2">{job.name}</span>
        <span className="flex items-center gap-2">
          {job.status === "running" || job.status === "waiting" ? (
            <span className="block h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={cn("block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", job.status === "running" ? "bg-primary" : "bg-amber-400")} style={{ width: `${(job.done / total) * 100}%` }} />
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
            {job.status === "completed" ? `${counts.included} included` : `${job.done}/${total}`}
          </span>
        </span>
      </span>
    </RailLink>
  );
}

/** A rail row that slides into place when its screening moves group, and fades in when new. */
function RailItem({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <motion.div layout="position" layoutId={`rail-${id}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      {children}
    </motion.div>
  );
}
