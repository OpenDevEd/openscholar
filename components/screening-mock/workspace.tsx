"use client";

// An open screening, across the whole window: Overview, Screen and Papers over the same votes, at
// either stage. Its reviewers, its settings and its state can change at any time from here.

import { useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import NextLink from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { AiIcon, BarChart3, Check, CircleCheck, CirclePause, Clock, Coins, Copy, Download, Eye, History, ListChecks, MoreHorizontal, Move, Play, Plus, RefreshCw, RotateCcw, Search, Settings2, Share2, Table2, Trash2, Unlink, UserPlus, Users } from "@/components/icons";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AnimatedNumber, Chip, Meter } from "@/components/screening/parts";
import { EASE, NodeCard } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { EVERY_LABEL, HOME, NOW, day, growing, workspaceOf, STAGES, STAGE_LABEL, activeReviewers, invitedReviewer, modelReviewer, modelsOf, peopleOf, personReviewer, type Reviewer, type Screening, type Stage, lookOf, ago } from "./data";
import { ActivitySheet, ExportDialog, MoveDialog, ShareDialog, type ExportTab } from "./dialogs";
import { EffectList, effectLines, effectMoves, movesText } from "./effects";
import { MockStates } from "./mock-states";
import { Overview } from "./overview";
import { Papers, type PapersFilter } from "./papers";
import { ReviewerStack } from "./parts";
import { NO_PLACE, Screen, type Place, type Queue } from "./screen";
import { credits, paperCredits, useMock, useModelsReading, useOpenScreening } from "./store";
import { AddModel, AddPerson, ConfirmChange } from "./team";

const VIEWS = ["overview", "screen", "papers"] as const;
type View = (typeof VIEWS)[number];

/** How a paper is decided here, as the three facts the row under the bar shows. */
function ruleFacts(screening: Screening) {
  const [people, models] = [peopleOf(screening).length, modelsOf(screening).length];
  const each = screening.rule.each === "all" ? people : Math.min(Number(screening.rule.each), people);
  const readers = [models ? (models === 1 ? "The model" : `All ${models} models`) : null, each ? `${each} ${each === 1 ? "person" : "people"}` : null].filter(Boolean).join(" and ");
  return {
    who: [each ? (each < people ? `${each} of ${people} people a paper` : `${people} ${people === 1 ? "person" : "people"}`) : null, models ? `${models} ${models === 1 ? "model" : "models"}` : null].filter(Boolean).join(", ") || "No reviewer",
    whoMeans: readers ? `${readers} read each paper` : "Nobody reads the papers yet",
    when: screening.rule.settle === "all" ? "All agree" : screening.rule.settle === "most" ? "Most agree" : "One vote",
    whenMeans: screening.rule.settle === "all" ? "A paper is settled when all its reviewers agree. Any disagreement is a conflict." : screening.rule.settle === "most" ? "A paper is settled by more than half of its reviewers. An even split is a conflict." : "The first vote on a paper settles it.",
    see: screening.rule.blind === "after" ? "Blind" : "Open",
    seeMeans: screening.rule.blind === "after" ? "People see a paper's other votes only once they have cast their own." : "People see every vote as it is cast.",
  };
}

