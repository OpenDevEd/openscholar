import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { readConvexErrorData } from "../lib/errors";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import type { AdminLoginRedemptionResult } from "./adminLoginCodes";

const ADMIN_LOGIN_CODE_PATTERN = /^elc_[A-Za-z0-9_-]{43}$/;

function readRedemptionBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  return typeof body.libraryId === "string" &&
    typeof body.code === "string" &&
    ADMIN_LOGIN_CODE_PATTERN.test(body.code)
    ? { libraryId: body.libraryId, code: body.code }
    : null;
}

export const redeemAdminLoginCode = httpAction(async (ctx, request) => {
  const machineCredential = readBearerCredential(request);
  if (!machineCredential) {
    return jsonResponse(
      401,
      { error: "invalid_service_credential" },
      { "WWW-Authenticate": "Bearer" },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid_request" });
  }
  const body = readRedemptionBody(parsedBody);
  if (!body) return jsonResponse(400, { error: "invalid_request" });

  const [credentialDigest, codeDigest] = await Promise.all([
    digestOpaqueToken(machineCredential),
    digestOpaqueToken(body.code),
  ]);
  const result: AdminLoginRedemptionResult = await ctx.runMutation(
    internal.evidenceLibraries.adminLoginCodes.redeemCode,
    {
      libraryId: body.libraryId,
      credentialDigest,
      codeDigest,
    },
  );
  if (result.kind === "invalid_request") {
    return jsonResponse(400, { error: "invalid_request" });
  }
  if (result.kind === "invalid_credential") {
    return jsonResponse(
      401,
      { error: "invalid_service_credential" },
      { "WWW-Authenticate": "Bearer" },
    );
  }
  if (result.kind === "invalid_code") {
    return jsonResponse(400, { error: "invalid_login_code" });
  }
  return jsonResponse(200, {
    libraryId: result.libraryId,
    clerkUserId: result.clerkUserId,
    clerkOrganizationId: result.clerkOrganizationId,
    role: result.role,
    consumedAt: result.consumedAt,
  });
});

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
  answerLibraryUserRequest(request, "Library session check", async (input) => {
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
  answerLibraryUserRequest(request, "Library reader status check", async (input) =>
    jsonResponse(200, {
      status: await ctx.runQuery(internal.evidenceLibraries.sessionAccess.readReaderStatus, input),
    })));
