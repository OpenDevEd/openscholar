/**
 * Screening answers for saved searches, one row per paper holding its answer to each
 * question, so changing an answer writes that paper's row and nothing else. Every change
 * also appends the paper's new answers to a history under the screening's next version,
 * which is how an old revision of a search shows the answers it had.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { SavedSearch } from "../../lib/research/records";

/** Who set an answer. `unrecorded` is for answers saved before this was recorded. */
export type AnswerSource = Doc<"screeningAnswers">["answers"][number]["setBy"];
type Responses = SavedSearch["screeningResponses"];
type PaperAnswers = Doc<"screeningAnswers">["answers"];
type Read = Pick<QueryCtx, "db">;
type Write = Pick<MutationCtx, "db">;

export function screeningFor(ctx: Read, searchId: Id<"searches">) {
  return ctx.db.query("screenings").withIndex("by_search", (q) => q.eq("searchId", searchId)).unique();
}

/** The screening a search's page and its Screen all jobs answer into. */
export async function ensureScreening(ctx: Write, userId: Id<"users">, searchId: Id<"searches">) {
  const existing = await screeningFor(ctx, searchId);
  if (existing) return existing;
  return (await ctx.db.get("screenings", await ctx.db.insert("screenings", { userId, searchId, version: 0, createdAt: Date.now() })))!;
}

/** Papers and their answers in the shape a saved search carries. */
function toResponses(papers: Iterable<{ paperId: string; answers: PaperAnswers }>): Responses {
  return Array.from(papers, ({ paperId, answers }) => ({ paperId, responses: answers.map(({ question, answer }) => ({ question, response: answer })) }));
}

const paperRows = (ctx: Read, screeningId: Id<"screenings">) =>
  ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId));

/**
 * A search's current answers.
 * ponytail: reads every screened paper, as the chunks did; a list page of searches holding
 * about 32,000 screened papers between them reaches a query's read limit. The results page
 * reading answers per search (#334) removes the ceiling.
 */
export async function currentAnswers(ctx: Read, screeningId: Id<"screenings">): Promise<Responses> {
  return toResponses(await paperRows(ctx, screeningId).collect());
}

/**
 * The answers at each of `versions`, rebuilt from one pass over the history, so a page of
 * revisions reads the history once.
 * ponytail: the pass reads every change up to the newest version asked for, so a screening
 * with about 30,000 answer changes over its life reaches a query's read limit. Undo (#342)
 * restores revisions and brings checkpoints or a paged restore.
 */
export async function answersAtVersions(ctx: Read, screeningId: Id<"screenings">, versions: number[]): Promise<Map<number, Responses>> {
  const result = new Map<number, Responses>();
  const pending = [...new Set(versions)].sort((a, b) => a - b);
  if (!pending.length) return result;
  const state = new Map<string, PaperAnswers>();
  const snapshot = () => toResponses([...state].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([paperId, answers]) => ({ paperId, answers })));
  const history = ctx.db.query("screeningAnswerHistory").withIndex("by_screening_and_version", (q) => q.eq("screeningId", screeningId).lte("version", pending.at(-1)!));
  for await (const row of history) {
    while (pending.length && row.version > pending[0]) result.set(pending.shift()!, snapshot());
    if (row.answers.length) state.set(row.paperId, row.answers);
    else state.delete(row.paperId);
  }
  for (const version of pending) result.set(version, snapshot());
  return result;
}

/**
 * Writes each paper's next answers where they changed, and appends them to the history
 * under the screening's next version. An empty list removes the paper. Returns the
 * screening's version afterwards.
 * ponytail: one transaction, so about 8,000 changed papers at once reach Convex's write limit.
 */
async function apply(ctx: Write, screening: Doc<"screenings">, updates: Array<{ paperId: string; answers: PaperAnswers }>, existing: Map<string, Doc<"screeningAnswers">>, at: number) {
  const version = screening.version + 1;
  let changed = false;
  for (const { paperId, answers } of updates) {
    const row = existing.get(paperId);
    if (JSON.stringify(row?.answers ?? []) === JSON.stringify(answers)) continue;
    if (!answers.length) await ctx.db.delete("screeningAnswers", row!._id);
    else if (row) await ctx.db.patch("screeningAnswers", row._id, { answers });
    else await ctx.db.insert("screeningAnswers", { screeningId: screening._id, paperId, answers });
    await ctx.db.insert("screeningAnswerHistory", { screeningId: screening._id, paperId, answers, version, at });
    changed = true;
  }
  if (!changed) return screening.version;
  await ctx.db.patch("screenings", screening._id, { version });
  return version;
}

