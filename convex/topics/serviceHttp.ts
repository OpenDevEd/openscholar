import { z } from "zod";
import { httpAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { topicAssociationRequestSchema, topicCatalogRequestSchema, topicDetailRequestSchema } from "../../lib/topics/contract";
import { readConvexErrorData } from "../lib/errors";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { ensureCatalog } from "./catalog";
import { readTopicDetail } from "./details";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";

function endpoint<T extends {libraryId: string}>(operation: string, schema: z.ZodType<T>, run: (ctx: ActionCtx, body: T, digest: string) => Promise<Record<string, unknown>>): ReturnType<typeof httpAction> {
  return httpAction(async (ctx, request) => {
    const credential = readBearerCredential(request);
    if (!credential) return jsonResponse(401, {error: {code: "invalid_service_credential", retryable: false}});
    const text = await request.text();
    if (text.length > 512_000) return jsonResponse(400, {error: {code: "invalid_request", retryable: false}});
    let raw: unknown;
    try {raw = JSON.parse(text);} catch {return jsonResponse(400, {error: {code: "invalid_request", retryable: false}});}
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return jsonResponse(400, {error: {code: "invalid_request", retryable: false}});
    try {return jsonResponse(200, await run(ctx, parsed.data, await digestOpaqueToken(credential)));}
    catch (error) {
      const code = readConvexErrorData(error)?.code;
      const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : code === "CONFLICT" ? 409 : code === "VALIDATION_ERROR" ? 400 : 503;
      console.error("Topic service request failed", {operation, libraryId: parsed.data.libraryId, request: "itemKey" in parsed.data ? parsed.data.itemKey : "topicId" in parsed.data ? parsed.data.topicId : null, error});
      return jsonResponse(status, {error: {code: code ?? "temporarily_unavailable", retryable: status === 503}});
    }
  });
}
export const catalog: ReturnType<typeof httpAction> = endpoint("catalog", topicCatalogRequestSchema, async (ctx, body, credentialDigest): Promise<Record<string, unknown>> => {
  // Authenticate before any setup work.
  await ctx.runQuery(internal.topics.serviceHttp.authenticate, {libraryId: body.libraryId, credentialDigest});
  await ensureCatalog(ctx);
  return ctx.runQuery(internal.topics.catalog.serviceBrowse, {body: JSON.stringify(body), credentialDigest});
});
export const detail: ReturnType<typeof httpAction> = endpoint("detail", topicDetailRequestSchema, async (ctx, body, credentialDigest): Promise<Record<string, unknown>> => {
  await ctx.runQuery(internal.topics.serviceHttp.authenticate, {libraryId: body.libraryId, credentialDigest});
  await ensureCatalog(ctx);
  return readTopicDetail(ctx, {id: body.topicId, libraryId: body.libraryId});
});
export const associations: ReturnType<typeof httpAction> = endpoint("associations", topicAssociationRequestSchema, async (ctx, body, credentialDigest): Promise<Record<string, unknown>> => {
  await ctx.runQuery(internal.topics.serviceHttp.authenticate, {libraryId: body.libraryId, credentialDigest});
  await ensureCatalog(ctx);
  return ctx.runMutation(internal.topics.publications.replaceFromLibrary, {body: JSON.stringify(body), credentialDigest});
});
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { authenticate as authenticateService } from "./auth";
export const authenticate = internalQuery({args: {libraryId: v.string(), credentialDigest: v.string()}, handler: async (ctx, args) => {await authenticateService(ctx, args.libraryId, args.credentialDigest); return null;}});
