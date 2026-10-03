"use client";

// The Screen all page, in the settings shell: a form that starts a screening on the left
// rail's first entry, and each of the person's screenings under it.
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useQueryState } from "nuqs";
import { CircleCheck, CircleX, Hourglass, ListChecks, LoaderCircle, Plus, Square } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageWrapper } from "@/components/PageWrapper";
import { Button } from "@/components/ui/button";
import { ConfigurationLayout, ConfigurationNavigation } from "@/components/evidence-libraries/configuration/configuration-layout";
import { RailGroup, RailLink } from "@/components/evidence-libraries/configuration/navigation-rail";
import { BAR_ACTION, BAR_LABEL, PanelHeader } from "@/components/evidence-libraries/configuration/panel-header";
import { EASE } from "@/components/settings/model-map";
import { Enter } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { doneOf, phaseOf, type Job, type JobRow, type Phase } from "@/lib/screening/setup";
import { cn } from "@/lib/utils";
import { JobView, jobName } from "./job-view";
import { SetupView } from "./setup-view";

/** Screenings one page of the rail lists. */
const RAIL_PAGE = 12;
/** Screenings in progress read to tell the running from the waiting: far more than a person has at once. */
const ACTIVE_MAX = 50;

const ICON: Record<Exclude<Phase, "processing">, typeof Square> = {
  running: LoaderCircle, waiting: Hourglass, completed: CircleCheck, cancelled: Square, failed: CircleX, creditsExhausted: CircleX,
};

