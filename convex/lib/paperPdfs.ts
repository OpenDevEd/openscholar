/**
 * Every paper PDF the assistant and extraction download is kept in Cloudflare R2 (bucket `openscholar-paper-pdfs`),
 * never deleted, and read from there first. `paperPdf` gets one, in this order:
 *
 *   1. the copy in R2: billed STORED_PDF_CREDITS, once per chat or per extraction (`PdfPayer.scope`)
 *   2. the paper's own links (lib/pdf/download.ts): free, and the file is kept in R2
 *   3. OpenAlex's cached copy (content.openalex.org): billed what OpenAlex charged, and kept in R2
 *
 * A copy is keyed by the paper's OpenAlex ID, else its DOI, else its link. A file from a person's own Zotero
 * library is theirs alone: it never goes into the store, and the store is never read for it.
 */
import { AwsClient } from "aws4fetch";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { releaseCredits, reserveCredits, settleCredits } from "../billing/charge";
import type { UsageKind } from "../billing/validators";
import { internalMutation } from "./functions";
import { downloadPdf, type DownloadPdfOptions } from "../../lib/pdf/download";
import { MAX_PDF_BYTES } from "../../lib/files/limits";
import { convertUsdToCredits } from "../../lib/pricing";

/** What OpenAlex charges for one cached PDF: $10 per 1,000 downloads (help.openalex.org/access/example-costs). */
const OPENALEX_PDF_USD = 0.01;
/** What one OpenAlex credit costs, as its responses report a request's cost in credits. */
const OPENALEX_CREDIT_USD = 0.0001;
/** A copy read from the store costs what OpenAlex charges for one. */
export const STORED_PDF_CREDITS = convertUsdToCredits({ usd: OPENALEX_PDF_USD });
/** How long a link to a stored copy, given to a model's provider to fetch, lasts. */
const LINK_SECONDS = 3_600;

/** Who pays for a paper's PDF, and what it is read for: one charge for a paper in each `scope`, a chat's or an extraction's. */
export type PdfPayer = { userId: Id<"users">; workspaceId: Id<"workspaces">; scope: string; kind: UsageKind; jobId?: Id<"extractionJobs"> };
/** A paper by what names it. `hasCopy` is OpenAlex's `has_content.pdf`, where the caller read it: false skips buying a copy OpenAlex doesn't have. */
export type PaperRef = { openalexId?: string; doi?: string; url?: string; hasCopy?: boolean; zotero?: DownloadPdfOptions["zoteroConnection"] };
/** The PDF and where it came from, or why there's none: `credits` when the person can't pay for it. */
export type PaperPdf = { bytes: Uint8Array; key: string | null; from: "stored" | "link" | "openalex" } | { error: string; credits?: true };

function store() {
  const { PAPER_PDFS_ENDPOINT: endpoint, PAPER_PDFS_BUCKET: bucket, PAPER_PDFS_ACCESS_KEY_ID: accessKeyId, PAPER_PDFS_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("PAPER_PDFS_ENDPOINT, PAPER_PDFS_BUCKET, PAPER_PDFS_ACCESS_KEY_ID and PAPER_PDFS_SECRET_ACCESS_KEY must be set for the paper PDF store.");
  return { client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }), url: (key: string) => `${endpoint.replace(/\/$/, "")}/${bucket}/${key}` };
}

/** The OpenAlex work ID in an ID or address, such as W2741809807; extraction gives papers from elsewhere IDs of their own. */
const workOf = (id: string | undefined) => id?.match(/(?:^|\/)(W\d+)$/i)?.[1]?.toUpperCase();

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF");

/** Where a paper's copy is kept, or null for one that never is: a file from a person's Zotero library, or a paper with nothing to name it by. */
export async function paperKey({ openalexId, doi, url }: PaperRef): Promise<string | null> {
  if (url?.startsWith("zotero://")) return null;
  const work = workOf(openalexId);
  if (work) return `openalex/${work}.pdf`;
  const id = doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim().toLowerCase();
  if (id) return `doi/${encodeURIComponent(id)}.pdf`;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
  return `url/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}.pdf`;
}

