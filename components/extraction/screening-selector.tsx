"use client";

import { ListChecks } from "@/components/icons";
import { SelectableList } from "./bucket/selectable-list";
import { api } from "@/convex/_generated/api";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useBucketStore } from "@/lib/store/bucket";
import { bucketAdded } from "@/lib/toast/bucket";
import { PageStepper } from "@/components/shared/page-stepper";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { useFormatter } from "next-intl";

export function ScreeningSelector({ paperLimit }: { paperLimit: number }) {
  const format = useFormatter();
  const list = useCursorPage(api.screening.queries.listJobs, {}, 20);
  const items = useBucketStore(s => s.items);
  const addMany = useBucketStore(s => s.addMany);
  const removeMany = useBucketStore(s => s.removeMany);
  const key = (job: { _id: string }) => `screening:${job._id}`;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Use the current Included papers. Later screening edits leave this extraction unchanged.</p>
    <div className="h-96 overflow-y-auto" aria-busy={list.isLoading || list.isStale} inert={list.isStale}>
    {list.isLoading ? <ListLoading label="Loading screening jobs" /> : <SelectableList
      items={list.items}
      keyOf={key}
      isSelected={job => Boolean(items[key(job)])}
      isDisabled={job => !items[key(job)] && (job.status === "processing" || job.qualifiedPapers === 0 || job.qualifiedPapers > paperLimit)}
      headerLabel="Screening jobs"
      emptyState={<p className="p-6 text-sm text-muted-foreground">Screen some papers first. Your screening jobs will appear here.</p>}
      onToggle={(job, next) => {
        const bucketKey = key(job);
        if (!next) { removeMany([bucketKey]); return; }
        if (job.status === "processing" || !job.qualifiedPapers || job.qualifiedPapers > paperLimit) return;
        bucketAdded(addMany([{ bucketKey, source: "screening", sourceRefId: job._id, title: job.label ?? job.questions[0]?.question ?? "Screening", authors: [], screeningSelection: { jobId: job._id, revision: job.revision, count: job.qualifiedPapers }, paperCount: job.qualifiedPapers, status: "ready", addedAt: Date.now() }], paperLimit));
      }}
      renderRow={job => <div className="min-w-0">
        <div className="flex items-center gap-2"><ListChecks className="size-4 shrink-0 text-muted-foreground" /><span className="font-medium text-foreground break-words">{job.label ?? job.questions[0]?.question ?? "Screening"}</span></div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground"><span>{format.number(job.qualifiedPapers)} Included</span><span>{format.number(Math.max(0, job.processedPapers - job.skippedPapers))} screened</span><span className="capitalize">{job.status}</span><span>{format.dateTime(job.createdAt, { year: "numeric", month: "short", day: "numeric" })}</span></div>
        {job.qualifiedPapers === 0 && <p className="mt-1 text-sm text-muted-foreground">No Included papers</p>}
        {job.status === "processing" && <p className="mt-1 text-sm text-muted-foreground">Wait for screening to finish.</p>}
        {job.qualifiedPapers > paperLimit && <p className="mt-1 text-sm text-muted-foreground">Exceeds the {paperLimit.toLocaleString()}-paper extraction limit</p>}
        {items[key(job)]?.screeningSelection && items[key(job)].screeningSelection!.revision !== job.revision && <p role="status" className="mt-1 text-sm text-amber-700 dark:text-amber-300">Decisions changed. Remove this source and select it again.</p>}
      </div>}
    />}
    </div>
    <div className="h-7">{list.hasPages && <PageStepper page={list.page} canPrevious={list.canPrevious} canNext={list.canNext} onPrevious={list.previous} onNext={list.next} />}</div>
  </div>;
}
