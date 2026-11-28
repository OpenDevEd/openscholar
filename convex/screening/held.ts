/**
 * The sources a person hands a screening themselves (plans/screening-reviewers): a reference file or a table, a
 * pasted list of DOIs, and PDFs. Each is a file kept in storage. A check reads it a step at a time, asks the index
 * what it knows of each record, and hands the papers to `fill` (./gathering.ts) with what it leaves out and why.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { availableCredits } from "../billing/accounts";
import { pricingOf, resolveTaskPick } from "../ai/serverModel";
import { createError } from "../lib/errors";
import { internalQuery } from "../lib/functions";
import { workspaceAction, workspaceMutation, workspaceQuery } from "../lib/userActions";
import { readSearchPage, readWork } from "../paperSets/openalex";
import { SCREENING_FIELDS, spender, toPaper, type SearchPaper, type Work } from "../paperSets/search";
import { readsPdfs } from "../../lib/assistant/files";
import { pdfLookCredits } from "../../lib/pricing/estimate";
import { normalDoi, paperKey } from "../../lib/papers/paper-ref";
import { plainTitle, sameTitle } from "../../lib/papers/paper-ref";
import { FILE_MAX_BYTES, REFERENCES, itemRecords, readTable, tableRecords, type FileRecord, type ImportedItem } from "../../lib/screening/files";
import { registered } from "./doiRecords";
import { DOIS_MAX, doisKeptValidator, fileLookValidator, type leftOutWhyValidator } from "./validators";
import type { Infer } from "convex/values";

/** Zotero's importer, which reads every reference format the databases export: the one live communities are given. */
const TRANSLATION_URL = process.env.ZOTERO_TRANSLATION_URL ?? "https://bib.opendev.space";
/** DOIs asked of the index in one request. */
const DOIS_A_REQUEST = 50;
/** The order a lookup by DOI asks for: any the index takes without words to rank by, since every DOI asked for comes back in the one page. */
const BY_DOI_SORT = "cited_by_count:desc";

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
 * Reads a file a person is about to add to a screening and says what it holds: how many records with a title. For a
 * table it names the columns, the ones it took for the title, the abstract and so on, and whether someone has to say
 * which is which.
 */
export const look = workspaceAction({
  args: { file: v.id("_storage"), columns: v.optional(v.record(v.string(), v.string())) },
  returns: fileLookValidator,
  handler: async (ctx, _actor, { file, columns }) => {
    const { records, table } = await recordsIn(ctx, file, columns);
    return { records: records.filter((record) => record.title).length, ...(table ? { table: { heads: table.heads.slice(0, 200), picked: table.picked as Record<string, string>, ask: table.ask } } : {}) };
  },
});