/** The stored copy, or null when there is none. */
export async function readStored(key: string): Promise<Uint8Array | null> {
  const { client, url } = store();
  const response = await client.fetch(url(key));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The paper PDF store answered ${response.status} reading ${key}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function keep(key: string, bytes: Uint8Array) {
  const { client, url } = store();
  const response = await client.fetch(url(key), { method: "PUT", body: new Blob([bytes.slice()]), headers: { "Content-Type": "application/pdf" } });
  if (!response.ok) throw new Error(`The paper PDF store answered ${response.status} keeping ${key}.`);
}

/** A link a model's provider can fetch the stored copy from, for an hour. */
export async function storedLink(key: string) {
  const { client, url } = store();
  return (await client.sign(`${url(key)}?X-Amz-Expires=${LINK_SECONDS}`, { method: "GET", aws: { signQuery: true } })).url;
}

/** OpenAlex's cached copy of a work, with what it cost in dollars as OpenAlex reports it, or null when it has none. */
async function fromOpenAlex(work: string): Promise<{ bytes: Uint8Array; usd: number } | null> {
  const apiKey = process.env.OPENALEX_API_KEY;
  if (!apiKey) throw new Error("OPENALEX_API_KEY must be set to buy OpenAlex's copy of a paper.");
  const response = await fetch(`https://content.openalex.org/works/${work}.pdf?api_key=${encodeURIComponent(apiKey)}`, { headers: { "User-Agent": "OpenScholar (https://openscholar.ai)" } });
  const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  if (!bytes || bytes.length > MAX_PDF_BYTES || !isPdf(bytes)) {
    console.warn("[paper pdfs] OpenAlex has no copy to download", { work, status: response.status });
    return null;
  }
  const credits = Number(response.headers.get("x-ratelimit-credits-used"));
  return { bytes, usd: Number.isFinite(credits) && credits > 0 ? credits * OPENALEX_CREDIT_USD : OPENALEX_PDF_USD };
}

/** Notes that `scope` has had `key`: true the first time, when it's the scope's to pay for. */
export const claim = internalMutation({
  args: { scope: v.string(), key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { scope, key }) => {
    if (await ctx.db.query("paperPdfReads").withIndex("by_scope_and_key", (q) => q.eq("scope", scope).eq("key", key)).unique()) return false;
    await ctx.db.insert("paperPdfReads", { scope, key });
    return true;
  },
});

/** Takes back a claim whose charge didn't go through, so the next read pays. */
export const unclaim = internalMutation({
  args: { scope: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { scope, key }) => {
    const row = await ctx.db.query("paperPdfReads").withIndex("by_scope_and_key", (q) => q.eq("scope", scope).eq("key", key)).unique();
    if (row) await ctx.db.delete("paperPdfReads", row._id);
    return null;
  },
});

/** Holds `usd` worth of credits for the scope's first read of `key`. False when the person can't cover it; null when the scope has paid for it already. */
async function holdFirst(ctx: ActionCtx, payer: PdfPayer, key: string, chargeId: string, usd: number) {
  if (!(await ctx.runMutation(internal.lib.paperPdfs.claim, { scope: payer.scope, key }))) return null;
  if (await reserveCredits(ctx, { userId: payer.userId, workspaceId: payer.workspaceId, chargeId, credits: convertUsdToCredits({ usd }) })) return true;
  await ctx.runMutation(internal.lib.paperPdfs.unclaim, { scope: payer.scope, key });
  return false;
}

const settle = (ctx: ActionCtx, payer: PdfPayer, chargeId: string, usd: number) =>
  settleCredits(ctx, { userId: payer.userId, workspaceId: payer.workspaceId, chargeId, credits: convertUsdToCredits({ usd }), usage: { kind: payer.kind, description: "Paper PDF", costUsd: usd, ...(payer.jobId ? { jobId: payer.jobId } : {}) } });

const NO_CREDITS = `There aren't enough credits for this paper's PDF (${STORED_PDF_CREDITS} credits).`;

/** A paper's PDF, from the store, its own links or OpenAlex, in that order (see the top of this file). */
export async function paperPdf(ctx: ActionCtx, payer: PdfPayer, paper: PaperRef): Promise<PaperPdf> {
  const key = await paperKey(paper);
  if (key) {
    const stored = await readStored(key);
    if (stored) {
      const chargeId = `pdf:${payer.scope}:${key}`;
      const held = await holdFirst(ctx, payer, key, chargeId, OPENALEX_PDF_USD);
      if (held === false) return { error: NO_CREDITS, credits: true };
      if (held) await settle(ctx, payer, chargeId, OPENALEX_PDF_USD);
      return { bytes: stored, key, from: "stored" };
    }
  }
  let failed = "This paper has no PDF address.";
  if (paper.url) {
    const { pdfBlob, error } = await downloadPdf(paper.url, { doi: paper.doi, zoteroConnection: paper.zotero, allowHttp: true, maxRetries: 1 });
    const bytes = pdfBlob ? new Uint8Array(await pdfBlob.arrayBuffer()) : null;
    if (bytes && isPdf(bytes)) {
      // The scope fetched it for nothing, so a later read in it from the store is free too.
      if (key) await Promise.all([keep(key, bytes), ctx.runMutation(internal.lib.paperPdfs.claim, { scope: payer.scope, key })]);
      return { bytes, key, from: "link" };
    }
    failed = bytes ? "The paper's PDF address served something that isn't a PDF." : (error ?? "The paper's PDF couldn't be downloaded.");
  }
  const work = workOf(paper.openalexId);
  if (!key || !work || paper.hasCopy === false) return { error: failed };
  const chargeId = `pdf-buy:${payer.scope}:${key}`;
  const held = await holdFirst(ctx, payer, key, chargeId, OPENALEX_PDF_USD);
  if (held === false) return { error: NO_CREDITS, credits: true };
  const bought = await fromOpenAlex(work).catch((error) => {
    console.error("[paper pdfs] buying OpenAlex's copy failed", { work, error: String(error) });
    return null;
  });
  if (!bought) {
    if (held) await Promise.all([releaseCredits(ctx, { chargeId }), ctx.runMutation(internal.lib.paperPdfs.unclaim, { scope: payer.scope, key })]);
    return { error: failed };
  }
  await keep(key, bought.bytes);
  if (held) await settle(ctx, payer, chargeId, bought.usd);
  return { bytes: bought.bytes, key, from: "openalex" };
}
