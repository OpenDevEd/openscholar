/**
 * Screening answers for saved searches, one row per paper and question, so changing
 * an answer writes that answer and nothing else. Every change is also appended to a
 * history, which is how an old revision of a search shows the answers it had.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { SavedSearch } from "../../lib/research/records";

/** Who set an answer. `unrecorded` is for answers saved before this was recorded. */
export type AnswerSource = Doc<"screeningAnswers">["setBy"];
type Responses = SavedSearch["screeningResponses"];
type Answer = boolean | null;
type Read = Pick<QueryCtx, "db">;
type Write = Pick<MutationCtx, "db">;

export function screeningFor(ctx: Read, searchId: Id<"searches">) {
  return ctx.db.query("screenings").withIndex("by_search", (q) => q.eq("searchId", searchId)).unique();
}

async function ensureScreening(ctx: Write, userId: Id<"users">, searchId: Id<"searches">) {
  const existing = await screeningFor(ctx, searchId);
  if (existing) return existing;
  return (await ctx.db.get("screenings", await ctx.db.insert("screenings", { userId, searchId, version: 0, createdAt: Date.now() })))!;
}

/** Rows grouped by paper, in the shape a saved search carries. */
function group(rows: Array<{ paperId: string; question: string; answer: Answer }>): Responses {
  const byPaper = new Map<string, Responses[number]["responses"]>();
  for (const row of rows) {
    const list = byPaper.get(row.paperId) ?? [];
    list.push({ question: row.question, response: row.answer });
    byPaper.set(row.paperId, list);
  }
  return Array.from(byPaper, ([paperId, responses]) => ({ paperId, responses }));
}

/** A search's current answers. A screening holds as many rows as the papers screened, so this reads them all. */
export async function currentAnswers(ctx: Read, screeningId: Id<"screenings">): Promise<Responses> {
  return group(await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper_and_question", (q) => q.eq("screeningId", screeningId)).collect());
}

/** The answers as they were at screening version `version`, rebuilt from the history. */
export async function answersAt(ctx: Read, screeningId: Id<"screenings">, version: number): Promise<Responses> {
  const state = new Map<string, { paperId: string; question: string; answer: Answer }>();
  const history = ctx.db.query("screeningAnswerHistory").withIndex("by_screening_and_version", (q) => q.eq("screeningId", screeningId).lte("version", version));
  for await (const row of history) {
    const key = JSON.stringify([row.paperId, row.question]);
    if (row.removed) state.delete(key);
    else state.set(key, { paperId: row.paperId, question: row.question, answer: row.answer ?? null });
  }
  return group([...state.values()].sort((a, b) => (a.paperId < b.paperId ? -1 : a.paperId > b.paperId ? 1 : 0)));
}

type Change = { paperId: string; question: string; answer: Answer | "removed" };

/**
 * Applies changes to the current rows and appends each one to the history under the
 * screening's next version. Returns the screening's version afterwards.
 */
async function apply(ctx: Write, screening: Doc<"screenings">, changes: Change[], setBy: AnswerSource, at: number) {
  const version = screening.version + 1;
  let changed = false;
  for (const change of changes) {
    const row = await ctx.db
      .query("screeningAnswers")
      .withIndex("by_screening_and_paper_and_question", (q) => q.eq("screeningId", screening._id).eq("paperId", change.paperId).eq("question", change.question))
      .unique();
    const entry = { screeningId: screening._id, paperId: change.paperId, question: change.question, setBy, version, at };
    if (change.answer === "removed") {
      if (!row) continue;
      await ctx.db.delete("screeningAnswers", row._id);
      await ctx.db.insert("screeningAnswerHistory", { ...entry, removed: true });
    } else {
      if (row && row.answer === change.answer) continue;
      if (row) await ctx.db.patch("screeningAnswers", row._id, { answer: change.answer, setBy, updatedAt: at });
      else await ctx.db.insert("screeningAnswers", { screeningId: screening._id, paperId: change.paperId, question: change.question, answer: change.answer, setBy, updatedAt: at });
      await ctx.db.insert("screeningAnswerHistory", { ...entry, answer: change.answer });
    }
    changed = true;
  }
  if (!changed) return screening.version;
  await ctx.db.patch("screenings", screening._id, { version });
  return version;
}

/** Sets some of one paper's answers, reading only that paper's rows. */
export async function setPaperAnswers(ctx: Write, userId: Id<"users">, searchId: Id<"searches">, paperId: string, responses: Responses[number]["responses"], setBy: AnswerSource, at: number) {
  const screening = await ensureScreening(ctx, userId, searchId);
  await apply(ctx, screening, responses.map(({ question, response }) => ({ paperId, question, answer: response })), setBy, at);
}

/** Removes one paper's answers, reading only that paper's rows. */
export async function clearPaperAnswers(ctx: Write, searchId: Id<"searches">, paperId: string, setBy: AnswerSource, at: number) {
  const screening = await screeningFor(ctx, searchId);
  if (!screening) return;
  const rows = await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper_and_question", (q) => q.eq("screeningId", screening._id).eq("paperId", paperId)).collect();
  await apply(ctx, screening, rows.map((row) => ({ paperId, question: row.question, answer: "removed" as const })), setBy, at);
}

/**
 * Makes the answers exactly `next`: for edits that change many papers at once, for new
 * searches, and for the move out of chunks. Returns the screening's version afterwards,
 * or undefined when the search has no screening.
 */
export async function replaceAnswers(ctx: Write, userId: Id<"users">, searchId: Id<"searches">, next: Responses, setBy: AnswerSource, at: number) {
  const existing = await screeningFor(ctx, searchId);
  if (!existing && next.length === 0) return undefined;
  const screening = existing ?? (await ensureScreening(ctx, userId, searchId));
  const wanted = new Map(next.flatMap((row) => row.responses.map((value) => [JSON.stringify([row.paperId, value.question]), { paperId: row.paperId, question: value.question, answer: value.response }] as const)));
  const current = existing ? await currentAnswers(ctx, screening._id) : [];
  const removed = current.flatMap((row) => row.responses.filter((value) => !wanted.has(JSON.stringify([row.paperId, value.question]))).map((value) => ({ paperId: row.paperId, question: value.question, answer: "removed" as const })));
  return apply(ctx, screening, [...removed, ...wanted.values()], setBy, at);
}
