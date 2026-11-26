"use client";

// What a change to a screening would do, shown before the change is made: who reads what and what
// it costs, one line each with an icon for its kind, then which results move, as counts that open
// the papers behind them.

import { EASE } from "@/components/settings/model-map";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ComponentProps } from "react";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { ArrowRight, ChevronDown, Coins, Lock, Mail, Minus, RefreshCw, RotateCcw, UserPlus, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { Chip } from "./parts";
import { cn } from "@/lib/utils";
import { collectionName, num, listed, plural, readersOf, EVERY_LABEL, RESULT_LABEL, activeReviewers, defaultScoring, growing, modelsOf, nameOn, type Criterion, type Result, type Reviewer, type Screening, inQuotes } from "./data";
import { papersHref } from "./links";
import { ResultChip, INLINE_LINK, ShutNote } from "./pieces";
import { credits, paperCredits } from "./store";

/** The part of the settings a line is about, by its anchor there. */
export type EffectSection = "name" | "papers" | "new-papers" | "criteria" | "reviewers" | "decided" | "goes-to";
/**
 * One thing a change does. `kind` gives it its icon: what it costs, who joins, votes that stop
 * counting, the schedule, an email that goes out, a screening that opens again, or results that
 * are held as they are. `credits` is shown in a chip at the line's end, `each` when it is paid for
 * every new paper.
 */
export type EffectLine = { text: string; /** When it takes hold, said only before the change is made: the log of what was done leaves it out. */ when?: string; /** What follows that, in both. */ then?: string; kind?: "cost" | "join" | "leave" | "schedule" | "mail" | "reopen" | "held"; credits?: number; each?: boolean; section?: EffectSection };

/** The results a change moves: so many papers from one result to another, the first of them by name, and how many of them the person looking has yet to vote on. */
export type Move = { from: Result; to: Result; count: number; papers: Array<{ id: string; title: string; year?: number }>; hidden: number };

/**
 * What the server counts for a change to a running screening before it is made (convex/screening/effects.ts): the
 * numbers every line here states. Nothing in a line is worked out in the browser.
 */
export type Preview = {
  /** Its papers once the change is made, and how many of them the change opens again or brings. */
  total: number;
  reopened: number;
  /** Each reviewer the change puts on it: the papers a model reads, the open papers a person gets. */
  joining: Record<string, { reads?: number; dealt?: number }>;
  /** Each reviewer it takes off: their votes, the papers of theirs that go to someone else (voted on or not, and to whom), and the ones nobody takes that settle or go on waiting. */
  leaving: Record<string, { cast: number; unvoted: number; voted: number; to: string[]; settled: number; waiting: number }>;
  /** Open papers whose number of places changes. */
  eachChanged: number;
  /** Each model: the papers it has still to read once the change is made, and the ones the change has it read at once. */
  models: Record<string, { ahead: number; atOnce: number }>;
  /** Papers that join and leave with its sources. */
  added: number;
  removed: number;
  included: number;
  moves: Move[];
  /** Settled papers that would move if they were checked again. */
  again: number;
  /** The fewest and the most papers a person would have. */
  loads?: { least: number; most: number };
};
export const NO_PREVIEW: Preview = { total: 0, reopened: 0, joining: {}, leaving: {}, eachChanged: 0, models: {}, added: 0, removed: 0, included: 0, moves: [], again: 0 };

const KIND_ICON: Record<NonNullable<EffectLine["kind"]>, AppIcon> = { cost: Coins, join: UserPlus, leave: Minus, schedule: RefreshCw, mail: Mail, reopen: RotateCcw, held: Lock };

/** When a change takes hold, as the settings say it. Adding a reviewer from the Overview saves nothing else, and says it its own way. */
export const ON_SAVE = "as soon as this is saved";

/** A criterion in quotes, in its own words as the list shows them, cut at a word near 60 letters where it runs longer. */
export const criterionName = (criterion: Pick<Criterion, "text">) => {
  const text = criterion.text.trim();
  // One whose question is being written has no words to quote yet.
  if (!text) return "the criterion with no question yet";
  return inQuotes(text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, "")}…` : text);
};


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
export type EffectFor = {
  /** Who reads the lines: they are "you" in them. */
  me?: string;
  /** The credits its workspace has: a model that can't pay for its next paper starts once it can. */
  wallet?: number;
  /** Another screening's models are ahead of this one's. */
  waiting?: boolean;
  /** When the change takes hold, where it isn't a save of the settings. */
  onSave?: string;
};
export function effectItems(before: Screening, after: Screening, counted: Preview, { me, wallet = Infinity, waiting = false, onSave = ON_SAVE }: EffectFor = {}): EffectLine[] {
  const lines: EffectLine[] = [];
  // A reviewer as the reader is told of them: "you" for themselves.
  const whose = (reviewer: Reviewer) => (reviewer.id === me ? "Your" : `${reviewer.name}'s`);
  const named = (reviewer: Reviewer) => (reviewer.id === me ? "you" : reviewer.name);
  const [hasModels, hasPeople] = [modelsOf(after).length > 0, readersOf(after).people.length > 0];
  const total = counted.total;
  const wasIds = new Set(activeReviewers(before).map((reviewer) => reviewer.id));
  const isIds = new Set(activeReviewers(after).map((reviewer) => reviewer.id));

  // A finished screening that gets papers to vote on is open again: said first, since it changes the screening's state.
  if (before.finishedAt && counted.reopened) lines.push({ text: `The screening opens again for ${plural(counted.reopened, "paper", "papers")}`, kind: "reopen" });

  const joining = activeReviewers(after).filter((reviewer) => !wasIds.has(reviewer.id));
  for (const reviewer of joining) {
    if (reviewer.kind === "model") {
      // It reads the papers still open. One that was settled before it came is not read again, and is not paid for.
      const reads = counted.joining[reviewer.id]?.reads ?? 0;
      // Whatever keeps this model from starting, in the order it would have to end: papers still arriving, a finished screening, paused models, credits for its next paper, another screening's turn.
      const starts = after.gathered !== undefined ? "once all its papers arrive" : after.finishedAt ? "once the screening is reopened" : after.paused ? "once the models resume" : paperCredits(reviewer.model!) > wallet ? "once the workspace has enough credits for its next paper" : waiting ? "when its models' turn comes" : onSave;
      if (!reads) lines.push({ text: after.gathered !== undefined ? `${reviewer.name} starts once the papers arrive` : `${reviewer.name} has no papers left to read`, section: "reviewers" });
      else lines.push({ text: `${reviewer.name} reads ${reads === total ? `all ${plural(total, "paper", "papers")}` : `the ${plural(reads, "paper", "papers")} not settled yet`}`, when: starts, kind: "cost", credits: reads * paperCredits(reviewer.model!), section: "reviewers" });
    }
    else if (reviewer.email) lines.push({ text: `${reviewer.name} gets an invitation by email, and papers once they join`, kind: "mail", section: "reviewers" });
    else {
      const dealt = counted.joining[reviewer.id]?.dealt ?? 0;
      lines.push({ text: dealt ? `${reviewer.name} gets ${plural(dealt, "open paper", "open papers")}, an even share, and an email saying so` : `${reviewer.name} joins and gets an email saying so. Every open paper already has its reviewers, so none goes to them yet`, kind: "join", section: "reviewers" });
    }
  }
  if (joining.length && wasIds.size) {
    lines.push({ text: "Votes already cast stay as they are", section: "reviewers" });
    if (joining.some((reviewer) => reviewer.kind === "model") && after.rule.settle !== "one") lines.push({ text: after.rule.settle === "all" ? "Once every vote on a paper is in, votes that differ put it in conflict" : "Once every vote on a paper is in, an even split puts it in conflict", section: "reviewers" });
  }
  for (const reviewer of activeReviewers(before)) {
    if (isIds.has(reviewer.id)) continue;
    const gone = counted.leaving[reviewer.id] ?? { cast: reviewer.tally?.cast ?? 0, unvoted: 0, voted: 0, to: [], settled: 0, waiting: 0 };
    // Thrown out by this change, not by an earlier one: votes cast since an earlier one count.
    const thrown = after.reviewers.some((one) => one.id === reviewer.id && one.discarded && one.discarded !== reviewer.discarded);
    lines.push(!gone.cast ? { text: reviewer.id === me ? "You have cast no vote" : `${reviewer.name} has cast no vote`, section: "reviewers" } : thrown ? { text: `${whose(reviewer)} ${plural(gone.cast, "vote stays", "votes stay")} on record and ${gone.cast === 1 ? "stops" : "stop"} counting`, kind: "leave", section: "reviewers" } : { text: `${whose(reviewer)} ${plural(gone.cast, "vote keeps", "votes keep")} counting`, kind: "held", section: "reviewers" });
    if (reviewer.kind !== "person") continue;
    // The papers of theirs that someone else takes. Whoever takes one starts without a vote on it, whether or not they had voted.
    const going = gone.unvoted + gone.voted;
    if (going) {
      // A paper they voted on that goes to someone else keeps their vote, unless their votes are thrown out with them.
      const parts = [gone.unvoted ? `${num(gone.unvoted)} ${named(reviewer)} had not voted on` : null, gone.voted ? `${num(gone.voted)} ${named(reviewer)} voted on, where that vote ${thrown ? "stops counting" : "keeps counting"}` : null].filter(Boolean);
      const takers = listed(gone.to);
      lines.push({ text: gone.voted ? `${plural(going, "paper goes", "papers go")} to ${takers}: ${parts.join(", and ")}` : `The ${plural(gone.unvoted, "paper", "papers")} ${named(reviewer)} had not voted on ${gone.unvoted === 1 ? "goes" : "go"} to ${takers}`, kind: "join", section: "reviewers" });
    }
    // The ones nobody takes over: settled where the votes that remain meet the rule, and still waiting where they don't.
    if (gone.settled) lines.push({ text: `${plural(gone.settled, "paper", "papers")} ${named(reviewer)} had not voted on ${gone.settled === 1 ? "is" : "are"} settled on the other votes`, section: "reviewers" });
    if (gone.waiting) lines.push({ text: `${plural(gone.waiting, "paper", "papers")} ${named(reviewer)} had not voted on ${gone.waiting === 1 ? "waits" : "wait"} for the others' votes`, section: "reviewers" });
  }

  if (before.rule.resolver !== after.rule.resolver && after.rule.settle !== "one") {
    const to = after.rule.resolver === me ? "you" : nameOn(after, after.rule.resolver);
    // Whoever settled them is leaving: the line says who takes over, and speaks to them where they are the one reading.
    const leaving = !isIds.has(before.rule.resolver) && wasIds.has(before.rule.resolver) ? before.rule.resolver : undefined;
    lines.push({ text: leaving ? (leaving === me ? `Conflicts go to ${to} once you leave` : `${nameOn(before, leaving)} settled conflicts. They go to ${to} from now on`) : `Conflicts go to ${to} from now on`, section: "decided" });
  }
  const people = (screening: Screening) => readersOf(screening).people.length;
  const eachOf = (screening: Screening) => readersOf(screening).each;
  if (before.rule.each !== after.rule.each && eachOf(before) !== eachOf(after) && people(before) === people(after)) {
    const more = eachOf(after) > eachOf(before);
    const changed = counted.eachChanged;
    const diff = Math.abs(eachOf(after) - eachOf(before));
    lines.push({ text: `From now on each paper goes to ${after.rule.each === "all" ? `everyone on the screening, ${plural(eachOf(after), "person", "people")} today` : plural(eachOf(after), "person", "people")}${changed ? `. ${plural(changed, "paper", "papers")} still open ${more ? `${changed === 1 ? "gets" : "get"} ${diff === 1 ? "one more person" : `up to ${diff} more people`}` : `${changed === 1 ? "needs" : "need"} fewer votes`}` : ""}. Votes already cast stay as they are`, kind: more ? "join" : undefined, section: "decided" });
  } else if (before.rule.each !== after.rule.each && people(before) === people(after) && (before.rule.each === "all" || after.rule.each === "all")) {
    // The same number today, and another rule for whoever joins later.
    lines.push({ text: after.rule.each === "all" ? `Each paper still goes to ${plural(eachOf(after), "person", "people")} today. Anyone added later joins every paper that is still open` : `Each paper still goes to ${plural(eachOf(after), "person", "people")}. Anyone added later takes an even share of the open papers, not every one`, section: "decided" });
  }
  if (before.rule.blind !== after.rule.blind) lines.push({ text: after.rule.blind === "always" ? "Everyone sees every vote as it is cast" : "A reviewer sees the other votes on a paper once they vote on it or it is settled", section: "decided" });

  const had = new Set(before.criteria.map((criterion) => criterion.key));
  const fresh = after.criteria.filter((criterion) => !had.has(criterion.key));
  if (fresh.length) {
    const read = rereadCost(after, counted);
    if (read > 0) lines.push({ text: `The models answer the new ${fresh.length === 1 ? "criterion" : "criteria"} on the open papers they have read`, kind: "cost", credits: read, section: "criteria" });
    if (activeReviewers(after).some((reviewer) => reviewer.kind === "person")) lines.push({ text: `People's votes stand as they are: they were cast before ${fresh.length === 1 ? "this criterion" : "these criteria"}`, section: "criteria" });
  }
  for (const criterion of before.criteria) {
    const now = after.criteria.find((one) => one.key === criterion.key);
    // A line speaks of the models only on a screening that has some.
    if (!now) lines.push({ text: `${hasModels ? `The models stop answering ${criterionName(criterion)}` : `${criterionName(criterion)} is no longer asked`}. Votes already cast stay as they were cast`, kind: "leave", section: "criteria" });
    // A vote cast before a criterion became a must-have stands, and asks its reviewer for a new one.
    else if (now.must !== criterion.must) lines.push({ text: now.must ? `${criterionName(now)} becomes a must-have: from now on a no on it points to Exclude. People's votes on the papers still open stay, and are marked for a new vote` : `${criterionName(now)} becomes nice to have: from now on a no on it no longer points to Exclude. Votes already cast stay as they were cast`, section: "criteria" });
    else if (now.text !== criterion.text) lines.push({ text: !now.text.trim() ? "Write the criterion's question before saving" : hasModels ? `The models answer the reworded ${criterionName(now)} on papers they read from now on` : `Reviewers answer the reworded ${criterionName(now)} from now on. Votes already cast stay as they were cast`, section: "criteria" });
    // Guidance changes how the question is read from here on. What was answered under the old guidance is left as it was.
    else if ((now.note ?? "") !== (criterion.note ?? "")) lines.push({ text: now.note?.trim() ? `${hasModels ? "Reviewers and models read" : "Reviewers read"} ${criterionName(now)} with its ${criterion.note ? "new " : ""}guidance from now on. Answers already given stay` : `Guidance is removed from ${criterionName(now)}. Answers already given stay`, section: "criteria" });
    // The words marked for whoever votes show in the abstract from the next paper they open.
    else if (now.terms.join("\n") !== criterion.terms.join("\n")) lines.push({ text: now.terms.length ? `Reviewers see the words marked for ${criterionName(now)} in each abstract from now on` : `No words are marked for ${criterionName(now)} any more`, section: "criteria" });
  }
  if (scoringChanged(before, after)) lines.push({ text: "Included papers' points and stars are worked out again", section: "criteria" });

  if (after.living && !before.living) {
    const sources = growing(after).length;
    const all = after.sources.length;
    // Which of its sources a check looks in: all of them, or so many of them, never "2 of its sources" where it has two.
    lines.push(sources ? { text: `The screening checks ${sources === all ? (all === 1 ? "its source" : `its ${all} sources`) : `${sources} of its ${all} sources`} for new papers`, when: `${onSave}, then`, then: EVERY_LABEL[after.living.every].toLowerCase(), kind: "schedule", section: "new-papers" } : { text: "The screening has no source that gains papers, so there is nothing to check yet", kind: "schedule", section: "new-papers" });
    const each = modelsOf(after).reduce((sum, model) => sum + paperCredits(model.model!), 0);
    // People get a new paper as it comes in, whether or not a model has read it. An email goes to people, so it is promised only where there are some.
    lines.push(each ? { text: `Each new paper goes to its reviewers${hasPeople ? ", and the people among them get an email" : ""}. The models read it when they can`, kind: "cost", credits: each, each: true, section: "new-papers" } : hasPeople ? { text: "Each new paper goes to its reviewers, who get an email", kind: "mail", section: "new-papers" } : { text: "Each new paper joins the screening, where it waits for a reviewer", section: "new-papers" });
    if (before.finishedAt && !counted.reopened) lines.push({ text: "The screening is open again, and stays open to new papers", kind: "reopen", section: "new-papers" });
  } else if (before.living && !after.living) lines.push({ text: "The screening stops checking for new papers. The ones it has stay", kind: "schedule", section: "new-papers" });
  else if (before.living && after.living && before.living.every !== after.living.every) lines.push({ text: `The screening checks for new papers ${EVERY_LABEL[after.living.every].toLowerCase()} from now on`, kind: "schedule", section: "new-papers" });

  if (counted.added) lines.push({ text: `About ${plural(counted.added, "paper joins", "papers join")} the screening, fewer where another source already has them`, section: "papers" });
  if (counted.removed) lines.push({ text: `${plural(counted.removed, "paper leaves", "papers leave")} the screening, with ${counted.removed === 1 ? "its" : "their"} votes kept on record`, kind: "leave", section: "papers" });

  const [from, to] = [collectionName(before), collectionName(after)];
  // The screening's own collection given a new name keeps its papers: only a different collection is added to.
  const renamed = before.destination.kind === "new" && after.destination.kind === "new" && !after.destination.collection;
  if (from !== to && renamed) lines.push({ text: `Its collection is renamed ${inQuotes(to ?? "")}, with the papers in it`, section: "goes-to" });
  else if (from !== to) {
    const included = counted.included;
    lines.push({ text: !to ? `Included papers stop being saved to a collection${from && included ? `. The ${plural(included, "one", "ones")} in ${from} stay there` : ""}` : `The ${plural(included, "paper", "papers")} included so far ${included === 1 ? "is" : "are"} added to ${to}${from ? `. They stay in ${from}` : ""}`, section: "goes-to" });
  }
  if (before.destination.prune !== after.destination.prune) lines.push({ text: after.destination.prune ? "Excluded papers are taken out of the collection they came from" : "Excluded papers stay in the collection they came from", section: "goes-to" });
  return lines;
}