export function ScreeningWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const store = useMock();
  const [viewParam, setView] = useQueryState("view");
  const [stageParam, setStage] = useQueryState("stage");
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "overview";
  const wanted: Stage = stageParam === "fullText" ? "fullText" : "abstract";
  const open = useOpenScreening(id, wanted);
  // A screening that stops at the abstract has no second stage to open.
  const stage: Stage = open?.screening.fullText ? wanted : "abstract";
  useModelsReading(id);
  const [queueParam, setQueueParam] = useQueryState("queue");
  const queue: Queue = queueParam === "done" || queueParam === "conflicts" ? queueParam : "todo";
  const setQueue = (next: Queue) => { setPlace(NO_PLACE); void setQueueParam(next === "todo" ? null : next); };
  const [filter, setFilter] = useState<PapersFilter>("all");
  const [added, setAdded] = useState("all");
  // Where you are in the Screen view's queue, kept here so another view doesn't lose it.
  const [place, setPlace] = useState<Place>(NO_PLACE);
  const [over, setOver] = useState<"activity" | "export" | "share" | "move" | "finish" | "delete" | null>(null);
  const [adding, setAdding] = useState<Reviewer | null>(null);
  // A reviewer being made a viewer from Share: they stop voting, and keep seeing it.
  const [demoting, setDemoting] = useState<Reviewer | null>(null);

  if (!open) {
    return (
      <PageWrapper>
        <LibraryPageShell icon={ListChecks} title="Screening" backHref="/screening/mock" backLabel="All screenings">
          <ListEmpty icon={Unlink}>This screening was deleted, or isn&apos;t shared with you</ListEmpty>
          <MockStates />
        </LibraryPageShell>
      </PageWrapper>
    );
  }

  const { screening } = open;
  const facts = ruleFacts(screening);
  const reviewers = activeReviewers(screening);
  const total = open.papers.length;
  const unsettled = open.counts.conflict + open.counts.waiting;
  const workspace = workspaceOf(screening);
  const banner = bannerKind(open, view === "screen");
  const shared = (screening.viewers?.length ?? 0) + peopleOf(screening).length;
  // Changes to its settings that were started and not saved.
  const unsaved = Boolean(store.drafts[id]);
  const [exportTab, setExportTab] = useState<ExportTab>("papers");
  const withAdded = (reviewer: Reviewer): Screening => ({
    ...screening,
    reviewers: [...screening.reviewers.filter((one) => one.id !== reviewer.id), reviewer],
    viewers: screening.viewers?.filter((one) => one.id !== reviewer.id),
    reached: { abstract: { ...screening.reached.abstract, [reviewer.id]: 0 }, fullText: { ...screening.reached.fullText, [reviewer.id]: 0 } },
  });
  // A person joins at once when nothing they do can move a result; a model always says what it costs first.
  const add = (reviewer: Reviewer) => setAdding(reviewer);
  // On a phone the bar keeps the title and one menu, which holds what the bar's buttons do.
  const phoneItems = (
    <>
      <DropdownMenuItem className="sm:hidden" onSelect={() => setOver("activity")}><History />Activity</DropdownMenuItem>
      <DropdownMenuItem className="sm:hidden" onSelect={() => setOver("export")}><Download />Export</DropdownMenuItem>
      <DropdownMenuItem className="sm:hidden" onSelect={() => setOver("share")}><Share2 />Share</DropdownMenuItem>
      <DropdownMenuItem className="sm:hidden" onSelect={() => router.push(`/screening/mock/${id}/settings`)}><Settings2 />Settings</DropdownMenuItem>
      <DropdownMenuSeparator className="sm:hidden" />
    </>
  );
  const demoted = (reviewer: Reviewer): Screening => ({ ...screening, reviewers: screening.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: Date.now() } : one)), viewers: [...(screening.viewers ?? []), { ...reviewer, left: undefined }] });

  // The screening's menu: in the bar, and on a phone at the end of the stage row, where the bar keeps to the title.
  const more = (className: string) => (
    <DropdownMenu>
      <TooltipHint label="More">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={`size-8 text-muted-foreground ${className}`} aria-label="More"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
      </TooltipHint>
      {/* Someone it is shared with from outside can start their own from it, and nothing else here. */}
      {!open.canChange ? (
        <DropdownMenuContent align="end" className="w-64">
          {phoneItems}
          <DropdownMenuItem onSelect={() => router.push(`/screening/mock/new?from=${id}`)}><Copy />Start your own with these settings</DropdownMenuItem>
        </DropdownMenuContent>
      ) : (
      <DropdownMenuContent align="end" className="w-56">
        {phoneItems}
        {screening.finishedAt ? (
          <DropdownMenuItem onSelect={() => store.update(id, (s) => ({ ...s, finishedAt: undefined }), { what: "Reopened the screening" })}><RotateCcw />Reopen</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setOver("finish")}><CircleCheck />Mark as finished</DropdownMenuItem>
        )}
        {modelsOf(screening).length && !screening.finishedAt ? (
          screening.paused ? (
            <DropdownMenuItem onSelect={() => store.update(id, (s) => ({ ...s, paused: false }), { what: "Let the models read on" })}><Play />Let the models read on</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => store.update(id, (s) => ({ ...s, paused: true }), { what: "Paused the models", effect: "They spend nothing until they are let on" })}><CirclePause />Pause the models</DropdownMenuItem>
          )
        ) : null}
        <DropdownMenuItem onSelect={() => router.push(`/screening/mock/new?from=${id}`)}><Copy />Run again with these settings</DropdownMenuItem>
        {growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking)} onSelect={open.check}><RefreshCw />Look for new papers now</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => setOver("move")}><Move />Move to another workspace</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setOver("delete")}><Trash2 />Delete</DropdownMenuItem>
      </DropdownMenuContent>
      )}
    </DropdownMenu>
  );

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        {/* Faces fade in as they load, where they would otherwise appear in one frame. */}
        <div className={`contents ${AVATARS_FADE_IN}`}>
          <LibraryPageShell
            wide
            icon={ListChecks}
            title={screening.name}
            backHref="/screening/mock"
            backLabel="All screenings"
            titleAside={
              screening.finishedAt || workspace !== HOME ? (
                <>
                  {screening.finishedAt ? <Chip icon={CircleCheck} className="bg-success/12 ink-success">Finished</Chip> : null}
                  {workspace !== HOME ? <WorkspaceTag size="sm" workspace={lookOf(workspace, screening.createdBy)} /> : null}
                </>
              ) : null
            }
            tabs={
              <Segmented
                label="View"
                value={view}
                onChange={(next) => { void setView(next === "overview" ? null : next); window.scrollTo({ top: 0 }); }}
                options={[
                  { id: "overview", label: "Overview", icon: BarChart3 },
                  { id: "screen", label: "Screen", icon: ListChecks, detail: open.toDo.length ? <span className="tabular-nums text-muted-foreground">{open.toDo.length}</span> : undefined },
                  { id: "papers", label: "Papers", icon: Table2, detail: <span className="tabular-nums text-muted-foreground">{total}</span> },
                ]}
              />
            }
            actions={
              <>
                <TooltipHint label="Activity">
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground max-sm:hidden" aria-label="Activity" onClick={() => setOver("activity")}><History /></Button>
                </TooltipHint>
                <Button variant="outline" size="sm" className={`${BAR_ACTION} max-sm:hidden`} onClick={() => setOver("export")}><Download /><span className={BAR_LABEL}>Export</span></Button>
                <Button variant="outline" size="sm" className={`${BAR_ACTION} max-sm:hidden`} aria-label="Share this screening" onClick={() => setOver("share")}>
                  <Share2 /><span className={BAR_LABEL}>Share</span>
                  {shared ? <span className="ms-0.5 rounded-full bg-muted px-1.5 text-2xs tabular-nums">{shared}</span> : null}
                </Button>
                <Button asChild variant="outline" size="sm" className={`${BAR_ACTION} max-sm:hidden`}>
                  <NextLink href={`/screening/mock/${id}/settings`}><Settings2 /><span className={BAR_LABEL}>Settings</span>{unsaved ? <span className="ms-0.5 rounded-full bg-warning/20 px-1.5 text-2xs ink-warning">Unsaved</span> : null}</NextLink>
                </Button>
                {more("max-sm:hidden")}
              </>
            }
            intro={
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
                  {screening.fullText ? (
                    <Segmented
                      label="Stage"
                      value={stage}
                      onChange={(next) => void setStage(next === "abstract" ? null : next)}
                      options={STAGES.map((one) => ({
                        id: one,
                        label: STAGE_LABEL[one],
                        detail: (
                          <span className="flex items-center gap-1.5">
                            {/* A phone has room for one number: what waits for you, where something does. */}
                            <span className={`tabular-nums text-muted-foreground ${open.todoAt[one] ? "max-sm:hidden" : ""}`}>{(one === "abstract" ? open.first : open.second).papers.length}</span>
                            {open.todoAt[one] ? <span className="rounded-full bg-primary/15 px-1.5 text-2xs font-medium tabular-nums text-primary">{open.todoAt[one]}<span className="max-sm:sr-only"> for you</span></span> : null}
                          </span>
                        ),
                      }))}
                    />
                  ) : (
                    <Chip className="h-8 px-3">{STAGE_LABEL.abstract} only</Chip>
                  )}
                  {/* How a paper is decided here, in three facts. They open the place where each is set. */}
                  <NextLink href={`/screening/mock/${id}/settings#decided`} className="flex min-w-0 items-center gap-1.5 rounded-lg outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/50 max-xl:hidden">
                    <TooltipHint label={facts.whoMeans}><span className="flex rounded-md"><Chip icon={Users}>{facts.who}</Chip></span></TooltipHint>
                    <TooltipHint label={facts.whenMeans}><span className="flex rounded-md"><Chip icon={Check}>{facts.when}</Chip></span></TooltipHint>
                    <TooltipHint label={facts.seeMeans}><span className="flex rounded-md"><Chip icon={Eye}>{facts.see}</Chip></span></TooltipHint>
                  </NextLink>
                  {/* A living screening says so, and when it next looks for papers. */}
                  {screening.living ? (
                    <NextLink href={`/screening/mock/${id}/settings#new-papers`} className="flex rounded-md outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/50 max-xl:hidden">
                      <TooltipHint label={`A living screening: it looks in its sources again ${EVERY_LABEL[screening.living.every].toLowerCase()}, and screens what is new. Next on ${day(screening.living.next)}.`}>
                        <span className="flex rounded-md"><Chip icon={RefreshCw} className="bg-success/12 ink-success">Living, next {day(screening.living.next)}</Chip></span>
                      </TooltipHint>
                    </NextLink>
                  ) : null}
                  <span className="ms-auto flex sm:hidden">{more("")}</span>
                  <div className={`flex items-center gap-2 max-sm:w-full sm:ms-auto ${view === "screen" ? "max-lg:hidden" : ""}`}>
                    <ReviewerStack reviewers={reviewers} />
                    {open.canChange ? (
                      <>
                        <AddPerson exclude={reviewers.map((reviewer) => reviewer.id)} onPick={(pick) => add("person" in pick ? personReviewer(pick.person, Date.now()) : invitedReviewer(pick.email, Date.now()))}>
                          <Button variant="ghost" size="sm" className="h-8 text-xs"><UserPlus />Person</Button>
                        </AddPerson>
                        <AddModel exclude={modelsOf(screening).map((model) => model.model!.id)} onPick={(model) => add(modelReviewer(model, Date.now()))}>
                          <Button variant="ghost" size="sm" className="h-8 text-xs"><Plus />Model</Button>
                        </AddModel>
                      </>
                    ) : null}
                  </div>
                </div>
                {/* The row comes and goes as the models start and finish: it slides, so nothing under it jumps. */}
                <AutoHeight>
                  <Banner kind={banner} open={open} workspace={workspace.name} onScreen={() => { void setStage(null); setQueue("todo"); void setView("screen"); }} onAddCredits={() => store.set({ wallet: store.wallet + 20_000 })} onReopen={() => store.update(id, (s) => ({ ...s, finishedAt: undefined }), { what: "Reopened the screening" })} onResume={() => store.update(id, (s) => ({ ...s, paused: false }), { what: "Let the models read on" })} />
                </AutoHeight>
              </>
            }
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${view}:${stage}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.3, ease: EASE }}>
                {view === "overview" ? (
                  <Overview
                    open={open}
                    onOpen={(next, what) => {
                      if (next === "screen") setQueue(what === "conflicts" ? "conflicts" : "todo");
                      else setFilter(what && what !== "conflicts" && what !== "todo" ? what : "all");
                      void setView(next);
                      window.scrollTo({ top: 0 });
                    }}
                    onStage={(next) => void setStage(next === "abstract" ? null : next)}
                    onExport={(what) => { setExportTab(what); setOver("export"); }}
                    onAdded={(at) => { setFilter("all"); setAdded(at); void setStage(null); void setView("papers"); }}
                  />
                ) : view === "screen" ? (
                  <Screen open={open} banner={banner !== null} queue={queue} onQueue={setQueue} place={place} onPlace={setPlace} onView={(next) => void setView(next === "overview" ? null : next)} />
                ) : (
                  <Papers open={open} filter={filter} onFilter={setFilter} added={added} onAdded={setAdded} />
                )}
              </motion.div>
            </AnimatePresence>
          </LibraryPageShell>
        </div>

        <ActivitySheet open={over === "activity"} onClose={() => setOver(null)} state={open} onPaper={(paper, at) => { void setStage(at === "abstract" ? null : at); void setQueueParam("done"); setPlace({ ...NO_PLACE, picked: paper, page: 0 }); void setView("screen"); window.scrollTo({ top: 0 }); }} />
        <ExportDialog open={over === "export"} onClose={() => setOver(null)} state={open} tab={exportTab} onTab={setExportTab} />
        <ShareDialog open={over === "share"} onClose={() => setOver(null)} state={open} onPromote={(viewer) => { setOver(null); setAdding({ ...viewer, addedAt: Date.now() }); }} onDemote={(reviewer) => { setOver(null); setDemoting(reviewer); }} />
        <MoveDialog open={over === "move"} onClose={() => setOver(null)} screening={screening} me={open.me} onMove={(to, what) => open.update((s) => ({ ...s, workspace: to }), { what })} />
        <ConfirmChange
          open={demoting !== null}
          title={demoting ? `Stop ${demoting.name} voting?` : ""}
          confirm="Make them a viewer"
          onClose={() => setDemoting(null)}
          onConfirm={() => demoting && store.update(id, () => demoted(demoting), { what: `Made ${demoting.name} a viewer`, effect: [...effectLines(screening, demoted(demoting)), movesText(effectMoves(screening, demoted(demoting)))].filter(Boolean).join(". ") || undefined })}
        >
          {demoting ? <EffectList lines={[...effectLines(screening, demoted(demoting)), "They go on seeing every paper and every vote"]} moves={effectMoves(screening, demoted(demoting))} /> : null}
        </ConfirmChange>
        <ConfirmChange
          open={over === "finish"}
          title="Mark this screening as finished?"
          confirm="Mark as finished"
          onClose={() => setOver(null)}
          onConfirm={() => store.update(id, (s) => ({ ...s, finishedAt: Date.now(), living: undefined }), { what: "Marked the screening as finished", effect: [unsettled ? `${unsettled} papers were not settled` : "", screening.living ? "It stopped looking for new papers" : ""].filter(Boolean).join(". ") || undefined })}
        >
          <EffectList
            lines={[
              ...(unsettled ? [`${unsettled} ${unsettled === 1 ? "paper is" : "papers are"} not settled, and ${unsettled === 1 ? "stays" : "stay"} as ${unsettled === 1 ? "it is" : "they are"}`] : []),
              ...(open.reading.length ? ["The models stop reading"] : []),
              ...(screening.living ? ["It stops looking for new papers"] : []),
              "It moves to Finished in the list, and can be reopened or changed at any time",
            ]}
          />
        </ConfirmChange>
        <ConfirmChange open={over === "delete"} title={`Delete “${screening.name}”?`} confirm="Delete" onClose={() => setOver(null)} onConfirm={() => { store.remove(id); router.push("/screening/mock"); }}>
          <EffectList lines={["Its votes and its settings go with it", "Papers it saved to a collection stay there"]} />
        </ConfirmChange>
        <ConfirmChange
          open={adding !== null}
          title={adding ? `Add ${adding.name} as a reviewer?` : ""}
          confirm="Add"
          disabled={Boolean(adding?.model && !screening.criteria.length)}
          onClose={() => setAdding(null)}
          onConfirm={() => {
            if (!adding) return;
            const after = withAdded(adding);
            store.update(id, () => after, { what: `Added ${adding.name} as a reviewer`, effect: effectLines(screening, after)[0] });
          }}
        >
          {adding ? (
            <>
              {adding.model ? (
                <NodeCard model={adding.model} paidBy="credits" tabIndex={-1} note={<span className="tabular-nums">{credits(paperCredits(adding.model, "abstract"))} credits a paper</span>} />
              ) : (
                <div className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-inset p-3">
                  <IdentityAvatar name={adding.name} imageUrl={adding.imageUrl} className="size-9" />
                  <p className="min-w-0 truncate text-sm font-medium">{adding.name}</p>
                </div>
              )}
              {adding.model && !screening.criteria.length ? (
                <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm ink-warning">A model answers criteria, and this screening has none: it would include every paper it reads. Add criteria in the settings first.</p>
              ) : (
                <EffectList lines={effectLines(screening, withAdded(adding))} moves={effectMoves(screening, withAdded(adding))} />
              )}
              {adding.model ? <p className="text-xs tabular-nums text-muted-foreground">{credits(store.wallet)} credits in the workspace now</p> : null}
            </>
          ) : null}
        </ConfirmChange>
        <MockStates />
      </PageWrapper>
    </MotionConfig>
  );
}

