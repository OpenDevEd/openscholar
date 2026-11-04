/**
 * Every paper PDF the assistant and extraction download is kept in Cloudflare R2 (bucket `openscholar-paper-pdfs`),
 * never deleted, and read from there first. `paperPdf` gets one, in this order:
 *
 *   1. the copy in R2: PAPER_PDF_CREDITS, once per chat or per extraction (`PdfPayer.scope`)
 *   2. the paper's own link, and the free copies its DOI leads to (lib/pdf/download.ts): free, and kept in R2
 *   3. OpenAlex's cached copy (content.openalex.org): what OpenAlex charged, and kept in R2
 *
 * A copy bought from OpenAlex is kept under the paper's OpenAlex ID. One fetched by a link is kept under that link,
 * so it stands for what the link served and nothing more: nobody's file, and no wrong file a link led to, stands in
 * for a paper.
 * A file from a person's own Zotero library is theirs: it never goes into the store, and the store is never read for it.
 *
 * The assistant pays for a copy here (`charge: "self"`). Extraction adds what a copy costs to the paper's own charge
 * (`charge: "report"`), under the job's hold when it was approved up to a figure.
 */
import { AwsClient } from "aws4fetch";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { releaseCredits, reserveCredits, settleCredits } from "../billing/charge";
import type { UsageKind } from "../billing/validators";
import { internalMutation } from "./functions";
import { downloadPdf, type DownloadPdfOptions } from "../../lib/pdf/download";
import { safeFetchPdf } from "../../lib/pdf/url-allowlist";
import { convertUsdToCredits, PAPER_PDF_CREDITS, PAPER_PDF_USD } from "../../lib/pricing";

/** What one OpenAlex credit costs, as its responses report a request's cost in credits. */
const OPENALEX_CREDIT_USD = 0.0001;
/** How long a link to a stored copy, given to a model's provider to fetch, lasts. */
const LINK_SECONDS = 3_600;
/** How often a read checks on another read in its chat or job paying for the same paper, and when a payment that never finished is taken over. */
const WAIT_MS = 500;
const PAYING_FOR_MS = 120_000;

/**
 * Who pays for a paper's PDF, and what it's read for: one charge for a paper in each `scope`, a chat's (`chat:<id>`)
 * or an extraction's (`extraction:<id>`), whose records go when it's deleted. A read with no scope pays each time.
 */
export type PdfPayer = { userId: Id<"users">; workspaceId: Id<"workspaces">; scope?: string; kind: UsageKind; jobId?: Id<"extractionJobs"> };
/** A paper by what names it. `hasCopy` is OpenAlex's `has_content.pdf`, where the caller read it: false skips buying a copy OpenAlex doesn't have. */
export type PaperRef = { openalexId?: string; doi?: string; url?: string; hasCopy?: boolean; zotero?: DownloadPdfOptions["zoteroConnection"] };
/** How the caller gets a PDF: the most it takes, whether it needs the file or only the copy's key, who charges, and whether plain-HTTP links are fetched. */
export type PdfOptions = { maxBytes: number; bytes: boolean; charge: "self" | "report"; allowHttp: boolean };
/**
 * The PDF and where it came from, with the credits it cost the scope (charged already, or for the caller to charge),
 * or why there's none: `credits` when the person can't pay for it.
 */
export type PaperPdf = { bytes: Uint8Array | null; key: string | null; from: "stored" | "link" | "openalex"; credits: number } | { error: string; credits?: true };

function store() {
  const { PAPER_PDFS_ENDPOINT: endpoint, PAPER_PDFS_BUCKET: bucket, PAPER_PDFS_ACCESS_KEY_ID: accessKeyId, PAPER_PDFS_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("PAPER_PDFS_ENDPOINT, PAPER_PDFS_BUCKET, PAPER_PDFS_ACCESS_KEY_ID and PAPER_PDFS_SECRET_ACCESS_KEY must be set for the paper PDF store.");
  return { client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }), url: (key: string) => `${endpoint.replace(/\/$/, "")}/${bucket}/${key}` };
}

