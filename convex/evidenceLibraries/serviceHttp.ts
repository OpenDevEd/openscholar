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

/** Machine-authenticated revalidation of an already signed runtime session. */
export const checkAdminSession = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, { error: "invalid_service_credential" });
  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: "invalid_request" }); }
  if (!body || typeof body !== "object" || !("libraryId" in body) || !("clerkUserId" in body) ||
    typeof body.libraryId !== "string" || typeof body.clerkUserId !== "string" ||
    body.libraryId.length > 128 || body.clerkUserId.length > 512 || !body.clerkUserId) {
    return jsonResponse(400, { error: "invalid_request" });
  }
  try {
    const result = await ctx.runQuery(internal.evidenceLibraries.sessionAccess.readSessionAccess, {
      libraryId: body.libraryId, clerkUserId: body.clerkUserId,
      credentialDigest: await digestOpaqueToken(credential),
    });
    return result ? jsonResponse(200, result) : jsonResponse(403, { error: "access_revoked" });
  } catch (error) {
    if (readConvexErrorData(error)?.code === "UNAUTHENTICATED") {
      return jsonResponse(401, { error: "invalid_service_credential" });
    }
    console.error("Library session check failed", {libraryId: body.libraryId, error});
    return jsonResponse(503, { error: "session_check_unavailable" });
  }
});
