import { z } from "zod";
import { readConvexErrorData } from "../lib/errors";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";

const associationBody = z.object({
  libraryId: z.string().min(1).max(128),
  itemKey: z.string().regex(/^[A-Z0-9]{8}$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  profileIds: z.array(z.string().min(1).max(128)).max(1000),
}).strict();

export const replacePublicationAssociations = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, {error: "invalid_service_credential"});
  const body = associationBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonResponse(400, {error: "invalid_request"});
  try {
    await ctx.runMutation(internal.authors.publications.replaceFromLibrary, {
      ...body.data, credentialDigest: await digestOpaqueToken(credential),
    });
    return jsonResponse(200, {ok: true});
  } catch (error) {
    const data = readConvexErrorData(error);
    if (data) {
      const code = data.code;
      if (code === "FORBIDDEN") return jsonResponse(403, {error: "invalid_service_credential"});
      if (code === "NOT_FOUND" || code === "VALIDATION_ERROR") return jsonResponse(400, {error: "invalid_request"});
    }
    console.error("Author association delivery failed", {libraryId: body.data.libraryId, itemKey: body.data.itemKey, error});
    return jsonResponse(503, {error: "association_update_failed"});
  }
});

const profileCatalogBody = z.discriminatedUnion("operation", [
  z.object({operation: z.literal("resolve"), libraryId: z.string().min(1).max(128), profileIds: z.array(z.string().min(1).max(128)).max(100)}).strict(),
  z.object({operation: z.literal("search"), libraryId: z.string().max(128), clerkUserId: z.string().max(512), search: z.string().max(200), paginationOpts: z.object({cursor: z.string().max(8192).nullable(), numItems: z.number().int().min(1).max(30)}).strict()}).strict(),
  z.object({operation: z.literal("create"), libraryId: z.string().max(128), clerkUserId: z.string().max(512), name: z.string().min(1).max(500)}).strict(),
]);

export const authorProfileCatalog = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, {error: "invalid_service_credential"});
  const body = profileCatalogBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonResponse(400, {error: "invalid_request"});
  try {
    const args = body.data;
    const credentialDigest = await digestOpaqueToken(credential);
    if (args.operation === "resolve") {
      const {operation: _operation, ...resolve} = args;
      return jsonResponse(200, {profiles: await ctx.runQuery(internal.authors.libraryCatalog.resolve, {...resolve, credentialDigest})});
    }
    if (args.operation === "search") {
      const {operation: _operation, ...search} = args;
      return jsonResponse(200, await ctx.runQuery(internal.authors.libraryCatalog.search, {...search, credentialDigest}));
    }
    const {operation: _operation, ...create} = args;
    const profile = await ctx.runMutation(internal.authors.libraryCatalog.create, {...create, credentialDigest});
    return jsonResponse(200, {profiles: [profile]});
  } catch (error) {
    const data = readConvexErrorData(error);
    if (data) {
      const code = data.code;
      const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code === "CONFLICT" ? 409 : code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" ? 400 : null;
      if (status) return jsonResponse(status, {error: typeof data.message === "string" ? data.message : "Unable to update author profile"});
    }
    console.error("Author profile catalog failed", {libraryId: body.data.libraryId, operation: body.data.operation, error});
    return jsonResponse(503, {error: "Author profiles are unavailable. Try again shortly."});
  }
});