/** The OpenAlex work ID in an ID or address, such as W2741809807; extraction gives papers from elsewhere IDs of their own. */
const workOf = (id: string | undefined) => id?.match(/(?:^|\/)(W\d+)$/i)?.[1]?.toUpperCase();
const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF");
const isZotero = (paper: PaperRef) => paper.url?.startsWith("zotero://") === true;

/** Where a copy of a paper fetched by its link alone is kept. */
async function linkKey(url: string | undefined) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
  return `url/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}.pdf`;
}

/** The keys a paper's copy may be kept under, the paper's own first. None for a file from a person's Zotero library. */
export async function paperKeys(paper: PaperRef): Promise<string[]> {
  if (isZotero(paper)) return [];
  const work = workOf(paper.openalexId);
  const link = await linkKey(paper.url);
  return [...(work ? [`openalex/${work}.pdf`] : []), ...(link ? [link] : [])];
}

/** The size of the stored copy, or null when there's none, or the store can't be read just now: then the paper is fetched as if it had none. */
async function storedSize(key: string): Promise<number | null> {
  const { client, url } = store();
  try {
    const response = await client.fetch(url(key), { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`answered ${response.status}`);
    return Number(response.headers.get("content-length") ?? 0);
  } catch (error) {
    console.error("[paper pdfs] the store couldn't be read", { key, error: String(error) });
    return null;
  }
}

/** The stored copy, or null when it's gone or larger than `maxBytes`. */
export async function readStored(key: string, maxBytes: number): Promise<Uint8Array | null> {
  const size = await storedSize(key);
  if (size === null || size > maxBytes) return null;
  const { client, url } = store();
  const response = await client.fetch(url(key));
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

/** Keeps a copy: false when it couldn't be, and it's fetched again next time. A caller that has the file goes on with it. */
async function keep(key: string, bytes: Uint8Array) {
  const { client, url } = store();
  try {
    // R2 refuses a write without its length (411), and Convex's fetch streams a Blob body without one.
    const response = await client.fetch(url(key), { method: "PUT", body: bytes.slice().buffer, headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length) } });
    if (!response.ok) throw new Error(`answered ${response.status}`);
    return true;
  } catch (error) {
    console.error("[paper pdfs] a copy couldn't be kept", { key, error: String(error) });
    return false;
  }
}

const NOT_KEPT = "This paper's PDF couldn't be kept to send. Try again in a moment.";

/** A link a model's provider can fetch the stored copy from, for an hour. */
export async function storedLink(key: string) {
  const { client, url } = store();
  return (await client.sign(`${url(key)}?X-Amz-Expires=${LINK_SECONDS}`, { method: "GET", aws: { signQuery: true } })).url;
}

/** OpenAlex's cached copy of a work, with what it cost in dollars as OpenAlex reports it, or null when it has none or it's larger than `maxBytes`. */
async function fromOpenAlex(work: string, maxBytes: number): Promise<{ bytes: Uint8Array; usd: number } | null> {
  const apiKey = process.env.OPENALEX_API_KEY;
  if (!apiKey) throw new Error("OPENALEX_API_KEY must be set to buy OpenAlex's copy of a paper.");
  // Through the guarded fetch: the file is read only up to `maxBytes`, and a redirect is checked like any address.
  const { response, body } = await safeFetchPdf(`https://content.openalex.org/works/${work}.pdf?api_key=${encodeURIComponent(apiKey)}`, { maxBytes, timeoutMs: 120_000, headers: { "User-Agent": "Openscholar (https://openscholar.ai)" } });
  const bytes = response.ok ? new Uint8Array(await body.arrayBuffer()) : null;
  if (!bytes || !isPdf(bytes)) {
    console.warn("[paper pdfs] OpenAlex has no copy to download", { work, status: response.status });
    return null;
  }
  const credits = Number(response.headers.get("x-ratelimit-credits-used"));
  return { bytes, usd: Number.isFinite(credits) && credits > 0 ? credits * OPENALEX_CREDIT_USD : PAPER_PDF_USD };
}

