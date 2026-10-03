/**
 * Screening answers for saved searches, one row per paper holding its answer to each
 * question, so changing an answer writes that paper's row and nothing else. Every change
 * also appends the paper's new answers to a history under the screening's next version,
 * which is how an old revision of a search shows the answers it had.
 *
 * An edit that takes answers from every paper (a question removed, all answers cleared) is
 * recorded on the screening as a removal at its next version. From then on every read and
 * write treats those answers as gone: a row last written before a removal owes it. The rows
 * themselves are cleaned a page at a time (`sweepAnswers`), each recording the removal in its
 * paper's history at the removal's version, and the removal is forgotten once every row has
 * taken it.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { SavedSearch } from "../../lib/research/records";
import { MAX_PENDING_REMOVALS } from "../lib/listCaps";

/** Who set an answer. `unrecorded` is for answers saved before this was recorded. */
export type AnswerSource = Doc<"screeningAnswers">["answers"][number]["setBy"];
type Responses = SavedSearch["screeningResponses"];
type PaperAnswers = Doc<"screeningAnswers">["answers"];
type Removal = NonNullable<Doc<"screenings">["removals"]>[number];
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

/** The removals answers last written at `version` owe: those made since, up to `through`. */
function owed(removals: Removal[] | undefined, version: number, through = Infinity) {
  return (removals ?? []).filter((removal) => removal.version > version && removal.version <= through);
}

/** `answers` once `removal` is taken: none, or all but those to its question. */
function without(answers: PaperAnswers, removal: Removal) {
  return removal.question === undefined ? [] : answers.filter((answer) => answer.question !== removal.question);
}

/** A paper's answers as they were at `version`: its newest history up to it. */
function paperAt(ctx: Read, screeningId: Id<"screenings">, paperId: string, version: number) {
  return ctx.db.query("screeningAnswerHistory")
    .withIndex("by_screening_and_paper_and_version", (q) => q.eq("screeningId", screeningId).eq("paperId", paperId).lte("version", version))
    .order("desc").first();
}

function paperRow(ctx: Read, screeningId: Id<"screenings">, paperId: string) {
  return ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", paperId)).unique();
}

/**
 * These papers' answers, now or as they were at `version`: one indexed read a paper, so a
 * page reads the answers of the papers it shows and no others. A paper with none is left out.
 */
export async function answersAmong(ctx: Read, screening: Doc<"screenings">, paperIds: string[], version?: number): Promise<Responses> {
  const rows = await Promise.all(paperIds.map((paperId) => (version === undefined ? paperRow(ctx, screening._id, paperId) : paperAt(ctx, screening._id, paperId, version))));
  return toResponses(rows.flatMap((row) => {
    if (!row) return [];
    const answers = owed(screening.removals, row.version ?? 0, version).reduce(without, row.answers);
    return answers.length ? [{ paperId: row.paperId, answers }] : [];
  }));
}

/**
 * Takes from a paper's row the removals it owes, recording each that takes something in the
 * paper's history at the removal's version. Returns the row as that leaves it: the same row
 * when nothing went, or null when nothing is left.
 */
async function settle(ctx: Write, screening: Doc<"screenings">, row: Doc<"screeningAnswers">) {
  let answers = row.answers;
  let version = row.version;
  for (const removal of owed(screening.removals, row.version ?? 0)) {
    const next = without(answers, removal);
    if (next.length === answers.length) continue;
    await ctx.db.insert("screeningAnswerHistory", { screeningId: screening._id, paperId: row.paperId, answers: next, version: removal.version, at: removal.at });
    answers = next;
    version = removal.version;
  }
  if (answers === row.answers) return row;
  if (!answers.length) {
    await ctx.db.delete("screeningAnswers", row._id);
    return null;
  }
  await ctx.db.patch("screeningAnswers", row._id, { answers, version });
  return { ...row, answers, version };
}

/** One paper's row with the removals it owed taken, as the map `apply` reads. */
async function settledRow(ctx: Write, screening: Doc<"screenings">, paperId: string) {
  const found = await paperRow(ctx, screening._id, paperId);
  const row = found && (await settle(ctx, screening, found));
  return new Map(row ? [[paperId, row]] : []);
}

/**
 * Writes each paper's next answers where they changed, and appends them to the history
 * under the screening's next version. An empty list removes the paper. Returns the
 * screening's version afterwards. Callers pass a bounded number of papers: one, or a new search's.
 */
