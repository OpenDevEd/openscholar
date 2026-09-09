import { z } from "zod";
import { ConvexError } from "convex/values";
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
    if (error instanceof ConvexError && typeof error.data === "object" && error.data) {
      const code = error.data.code;
      if (code === "FORBIDDEN") return jsonResponse(403, {error: "invalid_service_credential"});
      if (code === "NOT_FOUND" || code === "VALIDATION_ERROR") return jsonResponse(400, {error: "invalid_request"});
    }
    console.error("Author association delivery failed", {libraryId: body.data.libraryId, itemKey: body.data.itemKey, error});
    return jsonResponse(503, {error: "association_update_failed"});
  }
});
