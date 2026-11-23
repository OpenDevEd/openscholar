"use client";

// The open screening's Overview: what to do next, how far it has got, who has done what, how far
// the reviewers agree, and the counts a methods section asks for.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NextLink from "next/link";
import { AiIcon, ArrowRight, Ban, CircleCheck, CircleHelp, CirclePause, Clock, Coins, Download, Folder, RefreshCw, GitCompare, ListChecks, Mail, MoreHorizontal, RotateCcw, Trash2, TriangleAlert } from "@/components/icons";
import { AnimatedNumber, Chip, Meter } from "@/components/screening/parts";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { EASE } from "@/components/settings/model-map";
import { LIST, Zone, pagerOf } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { YouTag } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DECISIONS, EVERY_LABEL, NOW, RESULTS, RESULT_LABEL, SCHEDULE, STAGE_LABEL, day, growing, activeReviewers, agreement, ago, count, keptOf, HOME, modelsOf, personOf, failedLabel, reasonOf, taken, workspaceOf, type Result, type Reviewer, type Screening, type Stage, lookOf } from "./data";
import { COLLECTIONS, COMMUNITY_COLLECTIONS } from "./form-data";
import { EffectList, effectLines, effectMoves, movesText } from "./effects";
import { RESULT_STYLE, ResultBar, ReviewerMark, Tally } from "./parts";
import { credits, paperCredits, useMock, type Open } from "./store";
import { ConfirmChange } from "./team";