const readOf = (ctx: Pick<MutationCtx, "db">, scope: string, key: string) =>
  ctx.db.query("paperPdfReads").withIndex("by_scope_and_key", (q) => q.eq("scope", scope).eq("key", key)).unique();

/**
 * Starts the scope's payment for `key`: `pay` when it's this read's to make, `had` when the scope has it already,
 * `wait` while another read in the scope is paying for it. A payment that never finished is taken over.
 */
export const claim = internalMutation({
  args: { scope: v.string(), key: v.string() },
  returns: v.union(v.literal("pay"), v.literal("had"), v.literal("wait")),
  handler: async (ctx, { scope, key }) => {
    const row = await readOf(ctx, scope, key);
    if (row?.had) return "had" as const;
    if (row && row.at > Date.now() - PAYING_FOR_MS) return "wait" as const;
    if (row) await ctx.db.patch("paperPdfReads", row._id, { at: Date.now() });
    else await ctx.db.insert("paperPdfReads", { scope, key, had: false, at: Date.now() });
    return "pay" as const;
  },
});

/** The scope has `key` now: paid for, or fetched for nothing. */
export const had = internalMutation({
  args: { scope: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { scope, key }) => {
    const row = await readOf(ctx, scope, key);
    if (row) await ctx.db.patch("paperPdfReads", row._id, { had: true, at: Date.now() });
    else await ctx.db.insert("paperPdfReads", { scope, key, had: true, at: Date.now() });
    return null;
  },
});

/** Gives up a payment that didn't go through, so the next read pays. */
export const unclaim = internalMutation({
  args: { scope: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { scope, key }) => {
    const row = await readOf(ctx, scope, key);
    if (row && !row.had) await ctx.db.delete("paperPdfReads", row._id);
    return null;
  },
});

/** Records per scope one cleanup pass deletes. */
const FORGET_BATCH = 200;

/** Deletes a deleted chat's or extraction's records, a batch at a time. */
export const forget = internalMutation({
  args: { scope: v.string() },
  returns: v.null(),
  handler: async (ctx, { scope }) => {
    const rows = await ctx.db.query("paperPdfReads").withIndex("by_scope_and_key", (q) => q.eq("scope", scope)).take(FORGET_BATCH);
    for (const row of rows) await ctx.db.delete("paperPdfReads", row._id);
    if (rows.length === FORGET_BATCH) await ctx.scheduler.runAfter(0, internal.lib.paperPdfs.forget, { scope });
    return null;
  },
});