/** The papers the index holds for these DOIs, by DOI: ours first, then OpenAlex for the ones it lacks. Each as the index gives it: one that comes with no abstract is given one, where one is held, as its source hands it to the screening (`withAbstracts`). */
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
        const { works } = await readSearchPage<Work>({ filter: `doi:${chunk.map((doi) => `https://doi.org/${doi}`).join("|")}`, sort: BY_DOI_SORT, source }, { page: 1, size: DOIS_A_REQUEST, select: SCREENING_FIELDS }, spend);
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

/**
 * The abstract of each of these papers that came without one, from where one is held: OpenAlex first, then the
 * record Crossref or DataCite registered under the paper's DOI. One place, for every source's papers
 * (./gathering.ts `give`). Our own index holds fewer abstracts than OpenAlex does: of 12 papers a search on it gave
 * with none, OpenAlex had the abstract of 6. A paper is not left out of a screening for want of an abstract someone
 * holds. OpenAlex's is taken only from the work that carries the paper's own title: an index can name the wrong
 * OpenAlex work for a paper (ours gave one its PubMed number as its OpenAlex one), and that work's abstract is
 * another paper's. Without `spend`, the person's allowance to ask OpenAlex, only the registries are asked.
 */
export async function withAbstracts(papers: SearchPaper[], spend: Spend | null): Promise<SearchPaper[]> {
  const found = new Map<string, string>();
  const lacks = (paper: SearchPaper) => !paper.abstract?.trim() && !found.has(paper.paper);
  const bare = spend ? papers.filter((paper) => lacks(paper) && /^openalex:W\d+$/.test(paper.paper)) : [];
  const titled = new Map(bare.map((paper) => [paper.paper, paper.title]));
  const sameWork = (one: string, other: string) => sameTitle(one, other) || (plainTitle(one) !== "" && plainTitle(one) === plainTitle(other));
  for (let at = 0; at < bare.length; at += DOIS_A_REQUEST) {
    const ids = bare.slice(at, at + DOIS_A_REQUEST).map((paper) => paper.paper.slice("openalex:".length));
    // A paper OpenAlex can't be asked about now is screened, or left out, as it came: a source isn't stopped for one lookup.
    const { works } = await readSearchPage<Work>({ filter: `openalex:${ids.join("|")}`, sort: BY_DOI_SORT, source: "openalex" }, { page: 1, size: DOIS_A_REQUEST, select: "id,title,abstract_inverted_index" }, spend!).catch((error) => { console.error("[screening] OpenAlex couldn't be asked for abstracts", error); return { works: [] as Work[] }; });
    for (const work of works) {
      const paper = work.id ? toPaper(work) : null;
      if (!paper?.abstract) continue;
      if (sameWork(paper.title, titled.get(paper.paper) ?? "")) found.set(paper.paper, paper.abstract);
      else console.warn("[screening] OpenAlex holds another work under a paper's ID: its abstract isn't taken", { paper: paper.paper, ours: titled.get(paper.paper)?.slice(0, 120), theirs: paper.title.slice(0, 120) });
    }
  }
  // ponytail: a pasted DOI no index holds, whose registry record has no abstract, is asked of the registries a second time here. Carry "already asked" with the paper if that ever costs.
  const byDoi = new Map(papers.flatMap((paper) => { const doi = lacks(paper) ? normalDoi(paper.doi) : null; return doi ? [[doi, paper.paper] as const] : []; }));
  for (const [doi, record] of byDoi.size ? await registered([...byDoi.keys()]) : []) if (record.abstract) found.set(byDoi.get(doi)!, record.abstract);
  // Only a paper that came with no abstract takes one: two records of one work, one with its own, keep theirs.
  return found.size ? papers.map((paper) => (!paper.abstract?.trim() && found.has(paper.paper) ? { ...paper, abstract: found.get(paper.paper)! } : paper)) : papers;
}

/**
 * Keeps a pasted list of DOIs as a file a screening can read, each DOI once. What the index holds of each is asked
 * once, when the screening reads the list (`handedPapers`): its source's row then says what was taken and what was
 * left out, as every source's does.
 */
export const keepDois = workspaceAction({
  args: { dois: v.array(v.string()) },
  returns: doisKeptValidator,
  handler: async (ctx, _actor, { dois: sent }) => {
    const dois = [...new Set(sent.map((doi) => normalDoi(doi)).filter((doi): doi is string => doi !== null))];
    if (!dois.length) throw createError("VALIDATION_ERROR", "Paste at least one DOI.");
    if (dois.length > DOIS_MAX) throw createError("VALIDATION_ERROR", `Paste up to ${DOIS_MAX.toLocaleString("en-GB")} DOIs at a time.`);
    return { file: await ctx.storage.store(new Blob([dois.join("\n")], { type: "text/plain" })), dois: dois.length };
  },
});

/**
 * Corrects a DOI of a pasted list that the screening couldn't find, or tries it again as it is (`to` the same): the
 * list is kept anew with it, and its source is read again from its start (./living.ts `swapDois`).
 */
export const correctDoi = workspaceAction({
  args: { sourceId: v.id("screeningSources"), from: v.string(), to: v.string() },
  // The list the source reads now, which the form that is starting the screening takes in place of the one it had.
  returns: v.id("_storage"),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  handler: async (ctx, actor, { sourceId, from, to }): Promise<Id<"_storage">> => {
    const [was, now] = [normalDoi(from), normalDoi(to)];
    if (!now) throw createError("VALIDATION_ERROR", "That isn't a DOI. A DOI starts with 10. and has a slash.");
    const file: Id<"_storage"> = await ctx.runQuery(internal.screening.living.doisOf, { sourceId, userId: actor.userId, workspaceId: actor.workspaceId });
    const dois = (await textOf(ctx, file)).split("\n").filter(Boolean);
    // The DOI takes the place of the one it corrects, in the same place: each DOI of the list is known by where it stands, so nothing after it moves. One that is now there twice is read as a duplicate.
    const kept = dois.map((doi) => (doi === was ? now : doi));
    const next = was === now ? file : await ctx.storage.store(new Blob([kept.join("\n")], { type: "text/plain" }));
    await ctx.runMutation(internal.screening.living.swapDois, { sourceId, was: file, file: next, ...(was && was !== now ? { from: was, to: now } : {}), userId: actor.userId, workspaceId: actor.workspaceId });
    return next;
  },
});

/** Who a source is read as, and the model that reads a PDF's own first pages, with what it costs, whether it takes a PDF as a file, and what the workspace has. */
export const reader = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: v.union(v.null(), v.object({ clerkId: v.string(), balance: v.number(), model: v.union(v.null(), v.object({ slug: v.string(), input: v.number(), output: v.number(), files: v.boolean() })) })),
  handler: async (ctx, working) => {
    const user = await ctx.db.get("users", working.userId);
    if (!user) return null;
    return { clerkId: user.clerkId, balance: await availableCredits(ctx, working.workspaceId), model: await lookModel(ctx, working) };
  },
});