/** What a person needs to know before anything else: the models are out of credits, still reading, or the screening is finished, or it isn't theirs to vote on. */
type BannerKind = "gathering" | "checking" | "credits" | "finished" | "paused" | "waiting" | "reading" | "viewer" | "guest" | "arrived" | "nothing";
/** Which one thing the row under the stage says. `quiet` leaves the models' progress out: screening paper after paper, that is the Overview's to show, and a row that came and went would move the paper being read. */
function bannerKind(open: NonNullable<ReturnType<typeof useOpenScreening>>, quiet: boolean): BannerKind | null {
  const { screening, reading, stage } = open;
  if (open.gathering) return "gathering";
  if (screening.checking) return "checking";
  if (open.outOfCredits) return "credits";
  if (screening.finishedAt) return "finished";
  // Who you are to the screening comes before what its models are doing: a notice that arrives later moves what is being pressed.
  if (!open.isReviewer) return "viewer";
  if (!open.canChange) return "guest";
  // New papers that wait for you come before how far the models are.
  if (!quiet && open.latest?.mine) return "arrived";
  if (!quiet && screening.updates?.at(-1)?.added === 0 && screening.updates.at(-1)!.at > NOW) return "nothing";
  if (!quiet && reading.length) return screening.paused ? "paused" : open.waitingFor && stage === "abstract" ? "waiting" : "reading";
  return null;
}

