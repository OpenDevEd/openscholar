"use client";

// What a change to a screening would do, shown before the change is made: who reads what and what
// it costs, one line each with an icon for its kind, then which results move, as counts that open
// the papers behind them.

import { EASE } from "@/components/settings/model-map";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ComponentProps } from "react";
import NextLink from "next/link";
import { ArrowRight, ChevronDown, Coins, Lock, Mail, Minus, RefreshCw, RotateCcw, UserPlus, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { Chip } from "@/components/screening/parts";
import { cn } from "@/lib/utils";
import { num, listed, plural, readersOf, firstName, EVERY_LABEL, NOW, RESULT_LABEL, activeReviewers, day, defaultScoring, dealtTo, effectOf, growing, modelsOf, personOf, projected, readNext, standing, type Criterion, type Move, type Reviewer, type Screening, includedIn, inQuotes, type Paper } from "./data";
import { COLLECTIONS, COMMUNITY_COLLECTIONS } from "./form-data";
import { papersHref } from "./links";
import { ResultChip, INLINE_LINK, ShutNote } from "./parts";
import { credits, paperCredits } from "./store";

/** The part of the settings a line is about, by its anchor there. */
export type EffectSection = "name" | "papers" | "new-papers" | "criteria" | "reviewers" | "decided" | "goes-to";
/**
 * One thing a change does. `kind` gives it its icon: what it costs, who joins, votes that stop
 * counting, the schedule, an email that goes out, a screening that opens again, or results that
 * are held as they are. `credits` is shown in a chip at the line's end, `each` when it is paid for
 * every new paper.
 */
export type EffectLine = { text: string; kind?: "cost" | "join" | "leave" | "schedule" | "mail" | "reopen" | "held"; credits?: number; each?: boolean; section?: EffectSection };

const KIND_ICON: Record<NonNullable<EffectLine["kind"]>, AppIcon> = { cost: Coins, join: UserPlus, leave: Minus, schedule: RefreshCw, mail: Mail, reopen: RotateCcw, held: Lock };

/** When a change takes hold, as the settings say it. Adding a reviewer from the Overview saves nothing else, and says it its own way. */
export const ON_SAVE = "as soon as this is saved";

/** A criterion in quotes, in its own words as the list shows them, cut at a word near 60 letters where it runs longer. */
export const criterionName = (criterion: Pick<Criterion, "text">) => {
  const text = criterion.text.trim();
  return inQuotes(text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, "")}…` : text);
};

/** The settings' own collection on a running screening is kind "new" with no `collection`; a second one started from the settings carries this mark until it is saved. */
export const ANOTHER_COLLECTION = "another";

/** Where a screening's included papers are saved, by name, or null where they stay in it. */
export function collectionName(screening: Screening) {
  const to = screening.destination;
  if (to.kind === "none") return null;
  if (to.kind === "new") return to.name || `${includedIn(screening.name)}${to.collection === ANOTHER_COLLECTION ? `, from ${day(NOW)}` : ""}`;
  return [...COLLECTIONS, ...COMMUNITY_COLLECTIONS].find((one) => one.id === to.collection)?.name ?? null;
}

/** A part of a page a link landed on: a tint that fades into its own surface over a second. Nothing under reduced motion. */
export function landOn(target: HTMLElement | null) {
  if (!target?.matches("section") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colour = `color-mix(in oklab, ${getComputedStyle(document.documentElement).getPropertyValue("--primary")} 10%, transparent)`;
  // One keyframe: it fades to the section's own colours.
  target.animate([{ backgroundColor: colour, boxShadow: `0 0 0 0.75rem ${colour}`, borderRadius: "0.75rem" }], { duration: 1200, delay: 300, easing: "ease-out", fill: "backwards" });
}

/**
 * A link to a part of the same page. It scrolls there and writes the part into the address in place,
 * so it adds no step to the history: Back still goes to the page before. `find` is what to bring
 * into view instead of the part itself, such as the control inside it to put the cursor on, which
 * goes to the middle of the window (`block`).
 */
export function JumpLink({ to, find, block = "start", onClick, ...link }: Omit<ComponentProps<"a">, "href"> & { to: string; find?: () => HTMLElement | null; block?: ScrollLogicalPosition }) {
  return (
    <a
      {...link}
      href={`#${to}`}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const part = document.getElementById(to);
        const target = find?.() ?? part;
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ block, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        if (target !== part) target.focus({ preventScroll: true });
        // The browser's history is the outside system: the address names the part, and the entry stays the one the page has.
        window.history.replaceState(window.history.state, "", `#${to}`);
        landOn(part);
      }}
    />
  );
}

