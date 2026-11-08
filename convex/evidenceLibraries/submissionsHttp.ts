import { z } from "zod";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { readConvexErrorData } from "../lib/errors";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";

/** What a community says of a paper sent to it (new-el #778), with its machine credential. */
const statusSchema = z
  .object({
    contractVersion: z.literal(1),
    idempotencyKey: z.string().min(1).max(256),
    libraryId: z.string().min(1).max(128),
    itemKey: z.string().min(1).max(64),
    generation: z.number().int().positive(),
    clerkUserId: z.string().min(1).max(128),
    status: z.enum(["queued", "published", "returned", "withdrawn"]),
    note: z.string().max(4000).nullable(),
    at: z.string().datetime({ offset: true }),
    /** What the paper is, so one sent from the community's own site becomes the person's submission here. */
    paper: z
      .object({
        title: z.string().min(1).max(1000),
        authors: z.string().max(2000),
        year: z.number().int().nullable(),
        openalexId: z.string().max(64).nullable(),
        doi: z.string().max(512).nullable(),
        /** The request that sent it this time, which Openscholar's own sends name the same way. */
        requestId: z.string().min(1).max(128).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** `POST /api/v1/evidence-libraries/paper-submissions`: answers with the change's key and generation once it's kept. */
export const paperSubmissionStatus: ReturnType<typeof httpAction> = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: { code: "invalid_service_credential", retryable: false } });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request", retryable: false } });
  const { idempotencyKey, libraryId, itemKey, generation, clerkUserId, status, note, at, paper } = parsed.data;
  try {
    await ctx.runMutation(internal.evidenceLibraries.submissions.applyStatus, { libraryId, credentialDigest: await digestOpaqueToken(credential), itemKey, generation, clerkUserId, status, note, at: Date.parse(at), ...(paper ? { paper } : {}) });
    return jsonResponse(200, { idempotencyKey, generation });
  } catch (error) {
    const code = readConvexErrorData(error)?.code;
    const statusCode = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code === "VALIDATION_ERROR" ? 400 : 503;
    console.error("[paper submissions] status failed", { libraryId, itemKey, generation, error: String(error) });
    return jsonResponse(statusCode, { error: { code: code ?? "temporarily_unavailable", retryable: statusCode === 503 } });
  }
});
