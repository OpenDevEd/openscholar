"use client";

// New extraction (#690), laid out as a new screening is (components/screening/setup-view.tsx) and
// drawn from the same sources, any number of them: searches, collections, saved papers,
// screenings, and PDFs of your own. Each source is a paper set and the range of it to read, as
// screening reads them. Every source picked lands in the tray at the top of Papers: one bar, a
// part per source, filling towards the papers the plan reads in one extraction, over a chip for
// each source to take it out again.

import { useState, useTransition, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { AiIcon, AlignLeft, FileText, GripVertical, Hash, List as ListIcon, Plus, ToggleLeft, Trash2, X, type AppIcon } from "@/components/icons";
import { RECORD_KINDS } from "@/components/record-kinds";
import { jobName } from "@/components/screening/job-view";
import { AnimatedNumber, Chip, SOURCE_ICON } from "@/components/screening/parts";
import { PaperScope, SourceRow, type Scope } from "@/components/screening/source-row";
import { EASE } from "@/components/settings/model-map";
import { ModelsInUse } from "@/components/models/models-in-use";
import { Enter, LIST, Segmented, Zone } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/filter-display";
import { Input } from "@/components/ui/input";
import { QueryText } from "@/components/ui/query-text";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { CreditCheck } from "@/components/workspaces/credit-check";
import { api } from "@/convex/_generated/api";
import { useGenerateExtractionQuestions } from "@/lib/ai/client/router";
import { isDecisionModel } from "@/lib/ai/decisions";
import { useModelPicks } from "@/lib/ai/use-model-picks";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { useSearchList } from "@/lib/research/search-list";
import { useExtractionStore, usePickedPapers, type PickedSource } from "@/lib/store/extraction";
import type { ExtractionQuestion } from "@/lib/types";
import type { ExtractionQuestionType } from "@/lib/types/extraction.types";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace, useWorkspaceMutation, useWorkspaceScope } from "@/lib/workspaces/url";
import { PdfUpload } from "./pdf-upload";

type Kind = PickedSource["set"]["kind"] | "pdf";
const KIND: Record<Kind, { icon: AppIcon; tint: string }> = {
  search: { icon: SOURCE_ICON.search, tint: RECORD_KINDS.search.tint },
  collection: { icon: SOURCE_ICON.collection, tint: RECORD_KINDS.collection.tint },
  saved: { icon: SOURCE_ICON.saved, tint: RECORD_KINDS.savedPapers.tint },
  screening: { icon: SOURCE_ICON.screening, tint: RECORD_KINDS.screening.tint },
  pdf: { icon: FileText, tint: "var(--muted-foreground)" },
};
/** Sources one page of a kind's list holds. */
const SOURCE_PAGE = 5;
/** A row's height with the line under it. */
const SOURCE_ROW = 57;
/** Where a picked search starts: its first 300 results, as screening's picks start. */
const SEARCH_OPENING = 300;

const TYPES: Array<{ id: ExtractionQuestionType; icon: AppIcon }> = [
  { id: "string", icon: AlignLeft },
  { id: "boolean", icon: ToggleLeft },
  { id: "number", icon: Hash },
  { id: "array", icon: ListIcon },
];

/** One source in the tray: what it is, its name, and its papers. Your PDFs are one source. */
type Group = { key: string; kind: Kind; label: ReactNode; text: string; papers: number };

/** The papers a source takes: its range. */
const papersOf = (source: PickedSource) => source.last - source.first + 1;