async function paperRow(ctx: Read, screeningId: Id<"screenings">, paperId: string) {
  const row = await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", paperId)).unique();
  return new Map(row ? [[paperId, row]] : []);
}

/** Answers to set: the model's carry its confidence in each when it reported one. */
type NewAnswers = Array<Responses[number]["responses"][number] & { confidence?: number }>;

/**
 * Sets some of one paper's answers, reading only that paper's row. Setting the same answer
 * from a different source is a change: a person confirming the model's answer is recorded.
 * The model's own answer stays with each answer whoever changes it later.
 */
export async function setPaperAnswers(ctx: Write, userId: Id<"users">, searchId: Id<"searches">, paperId: string, responses: NewAnswers, setBy: AnswerSource, at: number) {
  await answerPaper(ctx, (await ensureScreening(ctx, userId, searchId))._id, paperId, responses, setBy, at);
}

/**
 * `setPaperAnswers` on a screening already in hand, such as a Screen all job's. It reads the
 * screening again, so several calls in one transaction each take the next version.
 */
export async function answerPaper(ctx: Write, screeningId: Id<"screenings">, paperId: string, responses: NewAnswers, setBy: AnswerSource, at: number) {
  const screening = (await ctx.db.get("screenings", screeningId))!;
  const existing = await paperRow(ctx, screening._id, paperId);
  const answers = [...(existing.get(paperId)?.answers ?? [])];
  for (const { question, response, confidence } of responses) {
    const index = answers.findIndex((value) => value.question === question);
    if (index >= 0 && answers[index].answer === response && answers[index].setBy === setBy) continue;
    const model = setBy === "model" ? { answer: response, ...(confidence === undefined ? {} : { confidence }), at } : answers[index]?.model;
    const value = { question, answer: response, setBy, updatedAt: at, ...(model ? { model } : {}) };
    if (index >= 0) answers[index] = value;
    else answers.push(value);
  }
  await apply(ctx, screening, [{ paperId, answers }], existing, at);
}

/** Removes one paper's answers, reading only that paper's row. */
export async function clearPaperAnswers(ctx: Write, searchId: Id<"searches">, paperId: string, at: number) {
  const screening = await screeningFor(ctx, searchId);
  if (!screening) return;
  await apply(ctx, screening, [{ paperId, answers: [] }], await paperRow(ctx, screening._id, paperId), at);
}

/**
 * Makes the answers exactly `next`: for edits that change many papers at once, for new
 * searches, and for the move out of chunks. An answer that keeps its value keeps who set it.
 * Returns the screening's version afterwards, or undefined when the search has no screening.
 */
export async function replaceAnswers(ctx: Write, userId: Id<"users">, searchId: Id<"searches">, next: Responses, setBy: AnswerSource, at: number) {
  const found = await screeningFor(ctx, searchId);
  if (!found && next.length === 0) return undefined;
  const screening = found ?? (await ensureScreening(ctx, userId, searchId));
  const existing = new Map(found ? (await paperRows(ctx, screening._id).collect()).map((row) => [row.paperId, row] as const) : []);
  const wanted = new Map(next.map((row) => [row.paperId, row.responses] as const));
  const updates = [...existing.keys()].filter((paperId) => !wanted.has(paperId)).map((paperId) => ({ paperId, answers: [] as PaperAnswers }));
  for (const [paperId, responses] of wanted) {
    const previous = existing.get(paperId)?.answers ?? [];
    updates.push({
      paperId,
      answers: responses.map(({ question, response }) => {
        const kept = previous.find((value) => value.question === question && value.answer === response);
        // A changed answer keeps the model's own answer to the question.
        const model = previous.find((value) => value.question === question)?.model;
        return kept ?? { question, answer: response, setBy, updatedAt: at, ...(model ? { model } : {}) };
      }),
    });
  }
  return apply(ctx, screening, updates, existing, at);
}