/** The model that reads a PDF's own first pages for whoever works in a workspace: the one they have for overviews, with what it costs and whether it takes a PDF as a file. */
async function lookModel(ctx: Pick<QueryCtx, "db">, working: { userId: Id<"users">; workspaceId: Id<"workspaces"> }) {
  const pick = await resolveTaskPick(ctx as QueryCtx, working, "overview");
  const model = pick ? await ctx.db.get("models", pick.modelId) : null;
  const pricing = model ? await pricingOf(ctx as QueryCtx, model._id) : null;
  // A PDF's first pages are a short prompt: the model's price for a long one never applies to them.
  return model && pricing ? { slug: model.modelId, input: pricing.input, output: pricing.output, files: readsPdfs(model.inputModalities) } : null;
}

/**
 * What the first reading of one PDF costs the workspace at most, said where PDFs are added, before any is: a
 * thousand PDFs cost a thousand of these. Null where no model of the person's reads a PDF: a PDF is then added
 * under its own name, and nothing is paid for it.
 */
export const pdfLook = workspaceQuery({
  args: {},
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, { userId, workspaceId }) => {
    const model = await lookModel(ctx, { userId, workspaceId });
    return model?.files ? pdfLookCredits({ input: model.input, output: model.output }) : null;
  },
});

/** A record no index holds, as the paper a screening reads: what its source gave of it, under a key of its own. */
const fromRecord = (record: FileRecord, paper: string): SearchPaper => ({ paper, title: record.title, ...(record.abstract ? { abstract: record.abstract } : {}), ...(record.authors ? { authors: record.authors } : {}), ...(record.publicationYear === undefined ? {} : { publicationYear: record.publicationYear }), ...(record.doi ? { doi: record.doi } : {}), ...(record.venue ? { venue: record.venue } : {}), ...(record.workType ? { workType: record.workType } : {}) });

type Held = { sourceId: Id<"screeningSources">; set: { kind: "upload"; file: Id<"_storage">; columns?: Record<string, string> } | { kind: "dois"; file: Id<"_storage"> } | { kind: "pdf"; batch: string }; state: "waiting" | "reading"; resume?: string; userId: Id<"users">; workspaceId: Id<"workspaces"> };