/**
 * Whether someone changed the scoring itself. Points that come and go with a criterion are that
 * criterion's change, and stars nobody set follow the number of criteria by themselves.
 */
export function scoringChanged(before: Screening, after: Screening) {
  const followed = (screening: Screening) => JSON.stringify(screening.scoring.stars) === JSON.stringify(defaultScoring(screening.criteria).stars);
  const stars = JSON.stringify(before.scoring.stars) !== JSON.stringify(after.scoring.stars) && !(followed(before) && followed(after));
  return stars || before.criteria.some((criterion) => after.criteria.some((one) => one.key === criterion.key) && JSON.stringify(before.scoring.points[criterion.key]) !== JSON.stringify(after.scoring.points[criterion.key]));
}

/** Each thing a change does besides moving results, in the order a person checks them. */
export function effectItems(before: Screening, raw: Screening): EffectLine[] {
  const lines: EffectLine[] = [];
  // As a save leaves it: the papers that were settled keep their result, unless the change asks for them to be checked again.
  const after = projected(before, raw);
  const [was, now] = [standing(before), standing(after)];
  const total = now.papers.length;
  const effect = effectOf(before, raw);
  const wasIds = new Set(activeReviewers(before).map((reviewer) => reviewer.id));
  const isIds = new Set(activeReviewers(after).map((reviewer) => reviewer.id));

  // A finished screening that gets papers to vote on is open again: said first, since it changes the screening's state.
  const reopened = effect.moves.filter((move) => move.to === "conflict" || move.to === "waiting").reduce((sum, move) => sum + move.papers.length, 0) + effect.added;
  if (before.finishedAt && reopened) lines.push({ text: `It opens again: ${plural(reopened, "paper needs", "papers need")} votes`, kind: "reopen" });

  const joining = activeReviewers(after).filter((reviewer) => !wasIds.has(reviewer.id));
  for (const reviewer of joining) {
    if (reviewer.kind === "model") {
      // It reads the papers still open. One that was settled before it came is not read again, and is not paid for.
      const reads = readNext(after, reviewer, Infinity, () => Infinity).read;
      lines.push({ text: `${reviewer.name} reads ${reads === total ? `all ${plural(total, "paper", "papers")}` : `the ${plural(reads, "paper", "papers")} not settled yet`} ${after.paused ? "once the models resume" : ON_SAVE}`, kind: "cost", credits: reads * paperCredits(reviewer.model!), section: "reviewers" });
    }
    else if (reviewer.email) lines.push({ text: `${reviewer.name} gets an invitation by email, and papers once they join`, kind: "mail", section: "reviewers" });
    else {
      const dealt = now.papers.filter((paper) => !now.settled[paper.id]!.final && dealtTo(after, paper).some((one) => one.id === reviewer.id)).length;
      lines.push({ text: dealt ? `${reviewer.name} gets ${plural(dealt, "paper", "papers")} that still ${dealt === 1 ? "waits" : "wait"} for a vote, an even share of what is left, and is told by email` : `${reviewer.name} joins with no paper left to deal, and is told by email`, kind: "join", section: "reviewers" });
    }
  }
  if (joining.length && wasIds.size) {
    lines.push({ text: "Votes already cast stay as they are", section: "reviewers" });
    if (joining.some((reviewer) => reviewer.kind === "model") && after.rule.settle !== "one") lines.push({ text: after.rule.settle === "all" ? "A paper where it votes differently from the others becomes a conflict" : "Its vote counts with the others: a paper it tips into an even split becomes a conflict", section: "reviewers" });
  }
  for (const reviewer of activeReviewers(before)) {
    if (isIds.has(reviewer.id)) continue;
    const cast = was.papers.filter((paper) => was.votes[paper.id]!.some((one) => one.reviewer.id === reviewer.id && one.vote)).length;
    // Thrown out by this change, not by an earlier one: votes cast since an earlier one count.
    const thrown = after.reviewers.some((one) => one.id === reviewer.id && one.discarded && one.discarded !== reviewer.discarded);
    lines.push(!cast ? { text: `${reviewer.name} has cast no vote`, section: "reviewers" } : thrown ? { text: `${reviewer.name}'s ${plural(cast, "vote stays", "votes stay")} on record and ${cast === 1 ? "stops" : "stop"} counting`, kind: "leave", section: "reviewers" } : { text: `${reviewer.name}'s ${plural(cast, "vote keeps", "votes keep")} counting`, kind: "held", section: "reviewers" });
    if (reviewer.kind !== "person") continue;
    // Every paper dealt to them, and who is dealt it now in their place. Whoever takes one starts without a vote on it, whether or not they had voted.
    const theirs = was.papers.flatMap((paper) => {
      const had = was.votes[paper.id] ?? [];
      const own = had.find((one) => one.reviewer.id === reviewer.id);
      return own ? [{ id: paper.id, voted: Boolean(own.vote), to: (now.votes[paper.id] ?? []).filter((one) => one.reviewer.kind === "person" && !had.some((old) => old.reviewer.id === one.reviewer.id)).map((one) => one.reviewer.name) }] : [];
    });
    const going = theirs.filter((one) => one.to.length);
    const first = firstName(reviewer.name);
    if (going.length) {
      const [unvoted, voted] = [going.filter((one) => !one.voted).length, going.filter((one) => one.voted).length];
      const parts = [unvoted ? `${num(unvoted)} ${reviewer.name} had not voted on` : null, voted ? `${num(voted)} whose vote from ${first} stops counting` : null].filter(Boolean);
      const takers = listed([...new Set(going.flatMap((one) => one.to))]);
      lines.push({ text: voted ? `${plural(going.length, "paper goes", "papers go")} to ${takers}: ${parts.join(", and ")}` : `The ${plural(unvoted, "paper", "papers")} ${reviewer.name} had not voted on ${unvoted === 1 ? "goes" : "go"} to ${takers}`, kind: "join", section: "reviewers" });
    }
    // The ones nobody takes over: settled where the votes that remain meet the rule, and still waiting where they don't.
    const kept = theirs.filter((one) => !one.to.length && !one.voted);
    const settled = kept.filter((one) => now.settled[one.id]?.final).length;
    if (settled) lines.push({ text: `${plural(settled, "paper", "papers")} ${reviewer.name} had not voted on ${settled === 1 ? "is" : "are"} settled on the other votes`, section: "reviewers" });
    if (kept.length - settled) lines.push({ text: `${plural(kept.length - settled, "paper", "papers")} ${reviewer.name} had not voted on ${kept.length - settled === 1 ? "waits" : "wait"} for the others' votes`, section: "reviewers" });
  }

  if (before.rule.resolver !== after.rule.resolver && after.rule.settle !== "one") {
    const [from, to] = [personOf(before.rule.resolver)?.name, personOf(after.rule.resolver)?.name ?? "the person who started it"];
    lines.push({ text: from && !isIds.has(before.rule.resolver) ? `${from} settled conflicts: they go to ${to} from now on` : `Conflicts go to ${to} from now on`, section: "decided" });
  }
  const people = (screening: Screening) => readersOf(screening).people.length;
  const eachOf = (screening: Screening) => readersOf(screening).each;
  if (before.rule.each !== after.rule.each && eachOf(before) !== eachOf(after) && people(before) === people(after)) {
    const more = eachOf(after) > eachOf(before);
    const changed = now.papers.filter((paper) => was.votes[paper.id] && (now.votes[paper.id]?.length ?? 0) !== was.votes[paper.id]!.length).length;
    const diff = Math.abs(eachOf(after) - eachOf(before));
    lines.push({ text: `From now on each paper goes to ${after.rule.each === "all" ? `everyone on the screening, ${plural(eachOf(after), "person", "people")} today` : plural(eachOf(after), "person", "people")}${changed ? `. ${plural(changed, "paper", "papers")} still open ${more ? `${changed === 1 ? "gets" : "get"} ${diff === 1 ? "one more person" : `up to ${diff} more people`}` : `${changed === 1 ? "needs" : "need"} fewer votes`}` : ""}. Votes already cast stay as they are`, kind: more ? "join" : undefined, section: "decided" });
  } else if (before.rule.each !== after.rule.each && people(before) === people(after) && (before.rule.each === "all" || after.rule.each === "all")) {
    // The same number today, and another rule for whoever joins later.
    lines.push({ text: after.rule.each === "all" ? `Each paper still goes to ${plural(eachOf(after), "person", "people")} today. Anyone added later joins every paper that is still open` : `Each paper still goes to ${plural(eachOf(after), "person", "people")}. Anyone added later takes an even share of the open papers, not every one`, section: "decided" });
  }
  if (before.rule.blind !== after.rule.blind) lines.push({ text: after.rule.blind === "always" ? "Everyone sees every vote as it is cast" : "People see a paper's votes once they have cast theirs", section: "decided" });

  const had = new Set(before.criteria.map((criterion) => criterion.key));
  const fresh = after.criteria.filter((criterion) => !had.has(criterion.key));
  if (fresh.length) {
    const read = rereadCost(after);
    if (read > 0) lines.push({ text: `The models answer ${fresh.length === 1 ? "it" : "them"} on the papers they have read`, kind: "cost", credits: read, section: "criteria" });
    if (activeReviewers(after).some((reviewer) => reviewer.kind === "person")) lines.push({ text: `People's votes stand as they are: they were cast before ${fresh.length === 1 ? "this criterion" : "these criteria"}`, section: "criteria" });
  }
  for (const criterion of before.criteria) {
    const now = after.criteria.find((one) => one.key === criterion.key);
    if (!now) lines.push({ text: `The models stop answering ${criterionName(criterion)}. Votes people cast stay as they were cast`, kind: "leave", section: "criteria" });
    else if (now.must !== criterion.must) lines.push({ text: now.must ? `${criterionName(now)} becomes must-have: from now on a no on it points to Exclude. Votes people cast stay as they were cast` : `${criterionName(now)} becomes nice to have: from now on a no on it no longer points to Exclude. Votes people cast stay as they were cast`, section: "criteria" });
    else if (now.text !== criterion.text) lines.push({ text: `The models answer the reworded ${criterionName(now)} on papers they read from now on`, section: "criteria" });
    // Guidance changes how the question is read from here on. What was answered under the old guidance is left as it was.
    else if ((now.note ?? "") !== (criterion.note ?? "")) lines.push({ text: `Reviewers and models read ${criterionName(now)} with its ${criterion.note ? "new " : ""}guidance from now on. Answers already given stay`, section: "criteria" });
  }
  if (scoringChanged(before, after)) lines.push({ text: "Included papers' points and stars are worked out again", section: "criteria" });

  if (after.living && !before.living) {
    const sources = growing(after).length;
    lines.push({ text: sources ? `It checks ${sources === 1 ? "its source" : `${sources} of its sources`} for new papers ${ON_SAVE}, then ${EVERY_LABEL[after.living.every].toLowerCase()}` : "It has no source that gains papers, so there is nothing to check yet", kind: "schedule", section: "new-papers" });
    const each = modelsOf(after).reduce((sum, model) => sum + paperCredits(model.model!), 0);
    lines.push(each ? { text: "The models read each new paper, then it goes to its reviewers", kind: "cost", credits: each, each: true, section: "new-papers" } : { text: "Each new paper goes to its reviewers, who are told by email", kind: "mail", section: "new-papers" });
    if (before.finishedAt && !reopened) lines.push({ text: "It is open again, and stays open to new papers", kind: "reopen", section: "new-papers" });
  } else if (before.living && !after.living) lines.push({ text: "It stops checking for new papers. The ones it has stay", kind: "schedule", section: "new-papers" });
  else if (before.living && after.living && before.living.every !== after.living.every) lines.push({ text: `It checks for new papers ${EVERY_LABEL[after.living.every].toLowerCase()} from now on`, kind: "schedule", section: "new-papers" });

  if (effect.added) lines.push({ text: `${plural(effect.added, "paper joins", "papers join")} the queue`, section: "papers" });
  if (effect.removed) lines.push({ text: `${plural(effect.removed, "paper leaves", "papers leave")}, with ${effect.removed === 1 ? "its" : "their"} votes kept on record`, kind: "leave", section: "papers" });

  const [from, to] = [collectionName(before), collectionName(after)];
  // The screening's own collection given a new name keeps its papers: only a different collection is added to.
  const renamed = before.destination.kind === "new" && after.destination.kind === "new" && !after.destination.collection;
  if (from !== to && renamed) lines.push({ text: `Its collection is renamed ${inQuotes(to ?? "")}, with the papers in it`, section: "goes-to" });
  else if (from !== to) {
    const included = was.counts.include;
    lines.push({ text: !to ? `Included papers stop being saved to a collection${from && included ? `. The ${plural(included, "one", "ones")} in ${from} stay there` : ""}` : `The ${plural(included, "paper", "papers")} included so far ${included === 1 ? "is" : "are"} added to ${to}${from ? `. They stay in ${from}` : ""}`, section: "goes-to" });
  }
  if (before.destination.prune !== after.destination.prune) lines.push({ text: after.destination.prune ? "Excluded papers are taken out of the collection they came from" : "Excluded papers stay in the collection they came from", section: "goes-to" });
  return lines;
}

