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

/** A paper's answers as they were at `version`: its newest history up to it. */
function paperAt(ctx: Read, screeningId: Id<"screenings">, paperId: string, version: number) {
  return ctx.db.query("screeningAnswerHistory")
    .withIndex("by_screening_and_paper_and_version", (q) => q.eq("screeningId", screeningId).eq("paperId", paperId).lte("version", version))
    .order("desc").first();
}

/**
 * These papers' answers, now or as they were at `version`: one indexed read a paper, so a
 * page reads the answers of the papers it shows and no others. A paper with none is left out.
 */
export async function answersAmong(ctx: Read, screeningId: Id<"screenings">, paperIds: string[], version?: number): Promise<Responses> {
  const rows = await Promise.all(paperIds.map((paperId) =>
    version === undefined
      ? ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", paperId)).unique()
      : paperAt(ctx, screeningId, paperId, version)));
  return toResponses(rows.flatMap((row) => (row && row.answers.length ? [row] : [])));
}

/**
 * Writes each paper's next answers where they changed, and appends them to the history
 * under the screening's next version. An empty list removes the paper. Returns the
 * screening's version afterwards. Callers pass a bounded number of papers: one, a new search's, or a sweep's step.
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

/**
 * The model's own answer to keep when someone else changes `current`: its `model` part, or
 * for a model answer saved before that part existed, the answer itself.
 */
function modelAnswer(current: PaperAnswers[number] | undefined) {
  if (current?.model) return current.model;
  return current?.setBy === "model" ? { answer: current.answer, at: current.updatedAt } : undefined;
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
    const current = index >= 0 ? answers[index] : undefined;
    let value: PaperAnswers[number];
    if (setBy === "model") {
      const model = { answer: response, ...(confidence === undefined ? {} : { confidence }), at };
      if (current?.model?.answer === response && current.model.confidence === confidence) continue;
      // The model never replaces an answer a person or the assistant gave, even one given
      // before its own answer arrives; it's kept as the model's. Answers from before who set
      // them was recorded are mostly the model's, so a new run replaces them.
      value = current && (current.setBy === "person" || current.setBy === "assistant")
        ? { ...current, model }
        : { question, answer: response, setBy, updatedAt: at, model };
    } else {
      if (current?.answer === response && current.setBy === setBy) continue;
      const model = modelAnswer(current);
      value = { question, answer: response, setBy, updatedAt: at, ...(model ? { model } : {}) };
    }
    if (index >= 0) answers[index] = value;
    else answers.push(value);
  }
  return apply(ctx, screening, [{ paperId, answers }], existing, at);
}

/** Removes one paper's answers, reading only that paper's row. */
export async function clearPaperAnswers(ctx: Write, searchId: Id<"searches">, paperId: string, at: number) {
  const screening = await screeningFor(ctx, searchId);
  if (!screening) return;
  await apply(ctx, screening, [{ paperId, answers: [] }], await paperRow(ctx, screening._id, paperId), at);
}

/**
 * Gives a search that has just been made the answers it came with, from an import or the
 * assistant. It has no answers yet, so nothing is read.
 */
export async function seedAnswers(ctx: Write, userId: Id<"users">, searchId: Id<"searches">, answers: Responses, setBy: AnswerSource, at: number) {
  if (answers.length === 0) return;
  const screening = await ensureScreening(ctx, userId, searchId);
  const updates = answers.map(({ paperId, responses }) => ({ paperId, answers: responses.map(({ question, response }) => ({ question, answer: response, setBy, updatedAt: at })) }));
  await apply(ctx, screening, updates, new Map(), at);
}

/** Papers one step of a sweep reads, and the bytes of them; each also reads its history once. */
const SWEEP_BATCH = 200;
const SWEEP_BYTES = 4 * 1024 * 1024;

/**
 * One step of removing answers from every paper of a screening: all of them, or those to
 * `question`. It takes the answers that stood at `version`, the screening's when the removal
 * was asked for, and leaves any given since, which a paper's history up to `version` tells
 * apart. Returns where the next step starts, or null when every paper has been looked at.
 */
export async function removeAnswersStep(ctx: Write, screeningId: Id<"screenings">, question: string | undefined, version: number, cursor: string | null, at: number) {
  const screening = (await ctx.db.get("screenings", screeningId))!;
  const page = await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId))
    .paginate({ cursor, numItems: SWEEP_BATCH, maximumBytesRead: SWEEP_BYTES });
  const updates = await Promise.all(page.page.map(async (row) => {
    const stood = new Set(((await paperAt(ctx, screeningId, row.paperId, version))?.answers ?? []).map((answer) => JSON.stringify(answer)));
    const goes = (answer: PaperAnswers[number]) => (question === undefined || answer.question === question) && stood.has(JSON.stringify(answer));
    return { paperId: row.paperId, answers: row.answers.filter((answer) => !goes(answer)) };
  }));
  await apply(ctx, screening, updates, new Map(page.page.map((row) => [row.paperId, row] as const)), at);
  return page.isDone ? null : page.continueCursor;
}