/** Claims the scope's payment for `key`, waiting while another read pays for it: true when it's this read's to pay, as it always is with no scope. */
async function claimed(ctx: ActionCtx, payer: PdfPayer, key: string) {
  const { scope } = payer;
  if (scope === undefined) return true;
  for (;;) {
    const state = await ctx.runMutation(internal.lib.paperPdfs.claim, { scope, key });
    if (state !== "wait") return state === "pay";
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
}

/** Notes that the scope has `key`, or gives up its payment for it: nothing for a read with no scope. */
const note = (ctx: ActionCtx, payer: PdfPayer, key: string) => (payer.scope === undefined ? null : ctx.runMutation(internal.lib.paperPdfs.had, { scope: payer.scope, key }));
const forgo = (ctx: ActionCtx, payer: PdfPayer, key: string) => (payer.scope === undefined ? null : ctx.runMutation(internal.lib.paperPdfs.unclaim, { scope: payer.scope, key }));

const NO_CREDITS = `There aren't enough credits for this paper's PDF (${PAPER_PDF_CREDITS} credits).`;

const hold = (ctx: ActionCtx, payer: PdfPayer, chargeId: string) => reserveCredits(ctx, { userId: payer.userId, workspaceId: payer.workspaceId, chargeId, credits: PAPER_PDF_CREDITS });

const charge = (ctx: ActionCtx, payer: PdfPayer, chargeId: string, usd: number) =>
  settleCredits(ctx, { userId: payer.userId, workspaceId: payer.workspaceId, chargeId, credits: convertUsdToCredits({ usd }), usage: { kind: payer.kind, description: "Paper PDF", costUsd: usd, ...(payer.jobId ? { jobId: payer.jobId } : {}) } });

/** A paper's PDF, from the store, its own links or OpenAlex, in that order (see the top of this file). */
export async function paperPdf(ctx: ActionCtx, payer: PdfPayer, paper: PaperRef, options: PdfOptions): Promise<PaperPdf> {
  for (const key of await paperKeys(paper)) {
    const size = await storedSize(key);
    if (size === null) continue;
    if (size > options.maxBytes) return { error: `This paper's PDF is too large to read here (${Math.ceil(size / 1_048_576)} MB).` };
    const bytes = options.bytes ? await readStored(key, options.maxBytes) : null;
    if (options.bytes && !bytes) continue;
    if (!(await claimed(ctx, payer, key))) return { bytes, key, from: "stored", credits: 0 };
    if (options.charge === "self") {
      const chargeId = `pdf:${payer.scope ?? crypto.randomUUID()}:${key}`;
      if (!(await hold(ctx, payer, chargeId))) {
        await forgo(ctx, payer, key);
        return { error: NO_CREDITS, credits: true };
      }
      await charge(ctx, payer, chargeId, PAPER_PDF_USD);
    }
    await note(ctx, payer, key);
    return { bytes, key, from: "stored", credits: PAPER_PDF_CREDITS };
  }

  const work = workOf(paper.openalexId);
  const workKey = work && !isZotero(paper) ? `openalex/${work}.pdf` : null;
  let failed = "This paper has no PDF address.";
  if (paper.url || paper.doi) {
    const { pdfBlob, error } = await downloadPdf(paper.url ?? "", { doi: paper.doi, zoteroConnection: paper.zotero, allowHttp: options.allowHttp, maxBytes: options.maxBytes, maxRetries: 1 });
    const bytes = pdfBlob ? new Uint8Array(await pdfBlob.arrayBuffer()) : null;
    if (bytes && isPdf(bytes)) {
      const key = isZotero(paper) ? null : await linkKey(paper.url);
      const kept = key !== null && (await keep(key, bytes));
      // A caller that sends the stored copy can't go on without one.
      if (!options.bytes && !kept) return { error: NOT_KEPT };
      // The scope fetched it for nothing, so a later read in it from the store is free too.
      if (kept) await note(ctx, payer, key);
      return { bytes, key: kept ? key : null, from: "link", credits: 0 };
    }
    failed = bytes ? "The paper's PDF address served something that isn't a PDF." : (error ?? "The paper's PDF couldn't be downloaded.");
  }

  if (!work || !workKey || paper.hasCopy === false) return { error: failed };
  if (!(await claimed(ctx, payer, workKey))) {
    // Another read in the scope bought it meanwhile, and kept it.
    const bytes = options.bytes ? await readStored(workKey, options.maxBytes) : null;
    return options.bytes && !bytes ? { error: failed } : { bytes, key: workKey, from: "stored", credits: 0 };
  }
  const chargeId = `pdf-buy:${payer.scope ?? crypto.randomUUID()}:${workKey}`;
  if (options.charge === "self" && !(await hold(ctx, payer, chargeId))) {
    await forgo(ctx, payer, workKey);
    return { error: NO_CREDITS, credits: true };
  }
  const bought = await fromOpenAlex(work, options.maxBytes).catch((error) => {
    console.error("[paper pdfs] buying OpenAlex's copy failed", { work, error: String(error) });
    return null;
  });
  if (!bought) {
    await Promise.all([options.charge === "self" ? releaseCredits(ctx, { chargeId }) : null, forgo(ctx, payer, workKey)]);
    return { error: failed };
  }
  if (!(await keep(workKey, bought.bytes)) && !options.bytes) {
    await Promise.all([options.charge === "self" ? releaseCredits(ctx, { chargeId }) : null, forgo(ctx, payer, workKey)]);
    return { error: NOT_KEPT };
  }
  if (options.charge === "self") await charge(ctx, payer, chargeId, bought.usd);
  await note(ctx, payer, workKey);
  return { bytes: options.bytes ? bought.bytes : null, key: workKey, from: "openalex", credits: convertUsdToCredits({ usd: bought.usd }) };
}