export function Overview({ open, onOpen, onStage, onExport, onAdded }: { open: Open; onOpen: (view: "screen" | "papers", filter?: Result | "conflicts" | "todo") => void; onStage: (stage: Stage) => void; onExport: (what: "flow") => void; /** Opens the papers one arrival brought. */ onAdded: (at: string) => void }) {
  const { screening, stage, papers, votes, settled, counts, toDo, conflicts } = open;
  const reviewers = activeReviewers(screening);
  const [leaving, setLeaving] = useState<Reviewer | null>(null);
  const rows = useMemo(
    () =>
      reviewers.map((reviewer) => {
        const theirs = papers.filter((paper) => votes[paper.id]!.some((one) => one.reviewer.id === reviewer.id));
        const cast = theirs.flatMap((paper) => votes[paper.id]!.find((one) => one.reviewer.id === reviewer.id)!.vote ?? []);
        const judged = theirs.flatMap((paper) => {
          const [vote, final] = [votes[paper.id]!.find((one) => one.reviewer.id === reviewer.id)!.vote, settled[paper.id]!.final];
          return vote && final ? [{ vote: vote.decision, final }] : [];
        });
        // On papers every reviewer has voted on: did this one choose what most of the others chose?
        const compared = theirs.flatMap((paper) => {
          const cast = votes[paper.id]!.filter((one) => !one.failed);
          const mine = cast.find((one) => one.reviewer.id === reviewer.id)?.vote;
          const others = cast.filter((one) => one.reviewer.id !== reviewer.id).map((one) => one.vote);
          if (!mine || !others.length || others.some((vote) => !vote)) return [];
          const tally = DECISIONS.map((decision) => count(others, (vote) => vote!.decision === decision));
          return [tally[DECISIONS.indexOf(mine.decision)] === Math.max(...tally)];
        });
        return {
          reviewer,
          assigned: theirs.length,
          done: cast.length,
          split: DECISIONS.map((decision) => count(cast, (vote) => vote.decision === decision)),
          agrees: compared.length ? count(compared, (same) => same) / compared.length : null,
          compared: compared.length,
          missed: count(judged, (one) => one.final === "include" && one.vote === "exclude"),
          included: count(judged, (one) => one.final === "include"),
        };
      }),
    [reviewers, papers, votes, settled],
  );
  const matrix = useMemo(() => reviewers.map((a) => reviewers.map((b) => (a === b ? null : agreement(a.id, b.id, open)))), [reviewers, open]);
  const without = (reviewer: Reviewer): Screening => ({ ...screening, reviewers: screening.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: Date.now() } : one)) });
  const settledAll = papers.length > 0 && counts.conflict + counts.waiting === 0;
  // People who read a share, beside models who read everything: the two counts in the table differ, and the page says why.
  const peopleDealt = rows.some((row) => row.reviewer.kind === "person" && row.assigned < papers.length) && rows.some((row) => row.reviewer.kind === "model");

  if (!papers.length && open.gathering) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
        <p className="text-sm font-medium">Its papers are on their way</p>
        <p className="max-w-md text-sm text-muted-foreground">They are being fetched from its sources and show here as they arrive. You can start screening as soon as the first are in.</p>
      </div>
    );
  }
  if (!papers.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
        <p className="text-sm font-medium">No paper has reached {STAGE_LABEL[stage].toLowerCase()} yet</p>
        <p className="max-w-md text-sm text-muted-foreground">{stage === "fullText" ? "A paper comes here once it is included on its title and abstract. Nothing else needs doing: it happens as papers settle." : "Add a source in the settings to give this screening its papers."}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => onStage("abstract")}>{stage === "fullText" ? "Go to title and abstract" : "Open the settings"}</Button>
      </div>
    );
  }

  return (
    <div className="@container/overview space-y-7 p-4 sm:p-6">
      <Zone
        label="Progress"
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {toDo.length ? (
              <Button size="sm" variant={screening.finishedAt ? "outline" : "default"} onClick={() => onOpen("screen", "todo")}><ListChecks />Screen <AnimatedNumber value={toDo.length} /> {toDo.length === 1 ? "paper" : "papers"}</Button>
            ) : null}
            {conflicts.length ? (
              <Button size="sm" variant={toDo.length || screening.finishedAt || !open.canResolve ? "outline" : "default"} onClick={() => onOpen("screen", "conflicts")}><GitCompare />{open.canResolve ? "Settle" : "See"} <AnimatedNumber value={conflicts.length} /> {conflicts.length === 1 ? "conflict" : "conflicts"}</Button>
            ) : null}
            {settledAll && stage === "abstract" && screening.fullText ? <Button size="sm" variant={screening.finishedAt ? "outline" : "default"} onClick={() => onStage("fullText")}>{screening.finishedAt ? "See the full-text stage" : "Go on to full text"}<ArrowRight /></Button> : null}
            {settledAll && stage === "fullText" ? (
              <>
                <Button asChild size="sm" variant="outline"><NextLink href="/extraction/new">Extract from the included papers</NextLink></Button>
                <Chip icon={CircleCheck} className="h-8 bg-success/12 px-3 ink-success">Every paper is settled</Chip>
              </>
            ) : null}
          </div>
        }
      >
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={papers.length - counts.conflict - counts.waiting} /></span>
          <span className="text-sm text-muted-foreground">of {papers.length.toLocaleString("en-GB")} papers settled</span>
          {open.reading.length && !screening.paused && !open.outOfCredits && !screening.finishedAt ? <Chip className="self-center"><AiIcon working className="size-3.5" />Models are reading, so these move</Chip> : null}
          {stage === "fullText" && !screening.finishedAt ? <span className="text-sm text-muted-foreground">Papers arrive here one by one, as they are included or left as maybe on their abstract.</span> : null}
        </p>
        <ResultBar counts={counts} className="h-3" />
        <Yours open={open} />
        {/* Each count opens its papers. */}
        <div className="-mx-2 flex flex-wrap gap-x-1 gap-y-1 pt-1">
          {RESULTS.map((result) => {
            const Icon = RESULT_STYLE[result].icon;
            const hint = result === "waiting" && open.waitingOn.length ? `Waiting on ${open.waitingOn.map((one) => `${one.reviewer.name} (${one.papers})`).join(", ")}` : result === "conflict" ? `Their reviewers voted differently. ${personOf(screening.rule.resolver)?.name ?? "A named person"} settles them.` : result === "maybe" ? (stage === "abstract" && screening.fullText ? "Left open on the abstract: they go on to full text" : "Left open: a must-have criterion couldn't be answered") : undefined;
            return (
              <TooltipHint key={result} label={hint}>
                <button type="button" onClick={() => onOpen("papers", result)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted">
                  <span className={cn("flex size-6 items-center justify-center rounded-md", RESULT_STYLE[result].chip)}><Icon className="size-3.5" /></span>
                  <span className="font-semibold tabular-nums"><AnimatedNumber value={counts[result]} /></span>
                  <span className="text-muted-foreground">{RESULT_LABEL[result]}</span>
                </button>
              </TooltipHint>
            );
          })}
        </div>
      </Zone>

      <Facts open={open} />
      {stage === "abstract" ? <NewPapers open={open} onAdded={onAdded} /> : null}

      <div className="grid grid-cols-1 gap-7 @5xl/overview:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Zone label="Reviewers" aside={<Chip>{STAGE_LABEL[stage]}</Chip>}>
          {rows.length ? (
            <div className={LIST}>
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_8.5rem_7.5rem_2rem] items-center gap-4 whitespace-nowrap px-4 py-2 text-xs text-muted-foreground @max-2xl/overview:hidden">
                <span>Reviewer</span>
                <span>Papers voted on</span>
                <span>Their votes</span>
                <Help label="Votes with the others">
                  <p>On the papers every reviewer has voted on, how often this reviewer chose what most of the others chose.</p>
                  <p>A low figure is a reviewer who reads the criteria differently from the rest, person or model.</p>
                  <p>For a model, <span className="font-medium text-foreground">missed</span> counts the papers the screening included that it voted to exclude: the mistake that loses a study.</p>
                </Help>
                <span />
              </div>
              {rows.map(({ reviewer, assigned, done, split, agrees, compared, missed, included }) => {
                const unreadPapers = reviewer.kind === "model" ? open.unread(reviewer) : [];
                const unread = unreadPapers.length;
                const reading = reviewer.kind === "model" && done + unread < assigned && !screening.finishedAt;
                const held = open.outOfCredits ? { icon: Coins, text: "Stopped, out of credits" } : screening.paused ? { icon: CirclePause, text: "Paused" } : open.waitingFor && stage === "abstract" ? { icon: Clock, text: "Waiting its turn" } : null;
                const person = personOf(reviewer.id);
                return (
                  <div key={reviewer.id} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_8.5rem_7.5rem_2rem] items-center gap-4 px-4 py-3 @max-2xl/overview:grid-cols-[minmax(0,1fr)_5.5rem_2rem] @max-2xl/overview:gap-y-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <ReviewerMark reviewer={reviewer} className="size-8 self-start" />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate">{reviewer.name}</span>{reviewer.id === open.me ? <YouTag /> : reviewer.kind === "model" ? <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 text-2xs font-normal leading-5 text-muted-foreground">AI</span> : null}</p>
                        {reviewer.kind === "model" ? (
                          // One line whatever it holds, so a paper that fails while it reads doesn't make the row taller.
                          <div className="flex h-5 min-w-0 items-center gap-2">
                            <p className="flex min-w-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                              {reading ? (held ? <held.icon className="size-3.5 shrink-0" /> : <AiIcon working className="size-3.5 shrink-0" />) : <Coins className="size-3.5 shrink-0" />}
                              <span className="truncate">{reading ? (held?.text ?? "Reading") : `${credits(open.spent(reviewer))} credits`}</span>
                            </p>
                            {unread ? (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button type="button" aria-label={`${unread} ${unread === 1 ? "paper" : "papers"} it couldn't read`} className="flex shrink-0 rounded-md outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/50"><Chip icon={TriangleAlert} className="h-5 bg-destructive/10 px-1.5 text-destructive">{unread}</Chip></button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-72 space-y-2.5 p-3 text-sm">
                                  <p>Its provider gave an error on {unread === 1 ? "this paper" : `these ${unread} papers`}, so it has no say in {unread === 1 ? "it" : "them"}: the other reviewers settle {unread === 1 ? "it" : "them"}.</p>
                                  <ul className="space-y-1">
                                    {unreadPapers.slice(0, 4).map((paper) => <li key={paper.id} className="line-clamp-2 text-xs text-muted-foreground">{paper.title} ({paper.year})</li>)}
                                    {unread > 4 ? <li className="text-xs text-muted-foreground">and {unread - 4} more</li> : null}
                                  </ul>
                                  {open.canChange ? <Button size="sm" className="w-full" onClick={() => open.retry(reviewer)}><RotateCcw />Have it read {unread === 1 ? "it" : "them"} again, for {credits(unread * paperCredits(reviewer.model!, stage))} credits</Button> : null}
                                </PopoverContent>
                              </Popover>
                            ) : null}
                          </div>
                        ) : (
                          <p className="truncate text-xs text-muted-foreground">{reviewer.email ? "Invited, hasn't joined yet" : assigned && done === assigned ? "Done" : reviewer.addedAt > NOW ? "Added just now" : reviewer.reminded ? `Reminded ${ago(reviewer.reminded)}` : (person?.seen ?? "")}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 @max-2xl/overview:col-span-3 @max-2xl/overview:row-start-2">
                      <Meter value={done} max={Math.max(assigned, 1)} fill={assigned && done === assigned ? "bg-success" : "bg-foreground/45"} />
                      <span className="shrink-0 text-end text-xs tabular-nums text-muted-foreground @2xl/overview:w-20"><AnimatedNumber value={done} /> of {assigned}<span className="@2xl/overview:hidden"> voted on</span></span>
                    </div>
                    <div className="flex items-center gap-2.5 @max-2xl/overview:hidden">
                      {DECISIONS.map((decision, i) => {
                        const Icon = RESULT_STYLE[decision].icon;
                        return (
                          <span key={decision} role="img" aria-label={`${split[i]} ${decision}`} className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                            <span className={cn("flex size-4 items-center justify-center rounded", RESULT_STYLE[decision].chip)}><Icon className="size-2.5" /></span>
                            {split[i]}
                          </span>
                        );
                      })}
                    </div>
                    <div className="text-end @max-2xl/overview:col-start-2 @max-2xl/overview:row-start-1">
                      <p className="text-sm font-semibold tabular-nums">{agrees === null ? <span className="font-normal text-muted-foreground">Nothing to compare yet</span> : `${Math.round(agrees * 100)}%`}</p>
                      {agrees !== null ? <p className="whitespace-nowrap text-xs text-muted-foreground @2xl/overview:hidden">with the others</p> : null}
                      {agrees !== null && reviewer.kind === "person" ? <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground @max-2xl/overview:hidden">of {compared} papers</p> : null}
                      {reviewer.kind === "model" && included ? (
                        <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">missed {missed} of {included} included</p>
                      ) : null}
                    </div>
                    {open.canChange ? (
                      <DropdownMenu>
                        <TooltipHint label="More">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground @max-2xl/overview:col-start-3 @max-2xl/overview:row-start-1" aria-label={`More for ${reviewer.name}`}><MoreHorizontal /></Button>
                          </DropdownMenuTrigger>
                        </TooltipHint>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onSelect={() => onOpen("papers")}><ListChecks />See their votes in Papers</DropdownMenuItem>
                          {unread ? <DropdownMenuItem onSelect={() => open.retry(reviewer)}><RotateCcw />Read the {unread} it couldn&apos;t again</DropdownMenuItem> : null}
                          {reviewer.kind === "person" && reviewer.id !== open.me && done < assigned ? (
                            <DropdownMenuItem onSelect={() => open.update((s) => ({ ...s, reviewers: s.reviewers.map((one) => (one.id === reviewer.id ? { ...one, reminded: Date.now() } : one)) }), { what: `Sent ${reviewer.name} a reminder`, effect: `${assigned - done} papers wait for them` })}><Mail />Send a reminder</DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem variant="destructive" onSelect={() => setLeaving(reviewer)}><Trash2 />Take off this screening</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Nobody reads these papers yet. Add a person or a model from the row above.</p>
          )}
          {rows.length > 1 ? <p className="px-1 text-xs text-muted-foreground">{peopleDealt ? "Each person is dealt a share of the papers, and a model reads them all. " : ""}Votes with the others: on the papers every reviewer has voted on, how often this one chose what most of the others chose.</p> : null}
        </Zone>

        <Zone
          label="Agreement between reviewers"
          aside={
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Help label="Cohen's kappa">
                <p>How far two reviewers agree beyond what chance alone would give.</p>
                <p><span className="font-medium text-foreground">1.0</span> is the same vote on every paper, <span className="font-medium text-foreground">0</span> is no better than chance. From 0.6 up it is usually called substantial, and a methods section reports it.</p>
                <p>Each square compares two reviewers on the papers both have voted on.</p>
              </Help>
              {[0.3, 0.6, 0.8, 1].map((k) => (
                <span key={k} className="flex items-center gap-1 tabular-nums"><span className="size-3 rounded" style={{ backgroundColor: shade(k) }} />{k.toFixed(1)}</span>
              ))}
            </span>
          }
        >
          {rows.length > 1 && matrix.some((row) => row.some(Boolean)) ? (
            <div className="overflow-x-auto rounded-2xl border border-border-subtle p-4">
              <div className="grid min-w-max items-center gap-1" style={{ gridTemplateColumns: `minmax(8rem, auto) repeat(${reviewers.length}, minmax(2.75rem, 1fr))` }}>
                <span />
                {reviewers.map((reviewer) => (
                  <TooltipHint key={reviewer.id} label={reviewer.name}>
                    <span tabIndex={0} className="flex justify-center pb-1"><ReviewerMark reviewer={reviewer} /></span>
                  </TooltipHint>
                ))}
                {reviewers.map((a, row) => (
                  <div key={a.id} className="contents">
                    <span className="flex min-w-0 items-center gap-2 pe-3 text-xs"><ReviewerMark reviewer={a} className="size-5" /><span className="truncate">{a.name}</span></span>
                    {reviewers.map((b, column) => {
                      const pair = matrix[row]![column];
                      // Each pair shows once, under the diagonal.
                      if (column >= row) return <span key={b.id} className="h-11" />;
                      if (!pair) {
                        return (
                          <TooltipHint key={b.id} label="They haven't voted on the same paper yet">
                            <span tabIndex={0} className="h-11 rounded-lg border border-dashed border-border-subtle" />
                          </TooltipHint>
                        );
                      }
                      return (
                        <TooltipHint key={b.id} label={`Same decision on ${Math.round(pair.same * 100)}% of the ${pair.papers} papers both voted on`}>
                          <span tabIndex={0} className="flex h-11 items-center justify-center rounded-lg text-xs font-medium tabular-nums" style={{ backgroundColor: shade(pair.kappa) }}>
                            {pair.kappa.toFixed(2)}
                          </span>
                        </TooltipHint>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">How far the reviewers agree shows here once two of them have voted on the same papers.</p>
          )}
          {rows.length > 1 && matrix.some((row) => row.some(Boolean)) ? <p className="px-1 text-xs text-muted-foreground">Each square is two reviewers, on the papers both have voted on. 1.0 is the same vote every time, 0 is no better than chance.</p> : null}
        </Zone>
      </div>

      <Flow open={open} onExport={onExport} />

      <ConfirmChange
        open={leaving !== null}
        title={leaving ? `Take ${leaving.name} off this screening?` : ""}
        confirm="Take off"
        onClose={() => setLeaving(null)}
        onConfirm={() => leaving && open.update(() => without(leaving), { what: `Took ${leaving.name} off the screening`, effect: [...effectLines(screening, without(leaving)).slice(1), movesText(effectMoves(screening, without(leaving)))].filter(Boolean).join(". ") || undefined })}
      >
        {leaving ? <EffectList lines={effectLines(screening, without(leaving))} moves={effectMoves(screening, without(leaving))} /> : null}
      </ConfirmChange>
    </div>
  );
}

const UPDATE_PAGE = 4;

/**
 * New papers: whether the screening looks for them by itself, each time its sources were looked in
 * again and what that brought, and where those papers stand now. Looking again is one press.
 */
function NewPapers({ open, onAdded }: { open: Open; onAdded: (at: string) => void }) {
  const { screening, papers, settled } = open;
  const [page, setPage] = useState(1);
  const sources = growing(screening);
  if (!sources.length) return null;
  const updates = [...(screening.updates ?? [])].reverse();
  const pager = pagerOf(updates.length + 1, UPDATE_PAGE, page, setPage);
  const starter = personOf(screening.createdBy);
  const fixed = screening.sources.length - sources.length;
  // The row that says how it began closes the list, after every check.
  const rows = [...updates.map((update) => ({ update })), { update: null }].slice((pager.page - 1) * UPDATE_PAGE, pager.page * UPDATE_PAGE);
  return (
    <Zone
      label="New papers"
      aside={
        <span className="flex flex-wrap items-center justify-end gap-2">
          {screening.living ? (
            <>
              <Chip icon={RefreshCw} className="bg-success/12 ink-success">Living: looks {EVERY_LABEL[screening.living.every].toLowerCase()}</Chip>
              <Chip>Next on {day(screening.living.next)}</Chip>
            </>
          ) : (
            <Chip>Looks only when asked</Chip>
          )}
          {open.canChange ? (
            <>
              {!screening.living ? <Button asChild variant="ghost" size="sm" className="h-7 text-xs"><NextLink href={`/screening/mock/${screening.id}/settings#new-papers`}>Look on a schedule</NextLink></Button> : null}
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={Boolean(screening.checking)} onClick={open.check}><RefreshCw className={screening.checking ? "animate-spin motion-reduce:animate-none" : undefined} />Look now</Button>
            </>
          ) : null}
        </span>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-border-subtle" style={{ minHeight: pager.pages > 1 ? UPDATE_PAGE * 57 : undefined }}>
        <AnimatePresence initial={false}>
        {rows.map(({ update }) => {
          if (!update) {
            return (
              <div key="start" className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border-subtle px-4 py-2.5 first:border-t-0">
                <ReviewerMark reviewer={{ kind: "person", name: starter?.name ?? "", imageUrl: starter?.imageUrl }} className="size-7 self-start" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">Started by {starter?.name ?? "someone"}</p>
                  <p className="text-xs text-muted-foreground">{day(screening.createdAt)}</p>
                </div>
                <Chip>{papers.filter((paper) => paper.batch === undefined).length.toLocaleString("en-GB")} papers from {screening.sources.length} {screening.sources.length === 1 ? "source" : "sources"}</Chip>
                {fixed ? <Chip>{fixed} {fixed === 1 ? "is an uploaded file or a pasted list, which gets" : "are uploaded files or pasted lists, which get"} no new papers</Chip> : null}
              </div>
            );
          }
          const batch = papers.filter((paper) => paper.batch === update.at);
          const counts = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
          for (const paper of batch) counts[settled[paper.id]!.result]++;
          const who = update.by === SCHEDULE ? null : personOf(update.by);
          return (
            <motion.div key={update.at} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden border-t border-border-subtle first:border-t-0">
            <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              {who ? <ReviewerMark reviewer={{ kind: "person", name: who.name, imageUrl: who.imageUrl }} className="size-7 self-start" /> : <span className="flex size-7 shrink-0 items-center justify-center self-start rounded-full bg-muted text-muted-foreground"><Clock className="size-3.5" /></span>}
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium">{who ? `${update.by === open.me ? "You" : who.name} looked` : "Scheduled check"}</p>
                <p className="text-xs text-muted-foreground">{update.at > NOW ? "Just now" : day(update.at)}</p>
                {/* Where the papers were found: each source that gained some, with how many. */}
                {screening.sources.flatMap((source) => { const found = source.updates?.find((one) => one.at === update.at); return found ? [<p key={source.id} className="truncate text-xs text-muted-foreground">{found.added} in {source.name}</p>] : []; })}
              </div>
              {update.found ? (
                <>
                  <Chip>{update.found} found</Chip>
                  {update.found - update.added ? <Chip>{update.found - update.added} already in it</Chip> : null}
                  <Chip className="bg-success/12 ink-success">{update.added} added</Chip>
                  <span className="w-28 max-sm:hidden"><ResultBar counts={counts} /></span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!batch.length} onClick={() => onAdded(String(update.at))}>See them</Button>
                </>
              ) : (
                <Chip>Nothing new</Chip>
              )}
            </div>
            </motion.div>
          );
        })}
        </AnimatePresence>
      </div>
      {pager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={pager.total} itemsPerPage={UPDATE_PAGE} itemLabel="looks" /> : null}
    </Zone>
  );
}

/** Who started it and where it lives, where its included papers go, and what its models have cost: what a person asks of a screening before its numbers. */
function Facts({ open }: { open: Open }) {
  const { screening, first, second } = open;
  const store = useMock();
  const starter = personOf(screening.createdBy);
  const workspace = workspaceOf(screening);
  const models = modelsOf(screening);
  const last = screening.fullText ? second : first;
  const spent = models.reduce((sum, model) => sum + open.spent(model), 0);
  const most = models.reduce((sum, model) => sum + open.most(model), 0);
  const to = screening.destination;
  const collection = to.kind === "none" ? null : to.kind === "new" ? to.name || `Included in ${screening.name}` : ([...COLLECTIONS, ...COMMUNITY_COLLECTIONS].find((one) => one.id === to.collection)?.name ?? "A collection");
  const cell = "min-w-0 space-y-2 p-4";
  return (
    <div className="grid grid-cols-1 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle @3xl/overview:grid-cols-3 @3xl/overview:divide-x @3xl/overview:divide-y-0">
      <div className={cell}>
        <p className="text-xs text-muted-foreground">Started by</p>
        <div className="flex items-center gap-2.5">
          <IdentityAvatar name={starter?.name ?? ""} imageUrl={starter?.imageUrl} className="size-8 self-start" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate">{starter?.name ?? "Someone"}</span>{screening.createdBy === open.me ? <YouTag /> : null}</p>
            <p className="text-xs text-muted-foreground">{new Date(screening.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</p>
          </div>
        </div>
        <WorkspaceTag size="sm" workspace={lookOf(workspace, screening.createdBy)} />
      </div>
      <div className={cell}>
        <p className="text-xs text-muted-foreground">Included papers go to</p>
        <p className="flex items-center gap-2 text-sm font-medium">
          {collection ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <Ban className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{collection ?? "Nowhere yet"}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {collection ? <Chip icon={CircleCheck}><AnimatedNumber value={last.counts.include} /> saved so far</Chip> : null}
          {collection ? <Chip>{screening.fullText ? "Saved when included at full text" : "Saved as each is included"}</Chip> : <Chip>{last.counts.include} included, kept here</Chip>}
          {to.prune ? <Chip>Excluded ones leave their collection</Chip> : null}
          {open.canChange ? <Button asChild variant="ghost" size="sm" className="h-6 px-1.5 text-xs"><NextLink href={`/screening/mock/${screening.id}/settings#goes-to`}>{collection ? "Change" : "Choose a collection"}</NextLink></Button> : null}
        </div>
      </div>
      <div className={cell}>
        <p className="text-xs text-muted-foreground">Credits</p>
        {models.length ? (
          <>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                <AnimatedNumber value={Math.ceil(spent)} /> spent
                {open.reading.length && !screening.paused && !open.outOfCredits ? <AiIcon working className="size-3.5" /> : null}
              </p>
              <p className="truncate text-xs tabular-nums text-muted-foreground">{most - spent >= 1 ? `${credits(most)} once every paper is read` : "Every paper is read"}</p>
            </div>
            <Meter value={spent} max={Math.max(most, 1)} />
            <div className="flex flex-wrap gap-1.5">
              <Chip icon={Coins}>{credits(workspace === HOME ? store.wallet : workspace.credits)} left in {workspace.name}</Chip>
              <Chip>{models.length} {models.length === 1 ? "model" : "models"}</Chip>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Nothing to pay</p>
            <div className="flex flex-wrap gap-1.5"><Chip>People only</Chip><Chip>A model costs credits for each paper it reads</Chip></div>
          </>
        )}
      </div>
    </div>
  );
}

/** From 0.6, where agreement is called substantial, up to 1. */
const shade = (kappa: number) => (kappa < 0.4 ? "color-mix(in oklab, var(--destructive) 16%, transparent)" : kappa < 0.6 ? "color-mix(in oklab, var(--warning) 22%, transparent)" : `color-mix(in oklab, var(--success) ${Math.round(8 + Math.max(0, Math.min(1, (kappa - 0.6) / 0.4)) * 52)}%, transparent)`);

/** A word that needs explaining, with the explanation one press away: a hint that only opens on hover is no use on a phone. */
function Help({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center justify-end gap-1 rounded-md text-end outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">{label}<CircleHelp className="size-3.5 shrink-0" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-3 text-sm text-muted-foreground">{children}</PopoverContent>
    </Popover>
  );
}

/** Your own votes so far, where the page's totals don't show them yet: a paper settles once its other reviewers have voted too. */
function Yours({ open }: { open: Open }) {
  const mine = open.yours.flatMap((paper) => open.myVote(paper) ?? []);
  const waiting = open.yours.filter((paper) => open.myVote(paper) && open.settled[paper.id]!.result === "waiting");
  if (!mine.length || !waiting.length) return null;
  const others = [...new Set(waiting.flatMap((paper) => open.votes[paper.id]!.filter((one) => !one.vote && !one.failed).map((one) => one.reviewer.name)))];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-inset px-3 py-2 text-sm">
      <span className="font-medium">Your {mine.length.toLocaleString("en-GB")} {mine.length === 1 ? "vote" : "votes"}</span>
      <Tally votes={mine} />
      <span className="min-w-0 flex-1 text-muted-foreground max-sm:basis-full">{waiting.length.toLocaleString("en-GB")} of them {waiting.length === 1 ? "waits" : "wait"} for {others.slice(0, 2).join(" and ")}{others.length > 2 ? ` and ${others.length - 2} more` : ""} to vote before {waiting.length === 1 ? "it settles" : "they settle"}.</span>
    </div>
  );
}

/** The counts from sources to included papers, left to right: what a flow diagram is drawn from. */
function Flow({ open, onExport }: { open: Open; onExport: (what: "flow") => void }) {
  const { screening, first, second } = open;
  const found = screening.sources.reduce((sum, source) => sum + taken(source), 0);
  const kept = screening.sources.reduce((sum, source) => sum + keptOf(source), 0);
  const reasons = (state: typeof first) => {
    const tally = new Map<string, number>();
    for (const paper of state.papers) if (state.settled[paper.id]!.final === "exclude") { const key = reasonOf(state.votes[paper.id]!, state.settled[paper.id]) ?? "other"; tally.set(key, (tally.get(key) ?? 0) + 1); }
    return [...tally].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ label: `Excluded, ${failedLabel(key, screening.criteria).replace(/^Not met/, "not met")}`, value }));
  };
  const noText = count(second.papers, (paper) => !open.hasFullText(paper));
  const steps = [
    { title: "Found", total: found, rows: screening.sources.map((source) => ({ label: source.name, value: taken(source) })) },
    { title: "To screen", total: kept, note: "after duplicates", rows: [{ label: "Duplicates merged", value: found - kept }] },
    {
      title: "Title and abstract",
      total: screening.fullText ? second.papers.length : first.counts.include,
      note: screening.fullText ? "go on to full text" : "included",
      rows: [...reasons(first), { label: "In conflict or waiting", value: first.counts.conflict + first.counts.waiting }],
    },
    {
      title: "Full text",
      total: second.counts.include,
      note: "included",
      rows: [...reasons(second), { label: "Maybe, in conflict or waiting", value: second.counts.conflict + second.counts.waiting + second.counts.maybe }, { label: "Of those, no full text yet", value: noText }],
    },
  ];
  const shown = screening.fullText ? steps : steps.slice(0, 3);
  return (
    <Zone label="Flow" aside={<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onExport("flow")}><Download />Get it as a flow diagram</Button>}>
      <div className={cn("grid grid-cols-1 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle @3xl/overview:divide-x @3xl/overview:divide-y-0", screening.fullText ? "@3xl/overview:grid-cols-4" : "@3xl/overview:grid-cols-3")}>
        {shown.map((step, i) => (
          <div key={step.title} className="relative space-y-3 p-4">
            <p className="text-xs text-muted-foreground">{step.title}</p>
            <p className="flex items-baseline gap-2"><span className="text-2xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={step.total} /></span>{step.note ? <span className="text-xs text-muted-foreground">{step.note}</span> : null}</p>
            <ul className="space-y-2">
              {step.rows.map((row) => (
                <li key={row.label} className="space-y-1">
                  <p className="flex items-baseline justify-between gap-3 text-xs"><span className="truncate text-muted-foreground">{row.label}</span><span className="shrink-0 font-medium tabular-nums">{row.value}</span></p>
                  <Meter value={row.value} max={Math.max(found, 1)} fill="bg-foreground/25" className="h-1" />
                </li>
              ))}
            </ul>
            {i < shown.length - 1 ? <ArrowRight aria-hidden className="absolute -end-2 top-4 z-10 hidden size-4 rounded-full bg-card text-muted-foreground @3xl/overview:block" /> : null}
          </div>
        ))}
      </div>
    </Zone>
  );
}
