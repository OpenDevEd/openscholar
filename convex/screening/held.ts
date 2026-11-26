/**
 * The sources a person hands a screening themselves (plans/screening-reviewers): a reference file or a table, a
 * pasted list of DOIs, and PDFs. Each is a file kept in storage. A check reads it a step at a time, asks the index
 * what it knows of each record, and hands the papers to `fill` (./gathering.ts) with what it leaves out and why.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { availableCredits } from "../billing/accounts";
import { pricingOf, resolveTaskPick } from "../ai/serverModel";
import { createError } from "../lib/errors";
import { internalQuery } from "../lib/functions";
import { workspaceAction, workspaceMutation } from "../lib/userActions";
import { PAGE_ORDERED_SORT, readSearchPage, readWork } from "../paperSets/openalex";
import { SCREENING_FIELDS, spender, toPaper, type SearchPaper, type Work } from "../paperSets/search";
import { normalDoi, paperKey } from "../../lib/papers/paper-ref";
import { FILE_MAX_BYTES, REFERENCES, itemRecords, readTable, tableRecords, type FileRecord, type ImportedItem } from "../../lib/screening/files";
import { fileLookValidator, type leftOutWhyValidator } from "./validators";
import type { Infer } from "convex/values";

/** Zotero's importer, which reads every reference format the databases export: the one live communities are given. */
const TRANSLATION_URL = process.env.ZOTERO_TRANSLATION_URL ?? "https://bib.opendev.space";
/** DOIs asked of the index in one request, and PDFs read in one step. */
const DOIS_A_REQUEST = 50;
export const PDFS_A_STEP = 10;
/** Titles a file's preview shows. */
const SAMPLE = 3;

export type LeftOut = { name: string; why: Infer<typeof leftOutWhyValidator>; key?: string };
type Spend = (pages: number) => Promise<boolean>;

/** Where the browser sends a file a screening is to read: a reference file, a table, a PDF, or a list of DOIs as text. */
export const uploadUrl = workspaceMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

async function textOf(ctx: Pick<ActionCtx, "storage">, file: Id<"_storage">) {
  const blob = await ctx.storage.get(file);
  if (!blob) throw createError("NOT_FOUND", "That file is gone. Add it again.");
  if (blob.size > FILE_MAX_BYTES) throw createError("VALIDATION_ERROR", "A file can be up to 5 MB. Split it and add each part.");
  return (await blob.text()).replace(/^﻿/, "");
}

/** What a file holds: its records, and for a table its columns, with the ones still to be named. */
async function recordsIn(ctx: Pick<ActionCtx, "storage">, file: Id<"_storage">, columns?: Record<string, string>) {
  const text = await textOf(ctx, file);
  if (REFERENCES.test(text)) {
    const response = await fetch(`${TRANSLATION_URL}/import`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: text, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      console.error("[screening] The importer refused a reference file", { status: response.status, body: (await response.text()).slice(0, 300) });
      throw createError("VALIDATION_ERROR", "This file couldn't be read as references. Export it again as RIS or BibTeX.");
    }
    return { records: itemRecords((await response.json()) as ImportedItem[]) };
  }
  const table = readTable(text);
  if (!table) throw createError("VALIDATION_ERROR", "This file holds no references Openscholar can read. It reads RIS, BibTeX, EndNote, PubMed, Web of Science, CSV and TSV.");
  const picked = { ...table.picked, ...columns };
  // A table whose title column is unknown gives no record until someone names it.
  return { records: picked.title ? tableRecords(table, picked) : [], table: { heads: table.heads, picked, ask: columns ? !picked.title : table.ask } };
}

/**
 * Reads a file a person is about to add to a screening and says what it holds: how many records, how many have no
 * title or no abstract and would be left out, how many carry a DOI, and its first titles. For a table it names the
 * columns, the ones it took for the title, the abstract and so on, and whether someone has to say which is which.
 */
export const look = workspaceAction({
  args: { file: v.id("_storage"), columns: v.optional(v.record(v.string(), v.string())) },
  returns: fileLookValidator,
  handler: async (ctx, _actor, { file, columns }) => {
    const { records, table } = await recordsIn(ctx, file, columns);
    const titled = records.filter((record) => record.title);
    return {
      records: titled.length,
      untitled: records.length - titled.length,
      bare: titled.filter((record) => !record.abstract).length,
      withDoi: titled.filter((record) => record.doi).length,
      sample: titled.slice(0, SAMPLE).map((record) => record.title.slice(0, 300)),
      ...(table ? { table: { heads: table.heads.slice(0, 200), picked: table.picked as Record<string, string>, ask: table.ask } } : {}),
    };
  },
});