export function ScreeningPage() {
  const t = useTranslations("screeningPage");
  const format = useFormatter();
  const date = (at: number) => format.dateTime(new Date(at), { dateStyle: "medium" });
  // Screen all on a results page opens the form with that search: /screening?search=<id>. A
  // screening shows at ?job=<id>, the form at ?job=new; with neither, the newest screening shows.
  const [searchId] = useQueryState("search");
  const [picked, setPicked] = useQueryState("job");

  const jobs = useCursorPage(api.screening.queries.listUserScreeningJobs, {}, RAIL_PAGE);
  const { data: total } = useProtectedQuery(api.screening.queries.countUserScreeningJobs, {});
  // Until the person's screenings arrive, nothing says whether the form or the newest of them shows.
  const waiting = picked === null && !searchId && jobs.isLoading;
  const jobId = picked === "new" || waiting ? null : (picked ?? (searchId ? null : (jobs.items[0]?._id ?? null)));
  const { data: read } = useProtectedQuery(api.screening.queries.getScreeningJob, jobId ? { jobId: jobId as Id<"screeningJobs"> } : "skip");
  // The screening last shown stays up while the next one is read.
  const [shown, setShown] = useState<Job | null>(null);
  if (read && read !== shown) setShown(read);
  const job = !jobId || read === null ? null : (read ?? shown);
  // Shown while the one picked is read: it stays dimmed and inert until then.
  const stale = Boolean(job && jobId && job._id !== jobId);
  const showsForm = !job && !waiting && !(jobId && read === undefined);
  // The newest screening shows only until the rail turns its page: from then on it's the one picked.
  const turn = (step: () => void) => () => {
    if (picked === null && job) setPicked(job._id);
    step();
  };

  // Every screening in progress, whatever page of the rail shows: which of them is being read decides who waits for whom.
  const { data: processing } = useProtectedQuery(api.screening.queries.listUserScreeningJobs, { status: "processing", paginationOpts: { cursor: null, numItems: ACTIVE_MAX } });
  const active = processing?.page ?? [];
  const running = jobs.items.filter((row) => row.status === "processing");
  const past = jobs.items.filter((row) => row.status !== "processing");
  // A screening to run again, which the form starts from.
  const [again, setAgain] = useState<Job | null>(null);
  const openForm = (from: Job | null) => {
    setAgain(from);
    setPicked("new");
  };
  // The person's oldest job with papers being read: the one a new or waiting job starts after.
  const reading = (but?: Id<"screeningJobs">) => active.findLast((row) => row.running > 0 && row._id !== but);
  const blockerOf = (row: JobRow | undefined) => row && { name: jobName(t, row, date), done: doneOf(row), total: row.totalPapers };

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        <ConfigurationLayout
          header={
            <PanelHeader icon={ListChecks} title={t("title")}>
              <Button size="sm" className={BAR_ACTION} onClick={() => openForm(null)}>
                <Plus /><span className={BAR_LABEL}>{t("newScreening")}</span>
              </Button>
            </PanelHeader>
          }
          navigation={
            <ConfigurationNavigation label={t("screenings")}>
              <RailGroup label={t("start")}>
                <RailLink href="/screening?job=new" icon={Plus} active={showsForm} onClick={() => openForm(null)}>
                  <span className="flex-1 truncate">{t("newScreening")}</span>
                </RailLink>
              </RailGroup>
              {/* Laid out once the person's screenings arrive, so the rail's groups never pop in one by one. */}
              <Enter ready={!jobs.isLoading}>
                <div className={cn("space-y-5", jobs.isStale && "pointer-events-none opacity-60")}>
                  {/* One layout group, so a screening that finishes glides from Running to Done. */}
                  <LayoutGroup>
                    {running.length ? (
                      <RailGroup label={t("running")}>
                        {running.map((row) => (
                          <RailItem key={row._id} id={row._id}>
                            <JobLink row={row} phase={phaseOf(row, active)} name={jobName(t, row, date)} active={job?._id === row._id} onClick={() => setPicked(row._id)} />
                          </RailItem>
                        ))}
                      </RailGroup>
                    ) : null}
                    {past.length ? (
                      <RailGroup label={t("done")}>
                        {past.map((row) => (
                          <RailItem key={row._id} id={row._id}>
                            <JobLink row={row} phase={phaseOf(row, active)} name={jobName(t, row, date)} active={job?._id === row._id} onClick={() => setPicked(row._id)} />
                          </RailItem>
                        ))}
                      </RailGroup>
                    ) : null}
                  </LayoutGroup>
                  {jobs.hasPages ? (
                    <PageStepper
                      className="px-2"
                      page={jobs.page}
                      pageCount={total === undefined ? undefined : Math.max(1, Math.ceil(total / RAIL_PAGE))}
                      canPrevious={jobs.canPrevious}
                      canNext={jobs.canNext}
                      onPrevious={turn(jobs.previous)}
                      onNext={turn(jobs.next)}
                    />
                  ) : null}
                </div>
              </Enter>
            </ConfigurationNavigation>
          }
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={job?._id ?? "new"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.3, ease: EASE }} className={cn(stale && "pointer-events-none opacity-60")} aria-busy={stale}>
              {job ? (
                <JobView
                  job={job}
                  phase={phaseOf(job, active)}
                  blocker={blockerOf(reading(job._id))}
                  onRunAgain={() => openForm(job)}
                />
              ) : !showsForm ? null : (
                <SetupView
                  key={again?._id ?? searchId ?? "new"}
                  fromSearchId={again ? (again.set?.kind === "search" ? again.set.searchId : undefined) : (searchId ?? undefined)}
                  again={again ?? undefined}
                  waitingFor={blockerOf(reading())?.name}
                  onStarted={(id) => setPicked(id)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </ConfigurationLayout>
      </PageWrapper>
    </MotionConfig>
  );
}

function JobLink({ row, phase, name, active, onClick }: { row: JobRow; phase: Exclude<Phase, "processing">; name: string; active: boolean; onClick: () => void }) {
  const t = useTranslations("screeningPage");
  const done = doneOf(row);
  return (
    <RailLink href={`/screening?job=${row._id}`} icon={ICON[phase]} active={active} onClick={onClick} className="h-auto items-start whitespace-normal py-2 [&>svg]:mt-0.5">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2">{name}</span>
        <span className="flex items-center gap-2">
          {phase === "running" || phase === "waiting" ? (
            <span className="block h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={cn("block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", phase === "running" ? "bg-primary" : "bg-amber-400")} style={{ width: `${row.totalPapers ? (done / row.totalPapers) * 100 : 0}%` }} />
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
            {phase === "completed" ? t("includedCount", { count: row.qualifiedPapers }) : `${done}/${row.totalPapers}`}
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