async function apply(ctx: Write, screening: Doc<"screenings">, updates: Array<{ paperId: string; answers: PaperAnswers }>, existing: Map<string, Doc<"screeningAnswers">>, at: number) {
  const version = screening.version + 1;
  let changed = false;
  for (const { paperId, answers } of updates) {
    const row = existing.get(paperId);
    if (JSON.stringify(row?.answers ?? []) === JSON.stringify(answers)) continue;
    if (!answers.length) await ctx.db.delete("screeningAnswers", row!._id);
    else if (row) await ctx.db.patch("screeningAnswers", row._id, { answers, version });
    else await ctx.db.insert("screeningAnswers", { screeningId: screening._id, paperId, answers, version });
    await ctx.db.insert("screeningAnswerHistory", { screeningId: screening._id, paperId, answers, version, at });
    changed = true;
  }
  if (!changed) return screening.version;
  await ctx.db.patch("screenings", screening._id, { version });
  return version;
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
 * screening again, so several calls in one transaction each take the next version. The paper
 * first takes any removal it owes, so an answer given after a removal is a new answer, even
 * one the same as before.
 */
export async function answerPaper(ctx: Write, screeningId: Id<"screenings">, paperId: string, responses: NewAnswers, setBy: AnswerSource, at: number) {
  const screening = (await ctx.db.get("screenings", screeningId))!;
  const existing = await settledRow(ctx, screening, paperId);
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
  await apply(ctx, screening, [{ paperId, answers: [] }], await settledRow(ctx, screening, paperId), at);
}

/**
 * Papers a new search can come with answers for. Each writes its row and its history, and
 * one transaction writes 16,000 documents.
 * ponytail: a search with more is refused by name; seed in batches if anyone brings one.
 */
export const SEEDED_PAPERS_MAX = 5_000;

/**
 * Gives a search that has just been made the answers it came with, from an import or the
 * assistant. It has no answers yet, so nothing is read. A paper listed twice takes its last entry.
 */
export async function seedAnswers(ctx: Write, userId: Id<"users">, searchId: Id<"searches">, answers: Responses, setBy: AnswerSource, at: number) {
  const papers = new Map(answers.map(({ paperId, responses }) => [paperId, responses] as const));
  if (papers.size === 0) return;
  if (papers.size > SEEDED_PAPERS_MAX) throw new Error(`A search can be saved with answers for up to ${SEEDED_PAPERS_MAX.toLocaleString("en")} papers.`);
  const screening = await ensureScreening(ctx, userId, searchId);
  const updates = Array.from(papers, ([paperId, responses]) => ({ paperId, answers: responses.map(({ question, response }) => ({ question, answer: response, setBy, updatedAt: at })) }));
  await apply(ctx, screening, updates, new Map(), at);
}

/** Papers one page of a sweep reads, and the bytes of them. */
const SWEEP_BATCH = 200;
const SWEEP_BYTES = 4 * 1024 * 1024;

/**
 * One page of a sweep: each row takes the removals it owes. Returns where the next page
 * starts. After the last page every row has taken the removals up to `through`, the
 * newest when the sweep began (a row written since was written without them), so they're
 * forgotten, and it returns null.
 */
export async function sweepAnswers(ctx: Write, screening: Doc<"screenings">, through: number, cursor: string | null) {
  const page = await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screening._id))
    .paginate({ cursor, numItems: SWEEP_BATCH, maximumBytesRead: SWEEP_BYTES });
  let changed = false;
  for (const row of page.page) changed = (await settle(ctx, screening, row)) !== row || changed;
  if (!page.isDone) return { changed, cursor: page.continueCursor };
  const left = (screening.removals ?? []).filter((removal) => removal.version > through);
  await ctx.db.patch("screenings", screening._id, { removals: left.length ? left : undefined });
  return { changed, cursor: null };
}

/**
 * Takes answers from every paper of a screening: all of them, or those to `question`. The
 * first page of papers goes with the call. Returns whether any answer went, the removal's
 * version, and where a sweep carries on (null when the first page was every paper). A
 * removal that finds nothing to take in a screening of one page changes nothing at all.
 */
export async function removeAnswers(ctx: Write, screening: Doc<"screenings">, question: string | undefined, at: number) {
  if ((screening.removals?.length ?? 0) >= MAX_PENDING_REMOVALS) throw new Error("Earlier changes to this search's answers are still being applied. Try again in a moment.");
  const version = screening.version + 1;
  const removal: Removal = { ...(question === undefined ? {} : { question }), version, at };
  const next = { ...screening, version, removals: [...(screening.removals ?? []), removal] };
  const swept = await sweepAnswers(ctx, next, version, null);
  // Nothing owed it, and every paper was looked at: the screening keeps its version.
  if (!swept.changed && swept.cursor === null) return { changed: false, through: version, cursor: null };
  await ctx.db.patch("screenings", screening._id, { version, ...(swept.cursor === null ? {} : { removals: next.removals }) });
  return { changed: true, through: version, cursor: swept.cursor };
}