/** The same lines as plain sentences, for a confirmation and the screening's activity. */
export const effectLines = (before: Screening, after: Screening) => effectItems(before, after).map(lineText);
/** One line as a sentence, its credits said in words. */
export const lineText = (line: EffectLine) => (line.credits ? `${line.text}, for up to ${credits(line.credits)} credits${line.each ? " each" : ""}` : line.text);

/** How many papers a model answers a new criterion on: the ones it has read that are still open. A paper whose result is held, or that a person settled, is not read again. */
export const rereads = (screening: Screening, model: Reviewer) => {
  const state = standing(screening);
  return state.papers.filter((paper) => !screening.kept?.[paper.id] && !screening.resolved[paper.id] && state.votes[paper.id]!.some((one) => one.reviewer.id === model.id && one.vote)).length;
};
/** What that costs, for all its models. The preview and the save both charge this. */
export const rereadCost = (screening: Screening) => modelsOf(screening).reduce((sum, model) => sum + rereads(screening, model) * paperCredits(model.model!), 0);

/** The results a change moves: so many papers from one result to another. */
export const effectMoves = (before: Screening, after: Screening) => effectOf(before, after).moves;
/** The same, in words, for the screening's activity. */
export const movesText = (moves: Move[]) => moves.map((move) => `${move.papers.length} ${RESULT_LABEL[move.from].toLowerCase()} to ${RESULT_LABEL[move.to].toLowerCase()}`).join(", ");

