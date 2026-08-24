import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import type { AdminLoginRedemptionResult } from "./adminLoginCodes";

const MACHINE_CREDENTIAL_PATTERN = /^els_[A-Za-z0-9_-]{43}$/;
const ADMIN_LOGIN_CODE_PATTERN = /^elc_[A-Za-z0-9_-]{43}$/;

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function readBearerCredential(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const credential = match?.[1];
  return credential && MACHINE_CREDENTIAL_PATTERN.test(credential)
    ? credential
    : null;
}

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
