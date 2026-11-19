// A community's runtime asks here for the current token of its owner's own Zenodo account (#1237,
// plans/zenodo-own-account-communities.md): Openscholar alone keeps and renews the account's tokens.
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { isCommunity } from "./paperLinks";

const bodySchema = z.object({ libraryId: z.string().min(1) }).strict();

export const zenodoToken: ReturnType<typeof httpAction> = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request", retryable: false } });
  const { libraryId } = parsed.data;
  if (!(await isCommunity(ctx, libraryId, credential))) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const owner = await ctx.runQuery(internal.evidenceLibraries.publicationProviders.zenodoOwnerOf, { libraryId: libraryId as Id<"evidenceLibraries"> });
  if (!owner) return jsonResponse(409, { error: { code: "zenodo_reconnect", retryable: false } });
  try {
    return jsonResponse(200, await ctx.runAction(internal.zenodo.connectionActions.tokenFor, { userId: owner }));
  } catch (error) {
    console.error(JSON.stringify({ event: "community-zenodo-token-refused", libraryId, error: String(error).slice(0, 300) }));
    // The owner's connection gone or refused is theirs to reconnect; Zenodo not answering is tried again.
    return String(error).includes("isn't connected") ? jsonResponse(409, { error: { code: "zenodo_reconnect", retryable: false } }) : jsonResponse(503, { error: { code: "temporarily_unavailable", retryable: true } });
  }
});
