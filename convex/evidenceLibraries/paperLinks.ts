import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { httpAction, type ActionCtx, type QueryCtx } from "../_generated/server";
import { internalQuery } from "../lib/functions";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { readWork } from "../paperSets/openalex";
import { normalDoi, openalexWork } from "../../lib/papers/paper-ref";
import { paperLinkOf } from "../../lib/papers/paper-links";
import { ADDED_PAPERS_MAX } from "../../lib/evidence-libraries/added-papers";

/** A paper as a community takes it: its OpenAlex work, its DOI, or both. */
export type PaperIds = { openalexId: string | null; doi: string | null };

const idsValidator = v.object({ openalexId: v.union(v.string(), v.null()), doi: v.union(v.string(), v.null()) });

/** The community that answers at an address: by where it runs, or by a domain of its own. */
async function libraryAt(ctx: QueryCtx, origin: string) {
  const binding = await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_targetBaseUrl", (q) => q.eq("targetBaseUrl", origin)).first();
  if (binding) return binding.libraryId;
  const domain = await ctx.db.query("evidenceLibraryDomains").withIndex("by_host", (q) => q.eq("host", new URL(origin).hostname)).unique();
  return domain?.libraryId ?? null;
}

/** The paper a community's published record is, as it told Openscholar; null for one it hasn't published, or no community there. */
export const recordPaper = internalQuery({
  args: { origin: v.string(), itemKey: v.string() },
  returns: v.union(idsValidator, v.null()),
  handler: async (ctx, { origin, itemKey }) => {
    const libraryId = await libraryAt(ctx, origin);
    const record = libraryId ? await ctx.db.query("topicLocations").withIndex("by_libraryId_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).unique() : null;
    return record?.state === "published" && (record.openalexId || record.doi) ? { openalexId: record.openalexId, doi: record.doi } : null;
  },
});

/**
 * The paper a pasted link names, as a community takes it: an OpenAlex work or DOI as given, a paper only our index has
 * by its OpenAlex work or DOI there, and a community's record by the paper it holds. Null when Openscholar finds none.
 * `spend` counts a read of our index against whoever asked.
 */
export async function paperOfLink(ctx: Pick<ActionCtx, "runQuery">, raw: string, spend: (pages: number) => Promise<boolean>): Promise<PaperIds | null> {
  const link = paperLinkOf(raw);
  if (!link) return null;
  if (link.kind === "work") return { openalexId: link.openalexId, doi: null };
  if (link.kind === "doi") return { openalexId: null, doi: link.doi };
  if (link.kind === "record") return await ctx.runQuery(internal.evidenceLibraries.paperLinks.recordPaper, { origin: link.origin, itemKey: link.itemKey });
  const work = await readWork<{ id?: string; doi?: string | null }>(link.work, "id,doi", spend, "openscholar").catch((error: unknown) => {
    console.error("[paper links] our index didn't answer", { work: link.work, error: String(error) });
    return null;
  });
  const ids = { openalexId: openalexWork(work?.id ?? ""), doi: normalDoi(work?.doi) };
  return ids.openalexId || ids.doi ? ids : null;
}

const resolveSchema = z
  .object({
    contractVersion: z.literal(1),
    libraryId: z.string().min(1).max(128),
    links: z.array(z.string().min(1).max(2048)).min(1).max(ADDED_PAPERS_MAX),
  })
  .strict();

/**
 * `POST /api/v1/evidence-libraries/papers/resolve`, for a community: the paper each link names that only Openscholar can
 * follow (its paper pages, a paper only our index has, another community's record), by its OpenAlex work and DOI, or
 * null. With the community's machine credential.
 */
export const resolvePapers: ReturnType<typeof httpAction> = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request", retryable: false } });
  const { libraryId, links } = parsed.data;
  try {
    await ctx.runQuery(internal.topics.serviceHttp.authenticate, { libraryId, credentialDigest: await digestOpaqueToken(credential) });
  } catch {
    return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  }
  // ponytail: a community's reads of our index aren't counted against anyone; at most ADDED_PAPERS_MAX a request, from a signed community.
  const papers = await Promise.all(links.map((link) => paperOfLink(ctx, link, async () => true)));
  return jsonResponse(200, { papers });
});