/** What a held source holds, counted before its first record: a file's records are read once and kept as a file of their own, which every step then reads. */
export async function handedStart(ctx: ActionCtx, { set }: Held): Promise<{ total: number; resume?: string }> {
  if (set.kind === "pdf") return { total: await ctx.runQuery(internal.screening.files.total, { batch: set.batch }) };
  if (set.kind === "dois") return { total: (await textOf(ctx, set.file)).split("\n").filter(Boolean).length };
  const { records, table } = await recordsIn(ctx, set.file, set.columns);
  if (table?.ask) throw createError("VALIDATION_ERROR", "Say which of this table's columns is the title, then add it again.");
  const parsed = await ctx.storage.store(new Blob([JSON.stringify(records)], { type: "application/json" }));
  return { total: records.length, resume: parsed };
}

/** Records `from` to `to` of a held source (from 1), as papers and as what is left out with why. "wait" while one of its PDFs is still being read for the first time (./files.ts). */
export async function handedPapers(ctx: ActionCtx, source: Held, from: number, to: number): Promise<{ papers: SearchPaper[]; left: LeftOut[] } | "wait"> {
  const { set } = source;
  const who: { clerkId: string } | null = await ctx.runQuery(internal.screening.held.reader, { userId: source.userId, workspaceId: source.workspaceId });
  if (!who) throw createError("NOT_FOUND", "Whoever added this source has no account any more.");
  const spend = spender(ctx, who.clerkId);
  if (set.kind === "pdf") {
    const files = await ctx.runQuery(internal.screening.files.slice, { batch: set.batch, from, to });
    if (files.some((file) => file.state === "waiting")) return "wait";
    const known = await byDois(files.flatMap((file) => (file.known && file.doi ? [file.doi] : [])), spend).catch(() => new Map<string, SearchPaper>());
    const [papers, left]: [SearchPaper[], LeftOut[]] = [[], []];
    for (const file of files) {
      const key = paperKey({ source: "upload", file: file.file });
      if (file.state === "broken") { left.push({ name: file.name, why: "broken", key }); continue; }
      // Its own PDF goes with the paper either way: the index's paper is screened on its abstract where it has one, or its first reading found one, and on the file where there is none.
      const own = { file: file.file, fileName: file.name, ...(file.pages === undefined ? {} : { pages: file.pages }), ...(file.shape === undefined ? {} : { shape: file.shape }) };
      const paper = file.known && file.doi ? known.get(file.doi) : undefined;
      papers.push({ ...(paper ? { ...paper, ...(paper.abstract?.trim() || !file.abstract ? {} : { abstract: file.abstract }) } : { paper: key, title: file.title ?? file.name.replace(/\.pdf$/i, ""), ...(file.authors?.length ? { authors: file.authors } : {}), ...(file.year === undefined ? {} : { publicationYear: file.year }) }), ...own, record: file.file });
    }
    return { papers, left };
  }
  if (set.kind === "dois") {
    const dois = (await textOf(ctx, set.file)).split("\n").filter(Boolean).slice(from - 1, to);
    const found = await byDois(dois, spend);
    // A DOI the index has no record of is the paper Crossref or DataCite registered under it, where one did.
    // A list of DOIs is its records: one a registry didn't answer for isn't "no record of it", so the reading stops and is read again.
    const elsewhere = await registered(dois.filter((doi) => !found.has(doi)), { strict: true });
    const papers = dois.flatMap((doi, at): SearchPaper[] => {
      const [known, record] = [found.get(doi), elsewhere.get(doi)];
      const paper = known ?? (record && fromRecord(record, paperKey({ source: "upload", file: `${set.file}.${from + at}` })));
      return paper ? [{ ...paper, record: String(from + at) }] : [];
    });
    // A DOI names what is left out of it, so one there twice (a correction to a DOI already in the list) is left out once.
    return { papers, left: [...new Set(dois.filter((doi) => !found.has(doi) && !elsewhere.has(doi)))].map((doi) => ({ name: doi, why: "record" as const, key: doi })) };
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
    return { ...(known
      ? { ...known, title: record.title || known.title, ...(record.abstract ?? known.abstract ? { abstract: record.abstract ?? known.abstract } : {}) }
      : fromRecord(record, paperKey({ source: "upload", file: `${set.file}.${from + at}` }))), record: String(from + at) };
  });
  return { papers, left: [] };
}
