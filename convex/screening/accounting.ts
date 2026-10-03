/**
 * What each screened paper adds to its job's kept counts, counted once whoever gets to it:
 * the bookkeeping worker as a paper settles, a person changing an answer, or the migration
 * for papers from before outcomes were kept. A paper records what it has added (`counted`),
 * so a later change adds only the difference.
 *
 * A paper is scored on its answers as they stand: the model's, except where a person or the
 * assistant answered, whose answer the page shows and the model never replaces.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { paperAnswers } from "../research/answers";
import { outcomeOf, scorePaper, tallied, type QuestionTally } from "./scoring";

export type PaperAnswer = { key: string; answer: boolean | null; changed: boolean; confidence?: number };
type Answers = Record<string, boolean | null>;
type Counted = NonNullable<Doc<"screeningResults">["counted"]>;

/**
 * A paper's answer to each of the job's questions as it stands now. Answers still on its
 * result haven't moved to the job's screening yet: they're the model's, and give way to a
 * person's or the assistant's there, as they will once moved.
 */
export async function answersNow(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, result: Doc<"screeningResults">): Promise<PaperAnswer[]> {
  const screening = job.screeningId ? await ctx.db.get("screenings", job.screeningId) : null;
  const given = screening ? await paperAnswers(ctx, screening, result.openalexId) : [];
  const held = result.answers;
  return job.questions.map(({ key, question }) => {
    const kept = given.find((value) => value.question === question);
    const changed = kept?.setBy === "person" || kept?.setBy === "assistant";
    const confidence = (held ? result.confidences?.[key] : undefined) ?? kept?.model?.confidence;
    const answer = held && key in held && !changed ? (held[key] ?? null) : (kept?.answer ?? null);
    return { key, answer, changed, ...(confidence === undefined ? {} : { confidence }) };
  });
}

export const byKey = (answers: PaperAnswer[]): Answers => Object.fromEntries(answers.map((value) => [value.key, value.answer]));

/** A paper's answers as they stand, by question key; none for a paper from before its job kept answers. */
export async function standing(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, result: Doc<"screeningResults">): Promise<Answers | undefined> {
  if (!result.answers && result.answersVersion === undefined) return undefined;
  return byKey(await answersNow(ctx, job, result));
}

/**
 * What a paper already has in its job's counts: what it recorded; nothing if it has yet to
 * reach the worker (`doneAt`); only whether it qualified, if the worker counted it before
 * outcomes were kept.
 */
function recorded(result: Doc<"screeningResults">): Partial<Counted> | null {
  if (result.counted) return result.counted;
  if (result.doneAt !== undefined) return null;
  return { qualified: result.qualified === true };
}

export type Delta = { qualified: number; unclear: number; before?: Answers; after?: Answers };

/**
 * Scores a completed paper on `answers` and says what its row becomes and what changes in
 * its job's counts. `answers` undefined (`standing`): the paper keeps its score, and is
 * included or excluded as it qualified.
 */
export function account(job: Doc<"screeningJobs">, result: Doc<"screeningResults">, answers: Answers | undefined) {
  const was = recorded(result);
  const scored = answers ? { ...scorePaper(answers, job.scoringConfig), outcome: outcomeOf(answers, job.scoringConfig) } : { qualified: result.qualified === true, outcome: result.qualified === true ? ("included" as const) : ("excluded" as const) };
  const counted: Counted = { qualified: scored.qualified, outcome: scored.outcome, ...(answers ? { answers } : {}) };
  const delta: Delta = {
    qualified: Number(counted.qualified) - Number(was?.qualified === true),
    unclear: Number(counted.outcome === "unclear") - Number(was?.outcome === "unclear"),
    ...(was?.answers ? { before: was.answers } : {}),
    ...(answers ? { after: answers } : {}),
  };
  return { patch: { ...scored, counted }, delta, becameIncluded: counted.qualified && was?.qualified !== true };
}

/** What a paper the model couldn't read records; it adds to no count but the failed papers'. */
export const FAILED = { outcome: "failed" as const, counted: { qualified: false, outcome: "failed" as const } };

/** The job's counts with `deltas` added; a job from before they were kept starts them at nothing. */
export function withDeltas(progress: Doc<"screeningJobProgress">, job: Doc<"screeningJobs">, deltas: Delta[]) {
  const keys = job.questions.map((question) => question.key);
  let tallies: QuestionTally[] = progress.tallies ?? [];
  let qualified = progress.qualified;
  let unclear = progress.unclear ?? 0;
  for (const delta of deltas) {
    qualified += delta.qualified;
    unclear += delta.unclear;
    if (delta.before) tallies = tallied(tallies, keys, delta.before, -1);
    if (delta.after) tallies = tallied(tallies, keys, delta.after, 1);
  }
  return { qualified: Math.max(0, qualified), unclear: Math.max(0, unclear), tallies };
}
