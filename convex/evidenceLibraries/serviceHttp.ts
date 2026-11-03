import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { readConvexErrorData } from "../lib/errors";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { requireAppUrl } from "../lib/env";
import { z } from "zod";
import { HANDOFF_FIELDS_MAX, LIBRARY_SOURCE_RECORDS_MAX } from "./validators";

type LibraryUserRequest = { credential: string; libraryId: string; clerkUserId: string };

/**
 * The body every machine-authenticated question about one person carries:
 * `{libraryId, clerkUserId}` with the library's machine credential.
 */
async function readLibraryUserRequest(request: Request): Promise<LibraryUserRequest | Response> {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: "invalid_service_credential" });
  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: "invalid_request" }); }
  if (!body || typeof body !== "object" || !("libraryId" in body) || !("clerkUserId" in body) ||
    typeof body.libraryId !== "string" || typeof body.clerkUserId !== "string" ||
    body.libraryId.length > 128 || body.clerkUserId.length > 512 || !body.clerkUserId) {
    return jsonResponse(400, { error: "invalid_request" });
  }
  return { credential, libraryId: body.libraryId, clerkUserId: body.clerkUserId };
}

async function answerLibraryUserRequest(
  request: Request,
  label: string,
  answer: (input: { libraryId: string; clerkUserId: string; credentialDigest: string }) => Promise<Response>,
) {
  const input = await readLibraryUserRequest(request);
  if (input instanceof Response) return input;
  try {
    return await answer({
      libraryId: input.libraryId, clerkUserId: input.clerkUserId,
      credentialDigest: await digestOpaqueToken(input.credential),
    });
  } catch (error) {
    if (readConvexErrorData(error)?.code === "UNAUTHENTICATED") {
      return jsonResponse(401, { error: "invalid_service_credential" });
    }
    console.error(`${label} failed`, { libraryId: input.libraryId, error });
    return jsonResponse(503, { error: "session_check_unavailable" });
  }
}

/** Machine-authenticated revalidation of an already signed runtime session. */
export const checkAdminSession = httpAction(async (ctx, request) =>
  answerLibraryUserRequest(request, "Community session check", async (input) => {
    const result = await ctx.runQuery(internal.evidenceLibraries.sessionAccess.readSessionAccess, input);
    return "role" in result
      ? jsonResponse(200, { role: result.role })
      : jsonResponse(403, { error: "access_revoked", organisationName: result.organisationName });
  }));

/**
 * Whether a reader's OpenScholar account is active, deleted, or unknown here.
 * A library removes a reader's data only on `deleted`.
 */
export const checkReaderStatus = httpAction(async (ctx, request) =>
  answerLibraryUserRequest(request, "Community reader status check", async (input) =>
    jsonResponse(200, {
      status: await ctx.runQuery(internal.evidenceLibraries.sessionAccess.readReaderStatus, input),
    })));

/** Answers in the library sources contract (plans/evidence-library-sources): every answer, a refusal too, says the version it speaks. */
async function inContract(request: Request, answer: () => Promise<Response>) {
  const response = request.headers.get("OpenScholar-Contract") !== "1"
    ? jsonResponse(400, { error: "contract", message: "This OpenScholar speaks contract 1: send it in OpenScholar-Contract." })
    : await answer();
  response.headers.set("OpenScholar-Contract", "1");
  return response;
}

/**
 * A library tells OpenScholar a reader signed in, or is still there, so it is among their
 * libraries (./readers.ts).
 */
export const noteReaderSeen = httpAction(async (ctx, request) =>
  inContract(request, () =>
    answerLibraryUserRequest(request, "Community reader report", async (input) => {
      await ctx.runMutation(internal.evidenceLibraries.readers.seen, input);
      return new Response(null, { status: 204 });
    })));

const id = z.string().trim().min(1).max(200);
const handoffSchema = z.object({
  libraryId: z.string().max(128),
  clerkUserId: z.string().max(512).optional(),
  from: z.enum(["smartScreening", "search", "collection"]),
  source: z.union([
    z.strictObject({ records: z.array(id).min(1).max(LIBRARY_SOURCE_RECORDS_MAX) }),
    // As long a search as a library resolves (new-el src/lib/openscholar/library-reads.ts).
    z.strictObject({ search: z.string().max(8_000), readerCollection: id.optional() }),
    z.strictObject({ readerCollection: id }),
    z.strictObject({ libraryCollection: id }),
  ]),
  fields: z.array(z.object({ label: z.string().trim().min(1).max(200), type: z.enum(["string", "number", "boolean"]), description: z.string().trim().max(2_000) })).max(HANDOFF_FIELDS_MAX),
});

/** A library hands records, a search or a collection to OpenScholar for a reader (./handoffs.ts), and gets back where to send them. */
export const handOff = httpAction(async (ctx, request) =>
  inContract(request, async () => {
    const credential = readBearerCredential(request);
    if (!credential) {
      console.warn("[library sources]", { call: "handoffs", reason: "no machine credential" });
      return jsonResponse(401, { error: "invalid_service_credential" });
    }
    const parsed = handoffSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.warn("[library sources]", { call: "handoffs", reason: z.prettifyError(parsed.error) });
      return jsonResponse(400, { error: "invalid_request", message: z.prettifyError(parsed.error) });
    }
    const { libraryId, clerkUserId, ...handoff } = parsed.data;
    try {
      const app = requireAppUrl();
      const { handoffId, expiresAt } = await ctx.runMutation(internal.evidenceLibraries.handoffs.create, { libraryId, credentialDigest: await digestOpaqueToken(credential), ...handoff });
      return jsonResponse(201, { handoffId, url: `${app}/from-library/${handoffId}`, expiresAt });
    } catch (error) {
      const refused = readConvexErrorData(error)?.code === "UNAUTHENTICATED";
      console[refused ? "warn" : "error"]("[library sources]", { libraryId, call: "handoffs", reader: clerkUserId ?? null, reason: refused ? "invalid machine credential" : error });
      return refused ? jsonResponse(401, { error: "invalid_service_credential" }) : jsonResponse(503, { error: "handoff_unavailable" });
    }
  }));