/** A line's words before the change is made: what it does and when it takes hold. */
export const previewText = (line: EffectLine) => [line.text, line.when, line.then].filter(Boolean).join(" ");
/** The same lines as plain sentences, for a confirmation that asks before the change is made. */
export const effectLines = (before: Screening, after: Screening, counted: Preview, opts?: EffectFor) => effectItems(before, after, counted, opts).map((line) => withCredits(line, previewText(line)));
const withCredits = (line: EffectLine, text: string) => (line.credits ? `${text}, for up to ${credits(line.credits)} credits${line.each ? " each" : ""}` : text);
/** One line as the activity log keeps it, once the change is made: what it did, without "as soon as this is saved". */
export const lineText = (line: EffectLine) => withCredits(line, [line.text, line.then].filter(Boolean).join(" "));

/** What a change has every model read at once comes to: a criterion added to a running screening is answered on the open papers each has read. The preview and the save both charge this. */
export const rereadCost = (screening: Screening, counted: Preview) => modelsOf(screening).reduce((sum, model) => sum + (counted.models[model.id]?.atOnce ?? 0) * paperCredits(model.model!), 0);

/** The moves, in words, for a confirmation. */
export const movesText = (moves: Move[]) => moves.map((move) => `${plural(move.count, "paper", "papers")} moved from ${RESULT_LABEL[move.from]} to ${RESULT_LABEL[move.to]}`).join(". ");

