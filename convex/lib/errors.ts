import { ConvexError } from "convex/values";

export type ErrorCode =
  // Generic auth/permission/data
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "EXTRACTION_PLAN_REQUIRED"
  | "FEATURE_DISABLED"
  | "FEATURE_PLAN_REQUIRED"
  | "NOT_FOUND"
  | "INSUFFICIENT_CREDITS"
  | "VALIDATION_ERROR"
  | "INVALID_DATA"
  | "CONFLICT"
  // AI
  | "AI_UNAUTHENTICATED"
  | "AI_INSUFFICIENT_CREDITS"
  | "AI_PLAN_ENTITLEMENT"
  | "AI_API_KEY_REQUIRED"
  | "AI_VALIDATION_ERROR"
  | "AI_PROVIDER_ERROR"
  | "AI_MAX_RETRIES_EXCEEDED"
  // API key management
  | "API_KEY_ENCRYPTION_KEY_INVALID"
  | "API_KEY_ENCRYPTED_FORMAT_INVALID"
  | "API_KEY_ENCRYPTION_KEY_MISSING"
  | "API_KEY_INVALID_FORMAT"
  // Credits/billing
  | "CREDITS_USER_NOT_FOUND"
  | "CREDITS_TOPUP_BUNDLE_INVALID"
  | "CREDITS_PRODUCT_NOT_CONFIGURED"
  | "BILLING_SUBSCRIPTION_DATA_INVALID"
  | "BILLING_INVALID_PRICE_ID"
  | "BILLING_FREE_PLAN_CHECKOUT_NOT_ALLOWED"
  | "BILLING_SUBSCRIPTION_ALREADY_EXISTS"
  | "BILLING_CUSTOMER_NOT_FOUND"
  | "BILLING_NO_SUBSCRIPTION_LINKED"
  | "BILLING_SUBSCRIPTION_PRICE_MISSING"
  | "BILLING_SUBSCRIPTION_INVALID"
  | "BILLING_AUTHENTICATION_FAILED"
  | "BILLING_NETWORK_ERROR"
  | "BILLING_RATE_LIMITED"
  | "BILLING_STRIPE_ERROR"
  | "BILLING_CANCEL_TO_FREE_REQUIRES_PORTAL"
  | "BILLING_NO_ACTIVE_SUBSCRIPTION"
  | "BILLING_SUBSCRIPTION_ITEM_NOT_FOUND"
  | "BILLING_PERIOD_END_UNAVAILABLE"
  | "BILLING_PLAN_CHANGE_CONFLICT"
  | "BILLING_CHARGE_FAILED"
  // Screening
  | "SCREENING_JOB_ALREADY_ACTIVE"
  | "SCREENING_JOB_NOT_FOUND"
  | "SCREENING_JOB_NOT_CANCELLABLE"
  // Batch AI actions (interactive batch lock)
  | "BATCH_ACTION_ALREADY_RUNNING"
  // Chat
  | "NO_SOURCES_INCLUDED"
  // Wallet API
  | "WALLET_KEY_INVALID"
  | "WALLET_KEY_REVOKED"
  | "WALLET_KEY_RATE_LIMITED"
  | "WALLET_INSUFFICIENT_CREDITS"
  | "WALLET_MODEL_NOT_ALLOWED"
  | "WALLET_INVALID_REQUEST"
  // Zotero/integrations
  | "ZOTERO_NOT_CONNECTED"
  | "ZOTERO_OAUTH_NOT_CONFIGURED"
  | "ZOTERO_REQUEST_TOKEN_FAILED"
  | "ZOTERO_INVALID_RESPONSE"
  | "ZOTERO_API_ERROR"
  // Evidence Library runtime
  | "EVIDENCE_LIBRARY_RUNTIME_ERROR";

export type ErrorData = { code: ErrorCode; message?: string };

export function createError(
  code: ErrorCode,
  message?: string,
  extra?: Record<string, unknown>,
): ConvexError<ErrorData> {
  const data: Record<string, unknown> = { code };
  if (message) data.message = message;
  if (extra) Object.assign(data, extra);
  return new ConvexError(data as ErrorData);
}

/** Convex serializes error data when one function calls another. */
export function readConvexErrorData(error: unknown): {code: string; message?: string} | null {
  if (!(error instanceof ConvexError)) return null;
  let data: unknown = error.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== "object" || !("code" in data) || typeof data.code !== "string") return null;
  return {code: data.code, ...("message" in data && typeof data.message === "string" ? {message: data.message} : {})};
}

/** A loggable message for any thrown value. */
export function errorToLogString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}