function Banner({ kind, open, workspace, onAddCredits, onReopen, onResume, onScreen }: { kind: BannerKind | null; open: NonNullable<ReturnType<typeof useOpenScreening>>; workspace: string; onAddCredits: () => void; onReopen: () => void; onResume: () => void; onScreen: () => void }) {
  const { screening, reading, papers, stage } = open;
  // Every kind of row is as tall as the tallest, the one with a button: one giving way to another moves nothing under it.
  const row = "flex min-h-[3.25rem] flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle px-4 py-2.5 text-sm sm:px-6";
  if (kind === "checking" && screening.checking) {
    return (
      <div className={row}>
        <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Looking for new papers</span>
        <Meter value={screening.checking.done} max={screening.checking.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground">{screening.checking.done} of {screening.checking.of} {screening.checking.of === 1 ? "source" : "sources"} checked</span>
      </div>
    );
  }
  if (kind === "arrived" && open.latest) {
    return (
      <div className={`${row} bg-success/10`}>
        <RefreshCw className="size-4 shrink-0 ink-success" />
        <span className="font-medium">{open.latest.papers} new {open.latest.papers === 1 ? "paper" : "papers"} came in {ago(open.latest.at)}</span>
        <span className="min-w-0 flex-1 text-muted-foreground max-sm:basis-full">{open.latest.mine} of them {open.latest.mine === 1 ? "waits" : "wait"} for you. The rest of the screening stands as it was.</span>
        <Button size="sm" onClick={onScreen}><ListChecks />Screen {open.latest.mine === 1 ? "it" : "them"}</Button>
      </div>
    );
  }
  if (kind === "nothing") {
    const before = screening.updates?.at(-2)?.at ?? screening.createdAt;
    return (
      <div className={row}>
        <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1"><span className="font-medium">Nothing new.</span> <span className="text-muted-foreground">Its sources hold no paper they didn&apos;t hold on {day(before)}.</span></span>
      </div>
    );
  }
  if (kind === "gathering" && open.gathering) {
    return (
      <div className={row}>
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Getting its papers</span>
        <Meter value={open.gathering.done} max={open.gathering.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground"><AnimatedNumber value={open.gathering.done} /> of {open.gathering.of.toLocaleString("en-GB")}</span>
        <span className="min-w-0 flex-1 text-muted-foreground">You can start screening the ones that are in.</span>
      </div>
    );
  }
  if (kind === "credits") {
    return (
      <div className={`${row} bg-warning/10`}>
        <Coins className="size-4 shrink-0 ink-warning" />
        <span className="font-medium">Out of credits</span>
        <span className="min-w-0 flex-1 text-muted-foreground">{reading.map((model) => model.name).join(" and ")} stopped at {Math.max(...reading.map((model) => screening.reached[stage][model.id] ?? 0))} of {papers.length} papers. What they read is kept.</span>
        <Button size="sm" onClick={onAddCredits}>Add 20,000 credits</Button>
      </div>
    );
  }
  if (kind === "finished") {
    return (
      <div className={row}>
        <CircleCheck className="size-4 shrink-0 ink-success" />
        <span className="min-w-0 flex-1"><span className="font-medium">Finished.</span> <span className="text-muted-foreground">Everything in it can still be read, exported and changed.</span></span>
        {open.canChange && growing(screening).length ? <Button variant="outline" size="sm" onClick={open.check}><RefreshCw />Look for new papers</Button> : null}
        {open.canChange ? <Button variant="outline" size="sm" onClick={onReopen}><RotateCcw />Reopen</Button> : null}
      </div>
    );
  }
  if (kind === "paused") {
    return (
      <div className={row}>
        <CirclePause className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1"><span className="font-medium">The models are paused.</span> <span className="text-muted-foreground">They spend nothing, and people can go on voting.</span></span>
        {open.canChange ? <Button variant="outline" size="sm" onClick={onResume}><Play />Let them read on</Button> : null}
      </div>
    );
  }
  if (kind === "waiting" && open.waitingFor) {
    return (
      <div className={row}>
        <Clock className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{reading.length === 1 ? "Its model starts" : "Its models start"} after {open.waitingFor.screening.name}</span>
        <Meter value={open.waitingFor.done} max={open.waitingFor.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground"><AnimatedNumber value={open.waitingFor.done} /> of {open.waitingFor.of.toLocaleString("en-GB")}</span>
        <TooltipHint label={`${workspace}'s models read 40 papers at once, so a screening started behind another waits its turn. People can vote in the meantime.`}>
          <span tabIndex={0} className="flex rounded-md"><Chip>40 papers at once</Chip></span>
        </TooltipHint>
      </div>
    );
  }
  if (kind === "reading") {
    const done = Math.min(...reading.map((model) => screening.reached[stage][model.id] ?? 0));
    return (
      <div className={row}>
        <AiIcon working className="size-4 shrink-0" />
        <span className="font-medium">{reading.length === 1 ? reading[0]!.name : `${reading.length} models`} reading</span>
        <Meter value={done} max={papers.length} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground">{done} of {papers.length}</span>
      </div>
    );
  }
  if (kind === "viewer") {
    return (
      <div className={row}>
        <Eye className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">You can see this screening and every vote in it. You are not one of its reviewers, so no paper waits for you.</span>
        {open.canChange && !screening.finishedAt ? <Button variant="outline" size="sm" onClick={open.join}><UserPlus />Join as a reviewer</Button> : null}
      </div>
    );
  }
  if (kind === "guest") {
    return (
      <div className={row}>
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">Shared with you by {workspace}. You vote on the papers dealt to you, and its settings are changed by {workspace}&apos;s members.</span>
      </div>
    );
  }
  return null;
}