/** The papers the index holds for these DOIs, by DOI: ours first, then OpenAlex for the ones it lacks. */
export async function byDois(dois: string[], spend: Spend): Promise<Map<string, SearchPaper>> {
  const found = new Map<string, SearchPaper>();
  const keep = (work: Work | null | undefined) => {
    if (!work?.id) return;
    const paper = toPaper(work);
    const doi = normalDoi(paper.doi);
    if (doi && !found.has(doi)) found.set(doi, paper);
  };
  // A DOI with a bracket, a comma or a bar can't go in a filter of several: it is asked for by itself.
  const [plain, odd] = [dois.filter((doi) => !/[()[\],|]/.test(doi)), dois.filter((doi) => /[()[\],|]/.test(doi))];
  for (const source of ["openscholar", "openalex"] as const) {
    const missing = plain.filter((doi) => !found.has(doi));
    for (let at = 0; at < missing.length; at += DOIS_A_REQUEST) {
      const chunk = missing.slice(at, at + DOIS_A_REQUEST);
      try {
        const { works } = await readSearchPage<Work>({ filter: `doi:${chunk.map((doi) => `https://doi.org/${doi}`).join("|")}`, sort: PAGE_ORDERED_SORT, source }, { page: 1, size: DOIS_A_REQUEST, select: SCREENING_FIELDS }, spend);
        works.forEach(keep);
      } catch (error) {
        // One index down or refusing the filter leaves the other to answer. An allowance spent is the person's to hear.
        if (source === "openalex") throw error;
        console.error("[screening] Our index couldn't look these DOIs up", error);
      }
    }
  }
  for (const doi of odd) keep(await readWork<Work>(`https://doi.org/${encodeURIComponent(doi)}`, SCREENING_FIELDS, spend).catch(() => null));
  return found;
}

/** Who a source is read as, and the model that reads a PDF's own first pages, with what it costs and what the workspace has. */
export const reader = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: v.union(v.null(), v.object({ clerkId: v.string(), balance: v.number(), model: v.union(v.null(), v.object({ slug: v.string(), input: v.number(), output: v.number() })) })),
  handler: async (ctx, working) => {
    const user = await ctx.db.get("users", working.userId);
    if (!user) return null;
    const pick = await resolveTaskPick(ctx, working, "overview");
    const model = pick ? await ctx.db.get("models", pick.modelId) : null;
    const pricing = model ? await pricingOf(ctx, model._id) : null;
    return { clerkId: user.clerkId, balance: await availableCredits(ctx, working.workspaceId), model: model && pricing ? { slug: model.modelId, ...pricing } : null };
  },
});

type Held = { sourceId: Id<"screeningSources">; set: { kind: "upload"; file: Id<"_storage">; columns?: Record<string, string> } | { kind: "dois"; file: Id<"_storage"> } | { kind: "pdf"; files: Array<{ file: Id<"_storage">; name: string }> }; state: "waiting" | "reading"; resume?: string; userId: Id<"users">; workspaceId: Id<"workspaces"> };

/** What a held source holds, counted before its first record: a file's records are read once and kept as a file of their own, which every step then reads. */
export async function handedStart(ctx: ActionCtx, { set }: Held): Promise<{ total: number; resume?: string }> {
  if (set.kind === "pdf") return { total: set.files.length };
  if (set.kind === "dois") return { total: (await textOf(ctx, set.file)).split("\n").filter(Boolean).length };
  const { records, table } = await recordsIn(ctx, set.file, set.columns);
  if (table?.ask) throw createError("VALIDATION_ERROR", "Say which of this table's columns is the title, then add it again.");
  const parsed = await ctx.storage.store(new Blob([JSON.stringify(records)], { type: "application/json" }));
  return { total: records.length, resume: parsed };
}

/** Records `from` to `to` of a held source (from 1), as papers and as what is left out with why. */
export async function handedPapers(ctx: ActionCtx, source: Held, from: number, to: number): Promise<{ papers: SearchPaper[]; left: LeftOut[] }> {
  const { set } = source;
  const who: { clerkId: string } | null = await ctx.runQuery(internal.screening.held.reader, { userId: source.userId, workspaceId: source.workspaceId });
  if (!who) throw createError("NOT_FOUND", "Whoever added this source has no account any more.");
  const spend = spender(ctx, who.clerkId);
  if (set.kind === "pdf") return await ctx.runAction(internal.screening.heldPdfs.read, { userId: source.userId, workspaceId: source.workspaceId, files: set.files.slice(from - 1, to) });
  if (set.kind === "dois") {
    const dois = (await textOf(ctx, set.file)).split("\n").filter(Boolean).slice(from - 1, to);
    const found = await byDois(dois, spend);
    return { papers: dois.flatMap((doi) => found.get(doi) ?? []), left: dois.filter((doi) => !found.has(doi)).map((doi) => ({ name: doi, why: "record" as const })) };
  }
  const kept = source.resume ? await ctx.storage.get(source.resume as Id<"_storage">) : null;
  if (!kept) throw createError("NOT_FOUND", "This file's records are gone. Add it again.");
  const records = (JSON.parse(await kept.text()) as FileRecord[]).slice(from - 1, to);
  // A record whose DOI the index knows is that paper, so it can be saved to a library and found again. Without the allowance to ask, it is screened as the file gives it.
  const dois = records.flatMap((record) => normalDoi(record.doi) ?? []);
  const found = dois.length ? await byDois(dois, spend).catch(() => new Map<string, SearchPaper>()) : new Map<string, SearchPaper>();
  const papers = records.map((record, at): SearchPaper => {
    const known = found.get(normalDoi(record.doi) ?? "");
    // What the person brought is what is screened: the file's own title and abstract where it has them.
    return known
      ? { ...known, title: record.title || known.title, ...(record.abstract ?? known.abstract ? { abstract: record.abstract ?? known.abstract } : {}) }
      : { paper: paperKey({ source: "upload", file: `${set.file}.${from + at}` }), title: record.title, ...(record.abstract ? { abstract: record.abstract } : {}), ...(record.authors ? { authors: record.authors } : {}), ...(record.publicationYear === undefined ? {} : { publicationYear: record.publicationYear }), ...(record.doi ? { doi: record.doi } : {}), ...(record.venue ? { venue: record.venue } : {}) };
  });
  return { papers, left: [] };
}