export function SetupView({ paperLimit }: { paperLimit: number }) {
  const t = useTranslations("extraction");
  const ts = useTranslations("screeningPage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const locale = useLocale();
  const toast = useAppToast();
  const router = useWorkspaceRouter();
  const workspaceId = useWorkspace();

  const { draftJob, setDraftJobName, setUsePdfs, addQuestion, removeQuestion, updateQuestion, reorderQuestions, setSource, removeSources, removeUpload, clearPapers, clearDraftJob } = useExtractionStore();
  const { sources, uploads } = usePickedPapers(workspaceId);
  const total = sources.reduce((sum, source) => sum + papersOf(source), 0) + uploads.length;
  const room = Math.max(0, paperLimit - total);
  const groups: Group[] = [
    ...sources.map((source) => ({ key: source.key, kind: source.set.kind, label: source.set.kind === "search" ? <QueryText query={source.label} /> : source.label, text: source.label, papers: papersOf(source) })),
    ...(uploads.length ? [{ key: "pdf", kind: "pdf" as const, label: t("yourPdfs"), text: t("yourPdfs"), papers: uploads.length }] : []),
  ];

  // Every kind's list is read up front, so switching between them moves nothing.
  const searches = useSearchList({ sort: "recent", pageSize: SOURCE_PAGE });
  const collections = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, {}), SOURCE_PAGE);
  const { data: collectionCount } = useProtectedQuery(api.library.collections.countCollections, inWorkspace(workspaceId, {}));
  const { data: savedCount } = useProtectedQuery(api.library.queries.getLibraryCount, inWorkspace(workspaceId, {}));
  const screenings = useCursorPage(api.screening.queries.listUserScreeningJobs, inWorkspace(workspaceId, { status: "completed" as const }), SOURCE_PAGE);
  const date = (at: number) => format.dateTime(new Date(at), { dateStyle: "medium" });

  const pdfCapability = useFeatureFlag("extraction.pdf");
  const kinds: Kind[] = ["search", "collection", "saved", "screening", ...(pdfCapability && draftJob.usePdfs ? (["pdf"] as const) : [])];
  const [kind, setKind] = useState<Kind>("search");
  const shown = kinds.includes(kind) ? kind : "search";

  // ── Picking ────────────────────────────────────────────────────────────────
  const picked = (key: string) => sources.find((source) => source.key === key);
  const toggle = (key: string, make: () => PickedSource) => {
    if (!workspaceId) return;
    // Past the plan's papers it still goes in: the tray says by how many, where a pick that vanished wouldn't.
    if (picked(key)) removeSources(workspaceId, [key]);
    else setSource(workspaceId, make());
  };
  /** Where a picked source starts: all of it when the plan has room, as screening starts, else as much as there is room for. A search starts on its first 300. */
  const opening = (all: number, search: boolean): { first: number; last: number; scope: "range" | "all" } => {
    const last = Math.max(1, Math.min(all, search ? SEARCH_OPENING : all, room));
    return { first: 1, last, scope: last === all ? "all" : "range" };
  };
  /** Reads papers `first` to `last` of a ranged source, changed in place; none takes it out. */
  const setRange = (key: string, first: number, last: number, scope: "range" | "all") => {
    if (!workspaceId) return;
    const source = useExtractionStore.getState().draftJob.papers[workspaceId]?.sources.find((s) => s.key === key);
    if (!source) return;
    if (last < first) return removeSources(workspaceId, [key]);
    setSource(workspaceId, { ...source, first, last, scope });
  };
  /** A source's papers as screening asks for them: a range, or all, which `summary` says; set where its row is picked. */
  const scopeOf = (source: PickedSource, summary?: ReactNode) => (
    <PaperScope
      search={source.set.kind === "search"}
      page={false}
      scope={source.scope}
      onScope={(next: Scope) => (next === "all" ? setRange(source.key, 1, source.total, "all") : setRange(source.key, source.first, source.last, "range"))}
      range={[source.first, source.last]}
      onRange={(update) => {
        // Worked out from the range as it stands now, as the fields expect.
        const now = workspaceId ? useExtractionStore.getState().draftJob.papers[workspaceId]?.sources.find((s) => s.key === source.key) : undefined;
        if (!now) return;
        const [first, last] = typeof update === "function" ? update([now.first, now.last]) : update;
        setRange(source.key, first, last, "range");
      }}
      total={source.total}
      most={source.last + room}
      label={ts("papers")}
      summary={
        summary ?? (
          <Chip className="text-foreground">
            <span>{ts.rich("papersBold", { count: papersOf(source), n: (chunks) => <span className="font-semibold">{chunks}</span> })}</span>
          </Chip>
        )
      }
    />
  );
  const ranged = (key: string, set: PickedSource["set"], label: string, all: number, search: boolean): PickedSource => ({ key, set, label, total: all, ...opening(all, search) });

  // ── Questions ──────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState<ExtractionQuestionType>("string");
  const [generating, setGenerating] = useState(false);
  const { execute: generateQuestions, isConfigured: canGenerate } = useGenerateExtractionQuestions();
  const add = () => {
    const text = draft.trim();
    if (!text || draftJob.questions.some((q) => q.question.toLowerCase() === text.toLowerCase())) return;
    addQuestion({ question: text, type: draftType });
    setDraft("");
  };
  /** What the papers are, for the model writing questions: the searches' queries, and the other sources by name. */
  const context = () => {
    const queries = sources.filter((source) => source.set.kind === "search").map((source) => `- "${source.label}"`);
    const others = groups.filter((group) => group.kind !== "search").map((group) => `- ${group.text}`);
    return [queries.length ? `${t("sourceContextSearchQueries")}\n${queries.join("\n")}` : "", others.join("\n")].filter(Boolean).join("\n\n");
  };
  const generate = async () => {
    setGenerating(true);
    try {
      const result = await generateQuestions({ jobName: draftJob.name, sourceContext: context(), existingQuestions: draftJob.questions.map((q) => q.question), responseLanguage: localeToLanguageCode(locale) });
      const asked = new Set(draftJob.questions.map((q) => q.question.toLowerCase().trim()));
      for (const q of result.questions) if (!asked.has(q.question.toLowerCase().trim())) addQuestion({ question: q.question, type: q.type, description: q.description });
    } catch (error) {
      toast.ai.failed(tc("generateWithAI"), error);
    } finally {
      setGenerating(false);
    }
  };
  /** Moves the questions into `next`'s order, one step of the store's at a time. */
  const reorder = (next: ExtractionQuestion[]) => {
    const now = draftJob.questions;
    const at = now.findIndex((q, i) => q.key !== next[i]?.key);
    if (at === -1) return;
    reorderQuestions(at, next.findIndex((q) => q.key === now[at]!.key));
  };

  // ── Cost and start ─────────────────────────────────────────────────────────
  const models = useModelPicks();
  const textModel = models.modelOf("extraction");
  const screenModel = models.modelOf("screenAll");
  const yesNoModel = screenModel && isDecisionModel(screenModel.id) ? screenModel : textModel;
  const { data: estimate } = useProtectedQuery(api.extraction.queries.costs.estimateJob, total > 0 && draftJob.questions.length > 0 ? inWorkspace(workspaceId, { papers: total, questions: draftJob.questions.map((q) => q.type), usePdfs: draftJob.usePdfs }) : "skip");
  const { data: account } = useProtectedQuery(api.billing.accounts.mine, useWorkspaceScope());
  const balance = account?.balance ?? 0;
  const credits = estimate ?? 0;
  // Nothing picked or asked costs nothing, which the balance covers.
  const enough = credits <= balance;
  const over = total > paperLimit;
  const startJob = useWorkspaceMutation(api.extraction.mutations.startJob);
  const [starting, startTransition] = useTransition();
  const why = !total ? t("whyPickPapers") : !draftJob.questions.length ? t("whyAddQuestion") : over ? t("whyPlanPapers", { count: paperLimit }) : estimate === undefined ? null : !enough ? t("whyCredits") : null;
  const start = () =>
    startTransition(async () => {
      const name = draftJob.name.trim() || t("untitledJob");
      const questions = draftJob.questions.map((q, i) => ({ key: q.key || `q_${i}`, question: q.question, type: q.type, description: q.description }));
      try {
        const { jobId } = await startJob({ name, sources: sources.map(({ set, first, last }) => ({ set, first, last })), uploads: uploads.map(({ storageId, title }) => ({ storageId, title })), questions, usePdfs: draftJob.usePdfs });
        router.push(`/extraction/${jobId}`);
        if (workspaceId) clearDraftJob(workspaceId);
      } catch (error) {
        toast.job.createFailed(error);
      }
    });

  // Laid out once everything it sizes itself from has arrived, so nothing grows after it shows.
  const loaded = !searches.isLoading && !collections.isLoading && !screenings.isLoading && savedCount !== undefined && collectionCount !== undefined && account !== undefined;
  const pickedOf = (k: Kind) => groups.filter((g) => g.kind === k).length;

  const pager = (list: { page: number; canPrevious: boolean; canNext: boolean; previous: () => void; next: () => void; hasPages: boolean }, pageCount?: number) =>
    list.hasPages ? <PageStepper className="pt-3" page={list.page} pageCount={pageCount} canPrevious={list.canPrevious} canNext={list.canNext} onPrevious={list.previous} onNext={list.next} /> : null;

  return (
    <Enter ready={loaded}>
      <div className="space-y-8">
        {/* The job's name heads the page, written where it shows. */}
        <div className="space-y-1">
          <input value={draftJob.name} onChange={(e) => setDraftJobName(e.target.value)} placeholder={t("untitledJob")} aria-label={t("jobName")} maxLength={200} className="w-full rounded-lg bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40" />
          <p className="text-sm text-muted-foreground">{t("setupLead")}</p>
        </div>

        <Zone
          label={ts("papers")}
          aside={
            groups.length ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => workspaceId && clearPapers(workspaceId)}>
                <X /> {tc("clearAll")}
              </Button>
            ) : null
          }
        >
          <Tray groups={groups} total={total} limit={paperLimit} onRemove={(group) => workspaceId && (group.kind === "pdf" ? uploads.forEach((file) => removeUpload(workspaceId, file.storageId)) : removeSources(workspaceId, [group.key]))} />
          <Segmented
            className="mt-3"
            label={t("selectPapers")}
            value={shown}
            onChange={setKind}
            fill="labels"
            options={kinds.map((id) => ({
              id,
              label: id === "pdf" ? t("pdfsKind") : ts(`kind.${id}`),
              icon: KIND[id].icon,
              detail: pickedOf(id) ? <span className="rounded-full bg-primary/15 px-1.5 text-2xs font-semibold tabular-nums text-primary">{pickedOf(id)}</span> : undefined,
            }))}
          />

          <div className="mt-3">
            {shown === "search" ? (
              <List rows={searches.items.length} empty={ts("noSets.search")} stale={searches.isStale} pages={searches.hasPages} label={t("selectPapers")}>
                {searches.items.map((search) => {
                  const key = `search:${search.id}`;
                  const source = picked(key);
                  return (
                    <SourceRow
                      key={search.id}
                      many
                      on={Boolean(source)}
                      onToggle={() => toggle(key, () => ranged(key, { kind: "search", searchId: search.id }, search.query, search.count ?? 0, true))}
                      disabled={!search.count}
                      icon={KIND.search.icon}
                      label={<QueryText query={search.query} />}
                      detail={
                        <span className="block min-w-0 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)]">
                          <FilterChips filters={{ ...search, field: undefined, sortBy: undefined }} size="compact" singleLine />
                        </span>
                      }
                      count={<Chip>{ts("paperCount", { count: search.count ?? 0 })}</Chip>}
                    >
                      {source ? scopeOf(source) : null}
                    </SourceRow>
                  );
                })}
              </List>
            ) : shown === "collection" ? (
              <List rows={collections.items.length} empty={ts("noSets.collection")} stale={collections.isStale} pages={collections.hasPages} label={t("selectPapers")}>
                {collections.items.map((c) => {
                  const key = `collection:${c._id}`;
                  const source = picked(key);
                  return (
                    <SourceRow key={c._id} many on={Boolean(source)} disabled={!c.itemCount} onToggle={() => toggle(key, () => ranged(key, { kind: "collection", collectionId: c._id }, c.name, c.itemCount, false))} icon={KIND.collection.icon} label={c.name} count={<Chip>{ts("paperCount", { count: c.itemCount })}</Chip>}>
                      {source ? scopeOf(source) : null}
                    </SourceRow>
                  );
                })}
              </List>
            ) : shown === "saved" ? (
              <List rows={1} label={t("selectPapers")}>
                {(() => {
                  const key = "saved";
                  const source = picked(key);
                  const count = savedCount ?? 0;
                  return (
                    <SourceRow many on={Boolean(source)} disabled={!count} onToggle={() => toggle(key, () => ranged(key, { kind: "saved" }, ts("allSavedPapers"), count, false))} icon={KIND.saved.icon} label={ts("allSavedPapers")} count={<Chip>{ts("paperCount", { count })}</Chip>}>
                      {source ? scopeOf(source) : null}
                    </SourceRow>
                  );
                })()}
              </List>
            ) : shown === "screening" ? (
              <List rows={screenings.items.length} empty={ts("noSets.screening")} stale={screenings.isStale} pages={screenings.hasPages} label={t("selectPapers")}>
                {screenings.items.map((job) => {
                  const key = `screening:${job._id}`;
                  const label = jobName(ts, job, date);
                  const source = picked(key);
                  return (
                    <SourceRow
                      key={job._id}
                      many
                      on={Boolean(source)}
                      disabled={!job.qualifiedPapers}
                      onToggle={() => toggle(key, () => ranged(key, { kind: "screening", jobId: job._id }, label, job.qualifiedPapers, false))}
                      icon={KIND.screening.icon}
                      label={label}
                      count={<Chip>{ts("paperCount", { count: job.qualifiedPapers })}</Chip>}
                    >
                      {/* Its included papers as they stand when the job starts: later changes to the screening leave the extraction as it is. */}
                      {source
                        ? scopeOf(
                            source,
                            <span className="flex flex-wrap gap-1.5">
                              <Chip className="text-foreground">{t("includedPapers", { count: papersOf(source) })}</Chip>
                              <Chip>{t("asTheyStand")}</Chip>
                            </span>,
                          )
                        : null}
                    </SourceRow>
                  );
                })}
              </List>
            ) : (
              <PdfUpload />
            )}
            {shown === "search" ? pager(searches) : shown === "collection" ? pager(collections, collectionCount === undefined ? undefined : Math.max(1, Math.ceil(collectionCount / SOURCE_PAGE))) : shown === "screening" ? pager(screenings) : null}
          </div>
        </Zone>

        <Zone
          label={ts("questions")}
          aside={
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={generate} disabled={generating || !canGenerate || !groups.length}>
              <AiIcon working={generating} />
              {t("writeQuestions")}
            </Button>
          }
        >
          <div className={LIST}>
            <Reorder.Group axis="y" values={draftJob.questions} onReorder={reorder} as="div" className="divide-y divide-border-subtle empty:hidden">
              <AnimatePresence initial={false}>
                {draftJob.questions.map((q, i) => (
                  <QuestionRow key={q.key} question={q} number={i + 1} onChange={(change) => updateQuestion(q.key, change)} onRemove={() => removeQuestion(q.key)} />
                ))}
              </AnimatePresence>
            </Reorder.Group>
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={t("sampleQuestion")} aria-label={t("addNewQuestion")} className="h-9 min-w-48 flex-1" />
              <TypePicker value={draftType} onChange={setDraftType} />
              <Button variant="outline" size="sm" className="h-9" onClick={add} disabled={!draft.trim()}>
                <Plus />
                {ts("add")}
              </Button>
            </div>
          </div>
        </Zone>

        {pdfCapability ? (
          <Zone label={t("usePdfsTitle")}>
            <label className={cn(LIST, "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5")}>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset", draftJob.usePdfs ? "text-primary" : "text-muted-foreground")}>
                <FileText className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t("usePdfsDescription")}</span>
              <Switch checked={draftJob.usePdfs} onCheckedChange={setUsePdfs} aria-label={t("usePdfsAriaLabel")} />
            </label>
          </Zone>
        ) : null}

        {/* What it runs on, from AI settings: one model for written answers, and for yes or no the decision model screening uses, when it's one. */}
        {textModel ? <ModelsInUse label={t("models")} uses={[{ label: t("textModel"), model: textModel }, { label: t("yesNoModel"), model: yesNoModel ?? textModel }]} /> : null}

        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-4 rounded-2xl border border-border-subtle bg-background p-4 shadow-lg">
          <CreditCheck credits={credits} balance={balance} enough={enough} />
          {why ? (
            <TooltipHint label={why}>
              <span tabIndex={0} className="rounded-md">
                <Button disabled className="pointer-events-none">
                  <AiIcon />
                  {t("startExtraction")}
                </Button>
              </span>
            </TooltipHint>
          ) : (
            <Button disabled={starting || estimate === undefined} onClick={start}>
              <AiIcon working={starting} />
              {starting ? tc("starting") : t("extractFrom", { count: total })}
            </Button>
          )}
        </div>
      </div>
    </Enter>
  );
}