const PAPERS_PAGE = 8;

/**
 * The lines of a change's effect, each on its own row, then each move of results with the papers it
 * covers. With `screening`, each paper opens on the Papers page. With `jump`, on the settings, a
 * line goes to the part of them it is about.
 */
export function EffectList({ lines, moves = [], none = "No paper's result changes", screening, jump = false, unseen }: { lines: Array<string | EffectLine>; moves?: Move[]; none?: string; screening?: string; jump?: boolean; /** The papers whose votes are hidden from the person looking: a move counts them and doesn't name them, since the name under a result would say how the others voted. */ unseen?: (paper: Paper) => boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const items = (lines.length ? lines : moves.length ? [] : [none]).map((line) => (typeof line === "string" ? { text: line } : line));
  return (
    <div className="space-y-2.5">
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((line) => {
            const Icon = line.kind ? KIND_ICON[line.kind] : ArrowRight;
            const body = (
              <>
                <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", line.kind === "leave" || line.kind === "reopen" ? "ink-warning" : line.kind === "cost" ? "text-foreground" : "text-muted-foreground")} />
                <span className={cn("min-w-0 flex-1", line.kind === "cost" && "font-medium", line.kind === "reopen" && "font-medium ink-warning")}>{line.text}</span>
                {line.credits ? <Chip icon={Coins} className="-my-0.5 font-medium text-foreground">{credits(line.credits)}{line.each ? " each" : ""}</Chip> : null}
              </>
            );
            return (
              <li key={line.text}>
                {line.section && jump ? (
                  <JumpLink to={line.section} className="-mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-0.5 text-sm outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50">{body}</JumpLink>
                ) : (
                  <span className="flex items-start gap-2 text-sm">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {moves.length ? (
        <ul className="@container divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-card">
          {moves.map((move) => {
            const key = `${move.from}>${move.to}`;
            const shown = open === key;
            const named = unseen ? move.papers.filter((paper) => !unseen(paper)) : move.papers;
            const kept = move.papers.length - named.length;
            const pages = Math.ceil(named.length / PAPERS_PAGE);
            const at = Math.min(page, pages);
            return (
              <li key={key}>
                {/* The count opens the papers it stands for, so a change is never taken on trust. */}
                <button type="button" aria-expanded={shown} onClick={() => { setOpen(shown ? null : key); setPage(1); }} className="flex w-full items-center gap-2 px-2.5 py-2 text-start transition-colors hover:bg-muted">
                  <span className="w-7 shrink-0 text-end text-sm font-semibold tabular-nums">{move.papers.length}</span>
                  {/* A move is one line, or where that doesn't fit, a column with the arrow pointing down: the arrow never ends a line with nothing after it. */}
                  <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 @max-[19rem]:flex-col @max-[19rem]:items-start @max-[19rem]:gap-0.5">
                    <ResultChip result={move.from} />
                    <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground @max-[19rem]:ms-2 @max-[19rem]:rotate-90" />
                    <ResultChip result={move.to} />
                  </span>
                  <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", shown && "rotate-180")} />
                </button>
                {/* The papers a change moves open under it by growing, and close by shrinking away to nothing. */}
                <AnimatePresence initial={false}>
                  {shown ? (
                    <motion.div key="papers" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                  <div className="space-y-1 border-t border-border-subtle bg-inset px-3 py-2">
                    <ul className="space-y-1">
                      {named.slice((at - 1) * PAPERS_PAGE, at * PAPERS_PAGE).map((paper) => (
                        <li key={paper.id} className="flex gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0 font-medium tabular-nums text-foreground">{paper.year}</span>
                          {screening ? (
                            <NextLink href={papersHref(screening, { paper: paper.id })} className={cn(INLINE_LINK, "min-w-0 font-normal text-inherit hover:text-foreground")}>{paper.title}</NextLink>
                          ) : (
                            <span className="min-w-0">{paper.title}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={at} totalPages={pages} onPageChange={setPage} totalItems={named.length} itemsPerPage={PAPERS_PAGE} itemLabel="papers" /> : null}
                    {kept ? <ShutNote by="vote">{named.length ? plural(kept, "more is", "more are") : plural(kept, "paper is", "papers are")} not named here: you have yet to vote on {kept === 1 ? "it" : "them"}.</ShutNote> : null}
                  </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