const PAPERS_PAGE = 8;

/**
 * The lines of a change's effect, each on its own row, then each move of results with the papers it
 * covers. With `screening`, each paper opens on the Papers page. With `jump`, on the settings, a
 * line goes to the part of them it is about.
 */
export function EffectList({ lines, moves = [], none = "No paper's result changes", screening, jump = false, done = false }: { lines: Array<string | EffectLine>; moves?: Move[]; none?: string; screening?: string; jump?: boolean; /** The change is made: the lines say what it did, without when it would take hold. */ done?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const items = (lines.length ? lines : moves.length ? [] : [none]).map((line) => (typeof line === "string" ? { text: line } : line));
  // The papers whose votes are hidden from the person looking: a move counts them and doesn't name them, since the name under a result would say how the others voted.
  const hidden = moves.reduce((sum, move) => sum + move.hidden, 0);
  return (
    <div className="space-y-2.5">
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((line) => {
            const Icon = line.kind ? KIND_ICON[line.kind] : ArrowRight;
            const body = (
              <>
                <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", line.kind === "leave" || line.kind === "reopen" ? "ink-warning" : line.kind === "cost" ? "text-foreground" : "text-muted-foreground")} />
                <span className={cn("min-w-0 flex-1", line.kind === "cost" && "font-medium", line.kind === "reopen" && "font-medium ink-warning")}>{done ? [line.text, line.then].filter(Boolean).join(" ") : previewText(line)}</span>
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
      {/* The papers whose votes are hidden from the person are counted together and under no result: which way each goes would say how the others voted on it. */}
      {hidden ? <ShutNote by="vote">{plural(hidden, "paper you have yet to vote on changes", "papers you have yet to vote on change")} result too. {done ? "Their votes stay hidden while they wait for yours." : "Which way shows once the change is made."}</ShutNote> : null}
      {moves.length ? (
        <ul className="@container divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-card">
          {moves.map((move) => {
            const key = `${move.from}>${move.to}`;
            const shown = open === key;
            const named = move.papers;
            const shown_ = move.count - move.hidden;
            // A move made only of papers whose votes are hidden isn't drawn: its count alone would say how one of them was voted on.
            if (!shown_) return null;
            const pages = Math.ceil(named.length / PAPERS_PAGE);
            const at = Math.min(page, pages);
            return (
              <li key={key}>
                {/* The count opens the papers it stands for, so a change is never taken on trust. */}
                <button type="button" aria-expanded={shown} onClick={() => { setOpen(shown ? null : key); setPage(1); }} className="flex w-full items-center gap-2 px-2.5 py-2 text-start transition-colors hover:bg-muted">
                  <span className="w-7 shrink-0 text-end text-sm font-semibold tabular-nums">{num(shown_)}</span>
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
                    {/* The first of them are named: the rest are on Papers, under the result they moved to. */}
                    {named.length < shown_ ? <p className="text-xs text-muted-foreground">{num(shown_ - named.length)} more</p> : null}
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