/**
 * The papers picked so far: one bar, filling towards what the plan reads in one extraction, a part
 * per source in that kind's colour; and under it a chip per source, to take it out again. Past the
 * plan's papers, the bar fills to the brim and says by how many.
 */
function Tray({ groups, total, limit, onRemove }: { groups: Group[]; total: number; limit: number; onRemove: (group: Group) => void }) {
  const t = useTranslations("extraction");
  const format = useFormatter();
  // A plan with no limit fills the bar with the sources themselves, in proportion.
  const capped = Number.isFinite(limit);
  const over = capped && total > limit;
  const scale = capped ? Math.max(limit, total) : Math.max(1, total);
  return (
    <div className="space-y-3 rounded-2xl border border-border-subtle bg-inset p-4">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-2.5 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full", groups.length ? "bg-foreground/[0.06]" : "border border-dashed border-foreground/20")}>
          <AnimatePresence initial={false}>
            {groups.map((group) => (
              <motion.span key={group.key} layout initial={{ width: 0 }} animate={{ width: `${(group.papers / scale) * 100}%` }} exit={{ width: 0 }} transition={{ duration: 0.4, ease: EASE }} className="h-full shrink-0 first:rounded-l-full" style={{ backgroundColor: KIND[group.kind].tint }} />
            ))}
          </AnimatePresence>
        </div>
        <span className="flex shrink-0 items-baseline gap-1 text-sm tabular-nums">
          <span className={cn("font-semibold", over && "text-destructive")}>
            <AnimatedNumber value={total} />
          </span>
          <span className="text-xs text-muted-foreground">{capped ? t("trayOf", { limit: format.number(limit) }) : t("trayPapers", { count: total })}</span>
        </span>
      </div>
      {groups.length ? (
        <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)] pb-0.5">
          <AnimatePresence initial={false}>
            {groups.map((group) => {
              const Icon = KIND[group.kind].icon;
              return (
                <motion.span key={group.key} layout="position" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="inline-flex h-7 max-w-64 shrink-0 items-center gap-1.5 rounded-full bg-background pl-2.5 pr-1 text-xs ring-1 ring-border-subtle">
                  <Icon className="size-3.5 shrink-0" style={{ color: KIND[group.kind].tint }} />
                  <TooltipHint label={group.text} onlyWhenClipped>
                    <span className="min-w-0 truncate font-medium">{group.label}</span>
                  </TooltipHint>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{format.number(group.papers)}</span>
                  <button type="button" aria-label={t("removeSource", { name: group.text })} onClick={() => onRemove(group)} className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </motion.span>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("trayEmpty")}</p>
      )}
      {over ? <p className="text-xs text-destructive">{t("trayOver", { count: format.number(total - limit) })}</p> : null}
    </div>
  );
}

/** A kind's list in its box, keeping a full page's height while it has pages, so the pager stays put. */
function List({ rows, empty, stale = false, pages = false, label, children }: { rows: number; empty?: string; stale?: boolean; pages?: boolean; label: string; children: ReactNode }) {
  if (!rows) return <p className={cn(LIST, "px-4 py-8 text-center text-sm text-muted-foreground")}>{empty}</p>;
  return (
    <div style={pages ? { minHeight: SOURCE_PAGE * SOURCE_ROW + 1 } : undefined}>
      <div className={cn(LIST, stale && "pointer-events-none opacity-60")} role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** What kind of answer a question takes, with its icon. */
function TypePicker({ value, onChange, className }: { value: ExtractionQuestionType; onChange: (type: ExtractionQuestionType) => void; className?: string }) {
  const t = useTranslations("extraction");
  const names: Record<ExtractionQuestionType, string> = { string: t("typeText"), boolean: t("typeYesNo"), number: t("typeNumber"), array: t("typeList") };
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ExtractionQuestionType)}>
      <SelectTrigger size="sm" aria-label={t("answerType")} className={cn("h-9 w-32 shrink-0", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TYPES.map(({ id, icon: Icon }) => (
          <SelectItem key={id} value={id}>
            <Icon className="size-3.5" />
            {names[id]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A question in the list: dragged by its grip, its text and description written in place, its type picked. */
function QuestionRow({ question, number, onChange, onRemove }: { question: ExtractionQuestion; number: number; onChange: (change: Partial<ExtractionQuestion>) => void; onRemove: () => void }) {
  const t = useTranslations("extraction");
  const ts = useTranslations("screeningPage");
  const drag = useDragControls();
  const [describing, setDescribing] = useState(Boolean(question.description));
  return (
    <Reorder.Item value={question} as="div" dragListener={false} dragControls={drag} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden bg-card">
      <div className="flex items-start gap-3 px-4 py-2.5">
        <button type="button" aria-label={t("moveQuestion", { number })} onPointerDown={(e) => drag.start(e)} className="mt-1.5 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing">
          <GripVertical className="size-3.5" />
        </button>
        <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{number}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <input value={question.question} onChange={(e) => onChange({ question: e.target.value })} aria-label={t("questionNumber", { number })} className="h-9 w-full rounded-md bg-transparent px-2 text-sm outline-none hover:bg-muted/60 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/40" />
          {describing ? (
            <input value={question.description ?? ""} onChange={(e) => onChange({ description: e.target.value || undefined })} placeholder={t("whatCountsAsAnswer")} aria-label={t("questionDescription", { number })} className="h-8 w-full rounded-md bg-transparent px-2 text-xs text-muted-foreground outline-none hover:bg-muted/60 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/40" />
          ) : (
            <button type="button" onClick={() => setDescribing(true)} className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plus className="size-3" />
              {t("addDescription")}
            </button>
          )}
        </div>
        <TypePicker value={question.type} onChange={(type) => onChange({ type })} />
        <TooltipHint label={ts("removeQuestion")}>
          <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={ts("removeQuestion")} onClick={onRemove}>
            <Trash2 />
          </Button>
        </TooltipHint>
      </div>
    </Reorder.Item>
  );
}
