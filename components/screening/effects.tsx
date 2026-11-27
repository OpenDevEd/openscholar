"use client";

// What a change to a screening would do, shown before the change is made: who reads what and what
// it costs, one line each with an icon for its kind, then which results move, as counts that open
// the papers behind them.

import { EASE } from "@/components/settings/model-map";
import { advisory, canConflict, modelsAdvise } from "@/lib/screening/rules";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { ArrowRight, ChevronDown, Coins, Lock, Mail, Minus, RefreshCw, RotateCcw, UserPlus, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { Chip } from "./parts";
import { cn } from "@/lib/utils";
import { baseTaken, bringsPdfs, readersOf, activeReviewers, defaultScoring, growing, modelsOf, type Criterion, type Result, type Reviewer, type Screening } from "./data";
import { papersHref } from "./links";
import { ResultChip, INLINE_LINK, ShutNote } from "./pieces";
import { paperCredits, readingOf, takesFiles } from "./store";
import { useWords, type Words } from "./words";

/** What a function here says things with: the shared words and this part's own messages. */
export type EffectsSay = { words: Words; t: ReturnType<typeof useTranslations<"screening.effects">> };

/** The part of the settings a line is about, by its anchor there. */
export type EffectSection = "name" | "papers" | "new-papers" | "criteria" | "reviewers" | "decided" | "goes-to";
/**
 * One thing a change does. `kind` gives it its icon: what it costs, who joins, votes that stop
 * counting, the schedule, an email that goes out, a screening that opens again, or results that
 * are held as they are. `credits` is shown in a chip at the line's end, `each` when it is paid for
 * every new paper.
 */
export type EffectLine = { /** What it does, said before the change is made, with when it takes hold. */ text: string; /** The same once the change is made, where it differs: the log of what was done leaves out when it takes hold. */ done?: string; kind?: "cost" | "join" | "leave" | "schedule" | "mail" | "reopen" | "held"; credits?: number; each?: boolean; section?: EffectSection };

/**
 * What the server counts for a change to a running screening before it is made (convex/screening/effects.ts): the
 * numbers every line here states. Nothing in a line is worked out in the browser.
 */
export type Preview = FunctionReturnType<typeof api.screening.effects.preview>;
/** The results a change moves: so many papers from one result to another, the first of them by name, and how many of them the person looking has yet to vote on. */
export type Move = Preview["moves"][number];
export const NO_PREVIEW: Preview = { total: 0, reopened: 0, joining: {}, leaving: {}, eachChanged: 0, models: {}, removed: 0, included: 0, moves: [], again: 0 };

const KIND_ICON: Record<NonNullable<EffectLine["kind"]>, AppIcon> = { cost: Coins, join: UserPlus, leave: Minus, schedule: RefreshCw, mail: Mail, reopen: RotateCcw, held: Lock };

/** A criterion in quotes, as a line names it: the name someone wrote, or else its question, cut at a word near 60 letters where it runs longer. */
export const criterionName = ({ words, t }: EffectsSay, criterion: Pick<Criterion, "text" | "short">) => {
  // One whose question is being written has no words to quote yet.
  if (!criterion.text.trim()) return t("criterionUnwritten");
  const text = words.criterionLabel(criterion).trim();
  return words.quoted(text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, "")}…` : text);
};


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
  /** The papers still open: someone who joins later gets a share of those, and none where every paper is settled. */
  openNow?: number;
};
export function effectItems(say: EffectsSay, before: Screening, after: Screening, counted: Preview, { me, wallet = Infinity, waiting = false, openNow }: EffectFor = {}): EffectLine[] {
  const { words, t } = say;
  const lines: EffectLine[] = [];
  // A reviewer as the reader is told of them: "you" for themselves.
  const named = (reviewer: Reviewer) => ({ you: String(reviewer.id === me), name: reviewer.name });
  const [hasModels, hasPeople] = [modelsOf(after).length > 0, readersOf(after).people.length > 0];
  const total = counted.total;
  const wasIds = new Set(activeReviewers(before).map((reviewer) => reviewer.id));
  const isIds = new Set(activeReviewers(after).map((reviewer) => reviewer.id));

  // A finished screening that gets papers to vote on is open again: said first, since it changes the screening's state.
  if (before.finishedAt && counted.reopened) lines.push({ text: t("reopens", { count: counted.reopened }), kind: "reopen" });

  const joining = activeReviewers(after).filter((reviewer) => !wasIds.has(reviewer.id));
  for (const reviewer of joining) {
    if (reviewer.kind === "model") {
      // It reads the papers still open. One that was settled before it came is not read again, and is not paid for.
      const reads = counted.joining[reviewer.id]?.reads ?? 0;
      // Whatever keeps this model from starting, in the order it would have to end: papers still arriving, a finished screening, paused models, credits for its next paper, another screening's turn.
      const starts = after.gathered !== undefined ? "gathered" : after.finishedAt ? "finished" : after.paused ? "paused" : paperCredits(reviewer.model!) > wallet ? "credits" : waiting ? "waiting" : "save";
      if (!reads) lines.push({ text: after.gathered !== undefined ? t("model.startsLater", { name: reviewer.name }) : t("model.nothingToRead", { name: reviewer.name }), section: "reviewers" });
      else {
        // As advice, or under "first vote decides", a model skips a paper its people settle first: the count is the most it reads.
        const read = { name: reviewer.name, all: String(reads === total), count: reads, upTo: String(modelsAdvise(after.rule, readersOf(after).each, modelsOf(after).length)) };
        lines.push({ text: t("model.reads", { ...read, when: starts }), done: t("model.reads", { ...read, when: "done" }), kind: "cost", credits: readingOf(after, reviewer.model!, reads), section: "reviewers" });
      }
    }
    // Someone who joins gets a share of the papers still open then. Where none is open now, the line says so before the invitation goes, not after.
    else if (reviewer.email) lines.push({ text: openNow === 0 ? t("person.invitedNoneOpen", { name: reviewer.name }) : t("person.invited", { name: reviewer.name }), kind: "mail", section: "reviewers" });
    else {
      const dealt = counted.joining[reviewer.id]?.dealt ?? 0;
      lines.push({ text: dealt ? t("person.dealt", { name: reviewer.name, count: dealt }) : t("person.joinsWithNone", { name: reviewer.name }), kind: "join", section: "reviewers" });
    }
  }
  if (joining.length && wasIds.size) {
    lines.push({ text: t("votesStay"), section: "reviewers" });
    const models = joining.filter((reviewer) => reviewer.kind === "model").length;
    if (models && !modelsAdvise(after.rule, readersOf(after).each, modelsOf(after).length) && canConflict(after.rule, readersOf(after).each, modelsOf(after).length)) lines.push({ text: after.rule.settle === "all" ? t("conflict.all") : t("conflict.most"), section: "reviewers" });
  }
  for (const reviewer of activeReviewers(before)) {
    if (isIds.has(reviewer.id)) continue;
    const gone = counted.leaving[reviewer.id] ?? { cast: reviewer.tally?.cast ?? 0, unvoted: 0, voted: 0, to: [], settled: 0, waiting: 0 };
    // Thrown out by this change, not by an earlier one: votes cast since an earlier one count.
    const thrown = after.reviewers.some((one) => one.id === reviewer.id && one.discarded && one.discarded !== reviewer.discarded);
    lines.push(!gone.cast ? { text: t("leaving.noVote", named(reviewer)), section: "reviewers" } : thrown ? { text: t("leaving.votesStop", { ...named(reviewer), count: gone.cast }), kind: "leave", section: "reviewers" } : { text: t("leaving.votesKept", { ...named(reviewer), count: gone.cast }), kind: "held", section: "reviewers" });
    if (reviewer.kind !== "person") continue;
    // The papers of theirs that someone else takes. Whoever takes one starts without a vote on it, whether or not they had voted.
    const going = gone.unvoted + gone.voted;
    if (going) {
      // A paper they voted on that goes to someone else keeps their vote, unless their votes are thrown out with them.
      const takers = words.listed(gone.to);
      lines.push({ text: gone.voted ? t("leaving.papersGo", { ...named(reviewer), count: going, takers, unvoted: gone.unvoted, voted: gone.voted, thrown: String(thrown) }) : t("leaving.unvotedGo", { ...named(reviewer), count: gone.unvoted, takers }), kind: "join", section: "reviewers" });
    }
    // The ones nobody takes over: settled where the votes that remain meet the rule, and still waiting where they don't.
    if (gone.settled) lines.push({ text: t("leaving.settled", { ...named(reviewer), count: gone.settled }), section: "reviewers" });
    if (gone.waiting) lines.push({ text: t("leaving.waiting", { ...named(reviewer), count: gone.waiting }), section: "reviewers" });
  }

  if (before.rule.resolver !== after.rule.resolver && after.rule.settle !== "one") {
    const to = { you: String(after.rule.resolver === me), name: words.nameOn(after, after.rule.resolver) };
    // Whoever settled them is leaving: the line says who takes over, and speaks to them where they are the one reading.
    const leaving = !isIds.has(before.rule.resolver) && wasIds.has(before.rule.resolver) ? before.rule.resolver : undefined;
    lines.push({ text: leaving ? (leaving === me ? t("settler.youLeave", to) : t("settler.leaves", { ...to, was: words.nameOn(before, leaving) })) : t("settler.changes", to), section: "decided" });
  }
  const people = (screening: Screening) => readersOf(screening).people.length;
  const eachOf = (screening: Screening) => readersOf(screening).each;
  if (before.rule.each !== after.rule.each && eachOf(before) !== eachOf(after) && people(before) === people(after)) {
    const more = eachOf(after) > eachOf(before);
    const changed = counted.eachChanged;
    const diff = Math.abs(eachOf(after) - eachOf(before));
    lines.push({ text: t("each.changes", { all: String(after.rule.each === "all"), each: eachOf(after), changed, more: String(more), diff }), kind: more ? "join" : undefined, section: "decided" });
  } else if (before.rule.each !== after.rule.each && people(before) === people(after) && (before.rule.each === "all" || after.rule.each === "all")) {
    // The same number today, and another rule for whoever joins later.
    lines.push({ text: after.rule.each === "all" ? t("each.stillAll", { each: eachOf(after) }) : t("each.stillShare", { each: eachOf(after) }), section: "decided" });
  }
  // Where votes are hidden until a reviewer votes, the models' votes as advice show before then, and as votes don't.
  const hiding = after.rule.blind === "after";
  if ((before.rule.models !== after.rule.models) && modelsOf(after).length && after.rule.settle !== "one") lines.push({ text: after.rule.models === "advice" ? t(hiding ? "modelVotes.adviceSeen" : "modelVotes.advice") : t(hiding ? "modelVotes.voteHidden" : "modelVotes.vote"), section: "decided" });
  if (before.rule.blind !== after.rule.blind) lines.push({ text: after.rule.blind === "always" ? t("blind.never") : advisory(after.rule) && modelsOf(after).length ? t("blind.untilVotedAdvice") : t("blind.untilVoted"), section: "decided" });
  // A paper's discussion is kept with its votes: a reviewer reads it when they may see them.
  if (before.rule.blind !== after.rule.blind && after.rule.blind === "after") lines.push({ text: t("blind.discussion"), section: "decided" });

  const had = new Set(before.criteria.map((criterion) => criterion.key));
  const fresh = after.criteria.filter((criterion) => !had.has(criterion.key));
  if (fresh.length) {
    const read = rereadCost(after, counted);
    if (read > 0) lines.push({ text: t("criteria.modelsAnswerNew", { count: fresh.length }), kind: "cost", credits: read, section: "criteria" });
    if (activeReviewers(after).some((reviewer) => reviewer.kind === "person")) lines.push({ text: t("criteria.votesStand", { count: fresh.length }), section: "criteria" });
  }
  // A model's vote is worked out from its answers under the criteria as they stand: a must-have taken off, or one that changes kind, can turn its votes, said once.
  if (hasModels && before.criteria.some((criterion) => { const now = after.criteria.find((one) => one.key === criterion.key); return now ? now.must !== criterion.must : criterion.must; })) lines.push({ text: t("criteria.modelsFollow"), section: "criteria" });
  for (const criterion of before.criteria) {
    const now = after.criteria.find((one) => one.key === criterion.key);
    // A line speaks of the models only on a screening that has some.
    if (!now) lines.push({ text: hasModels ? t("criteria.modelsStop", { name: criterionName(say, criterion) }) : t("criteria.noLongerAsked", { name: criterionName(say, criterion) }), kind: "leave", section: "criteria" });
    // A vote cast before a criterion became a must-have stands, and asks its reviewer for a new one.
    else if (now.must !== criterion.must) lines.push({ text: now.must ? t("criteria.becomesMust", { name: criterionName(say, now) }) : t("criteria.becomesNice", { name: criterionName(say, now) }), section: "criteria" });
    else if (now.text !== criterion.text) lines.push({ text: !now.text.trim() ? t("criteria.writeQuestion") : hasModels ? t("criteria.modelsReworded", { name: criterionName(say, now) }) : t("criteria.reviewersReworded", { name: criterionName(say, now) }), section: "criteria" });
    // Guidance changes how the question is read from here on. What was answered under the old guidance is left as it was.
    else if ((now.note ?? "") !== (criterion.note ?? "")) lines.push({ text: now.note?.trim() ? t("criteria.guidance", { models: String(hasModels), name: criterionName(say, now), fresh: String(Boolean(criterion.note)) }) : t("criteria.guidanceRemoved", { name: criterionName(say, now) }), section: "criteria" });
    // The words marked for whoever votes show in the abstract from the next paper they open.
    else if (now.terms.join("\n") !== criterion.terms.join("\n")) lines.push({ text: now.terms.length ? t("criteria.termsMarked", { name: criterionName(say, now) }) : t("criteria.termsRemoved", { name: criterionName(say, now) }), section: "criteria" });
  }
  if (scoringChanged(before, after)) lines.push({ text: t("criteria.scoring"), section: "criteria" });

  if (after.living && !before.living) {
    const sources = growing(after).length;
    const all = after.sources.length;
    // Which of its sources a check looks in: all of them, or so many of them, never "2 of its sources" where it has two.
    const checks = { which: sources === all ? "all" : "some", all, sources, every: after.living.every };
    lines.push(sources ? { text: t("living.checks", { ...checks, when: "save" }), done: t("living.checks", { ...checks, when: "done" }), kind: "schedule", section: "new-papers" } : { text: t("living.nothingToCheck"), kind: "schedule", section: "new-papers" });
    const each = modelsOf(after).reduce((sum, model) => sum + paperCredits(model.model!), 0);
    // People get a new paper as it comes in, whether or not a model has read it. An email goes to people, so it is promised only where there are some.
    lines.push(each ? { text: t("living.modelsRead", { people: String(hasPeople), pdfs: String(bringsPdfs(growing(after))) }), kind: "cost", credits: each, each: true, section: "new-papers" } : hasPeople ? { text: t("living.peopleGetEmail"), kind: "mail", section: "new-papers" } : { text: t("living.waitsForReviewer"), section: "new-papers" });
    if (before.finishedAt && !counted.reopened) lines.push({ text: t("living.reopens"), kind: "reopen", section: "new-papers" });
  } else if (before.living && !after.living) lines.push({ text: t("living.stops"), kind: "schedule", section: "new-papers" });
  else if (before.living && after.living && before.living.every !== after.living.every) lines.push({ text: t("living.every", { every: after.living.every }), kind: "schedule", section: "new-papers" });

  // What a source this adds brings is known once the screening has read it: until then, what its range promises is the most it can be.
  const promised = promisedBy(before, after);
  // Nobody has read them yet: each is priced as a paper with an abstract. Where one can come as its PDF, which a model is charged for by the page, no figure is a cap: the line gives none, and says when the cost is known.
  const reading = modelsOf(after).reduce((sum, model) => sum + paperCredits(model.model!) * promised, 0);
  const byThePage = pdfsPromised(before, after);
  if (promised) lines.push({ text: t("sources.promised", { count: promised, pdfs: String(Boolean(reading && byThePage)) }), ...(reading && !byThePage ? { kind: "cost" as const, credits: reading } : {}), section: "papers" });
  if (counted.removed) lines.push({ text: t("sources.removed", { count: counted.removed }), kind: "leave", section: "papers" });

  const [from, to] = [words.collectionName(before), words.collectionName(after)];
  // The screening's own collection given a new name keeps its papers: only a different collection is added to.
  const renamed = before.destination.kind === "new" && after.destination.kind === "new" && !after.destination.collection;
  if (from !== to && renamed) lines.push({ text: t("collection.renamed", { name: words.quoted(to ?? "") }), section: "goes-to" });
  else if (from !== to) {
    const included = counted.included;
    lines.push({ text: !to ? t("collection.stopsSaving", { kept: String(Boolean(from && included)), count: included, from: from ?? "" }) : t("collection.added", { count: included, to, was: String(Boolean(from)), from: from ?? "" }), section: "goes-to" });
  }
  if (before.destination.prune !== after.destination.prune) lines.push({ text: after.destination.prune ? t("collection.prune") : t("collection.keep"), section: "goes-to" });
  return lines;
}

/** A line's words before the change is made: what it does and when it takes hold. */
export const previewText = (line: EffectLine) => line.text;
/** The same lines as plain sentences, for a confirmation that asks before the change is made. */
export const effectLines = (say: EffectsSay, before: Screening, after: Screening, counted: Preview, opts?: EffectFor) => effectItems(say, before, after, counted, opts).map((line) => withCredits(say, line, previewText(line)));
const withCredits = ({ words, t }: EffectsSay, line: EffectLine, text: string) => (line.credits ? t("withCredits", { text, credits: words.creditsOf(line.credits), each: String(Boolean(line.each)) }) : text);

/** The sources a change brings more papers from, each with how many more its range promises: a source it adds, and one whose range it widens. */
const bringing = (before: Pick<Screening, "sources">, after: Pick<Screening, "sources">) =>
  after.sources.flatMap((source) => {
    const was = before.sources.find((one) => one.id === source.id);
    const more = was ? Math.max(0, baseTaken(source) - baseTaken(was)) : baseTaken(source);
    return more ? [{ source, more, widened: Boolean(was) }] : [];
  });
/** The papers those sources promise at most: which of them are new is known once the screening has read them. */
export const promisedBy = (before: Pick<Screening, "sources">, after: Pick<Screening, "sources">) => bringing(before, after).reduce((sum, one) => sum + one.more, 0);
/** Whether some of them can come as their PDF to a model that takes one: such a paper costs by the page, which nobody knows until the screening has read the source. */
export const pdfsPromised = (before: Pick<Screening, "sources">, after: Pick<Screening, "reviewers" | "sources">) => bringsPdfs(bringing(before, after).map((one) => one.source)) && modelsOf(after).some((one) => one.model && takesFiles(one.model));
/** Of those, the ones a wider range of a source it already has promises: a source's own count is of what it has read, so they are added to it. */
export const widenedBy = (before: Pick<Screening, "sources">, after: Pick<Screening, "sources">) => bringing(before, after).reduce((sum, one) => sum + (one.widened ? one.more : 0), 0);

/** What a change has every model read at once comes to: a criterion added to a running screening is answered on the open papers each has read. The preview and the save both charge this. */
export const rereadCost = (screening: Screening, counted: Preview) => modelsOf(screening).reduce((sum, model) => sum + readingOf(screening, model.model!, counted.models[model.id]?.atOnce ?? 0), 0);

/** The moves, in words, for a confirmation. */
export const movesText = ({ words, t }: EffectsSay, moves: Move[]) => moves.flatMap((move) => (move.count > move.hidden ? [t("moved", { count: move.count - move.hidden, from: words.result(move.from), to: words.result(move.to) })] : [])).join(". ");

const PAPERS_PAGE = 8;

/**
 * The lines of a change's effect, each on its own row, then each move of results with the papers it
 * covers. With `screening`, each paper opens on the Papers page. With `jump`, on the settings, a
 * line goes to the part of them it is about.
 */
export function EffectList({ lines, moves = [], none, screening, jump = false, done = false }: { lines: Array<string | EffectLine>; moves?: Move[]; none?: string; screening?: string; jump?: boolean; /** The change is made: the lines say what it did, without when it would take hold. */ done?: boolean }) {
  const t = useTranslations("screening.effects");
  const words = useWords();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const items = (lines.length ? lines : moves.length ? [] : [none ?? t("noChange")]).map((line): EffectLine => (typeof line === "string" ? { text: line } : line));
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
                <span className={cn("min-w-0 flex-1", line.kind === "cost" && "font-medium", line.kind === "reopen" && "font-medium ink-warning")}>{done ? (line.done ?? line.text) : previewText(line)}</span>
                {line.credits ? <Chip icon={Coins} className="-my-0.5 font-medium text-foreground">{t("creditsChip", { credits: words.credits(line.credits), each: String(Boolean(line.each)) })}</Chip> : null}
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
      {hidden ? <ShutNote by="vote">{t("hidden", { count: hidden, done: String(done) })}</ShutNote> : null}
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
                  <span className="w-7 shrink-0 text-end text-sm font-semibold tabular-nums">{words.num(shown_)}</span>
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
                    {pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={at} totalPages={pages} onPageChange={setPage} totalItems={named.length} itemsPerPage={PAPERS_PAGE} itemLabel={t("papersLabel")} /> : null}
                    {/* The first of them are named: the rest are on Papers, under the result they moved to. */}
                    {named.length < shown_ ? <p className="text-xs text-muted-foreground">{t("more", { count: shown_ - named.length })}</p> : null}
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
