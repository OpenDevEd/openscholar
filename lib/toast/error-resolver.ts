type ErrorRecord = Record<string, unknown>;

export type ToastErrorMessageKey =
  | "convexUnknownError"
  | "convexAuthRequired"
  | "convexPermissionDenied"
  | "extractionPlanRequired"
  | "convexNotFound"
  | "convexInvalidInput"
  | "convexInsufficientCredits"
  | "aiUnauthenticated"
  | "aiInsufficientCredits"
  | "aiCreditsDisabled"
  | "aiPlanEntitlement"
  | "aiApiKeyRequired"
  | "aiProviderError"
  | "aiValidationError"
  | "aiMaxRetriesExceeded"
  | "apiKeyInvalidFormat"
  | "apiKeyEncryptionMisconfigured"
  | "zoteroNotConnected"
  | "zoteroOauthNotConfigured"
  | "zoteroRequestTokenFailed"
  | "zoteroInvalidResponse"
  | "zoteroApiError"
  | "billingNoSubscriptionLinked"
  | "billingSubscriptionDataInvalid"
  | "billingSubscriptionInvalid"
  | "billingAuthenticationFailed"
  | "billingNetworkError"
  | "billingRateLimited"
  | "billingStripeError"
  | "billingPlanChangeConflict"
  | "billingInvalidPrice"
  | "billingCancelRequiresPortal"
  | "billingNoActiveSubscription"
  | "creditsTopupBundleInvalid"
  | "creditsProductMisconfigured";

export type ResolvedToastError = {
  code?: string;
  isConvex: boolean;
  message: string;
};

const CONVEX_MESSAGE_SIGNATURES = ["[CONVEX", "Called by client"] as const;

const LEGACY_CODE_MATCHERS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /\bAIInsufficientCreditsError\b/i, code: "AI_INSUFFICIENT_CREDITS" },
  { pattern: /\bAICreditsDisabledError\b/i, code: "AI_CREDITS_DISABLED" },
  { pattern: /\bAIUnauthenticatedError\b/i, code: "AI_UNAUTHENTICATED" },
  { pattern: /\bAIPlanEntitlementError\b/i, code: "AI_PLAN_ENTITLEMENT" },
  {
    pattern: /\bAIApiKeyRequiredError\b|\bAI_API_KEY_REQUIRED\b|\bAPI_KEY_REQUIRED\b/i,
    code: "AI_API_KEY_REQUIRED",
  },
  { pattern: /\bAIValidationError\b/i, code: "AI_VALIDATION_ERROR" },
  { pattern: /\bAIProviderError\b/i, code: "AI_PROVIDER_ERROR" },
  { pattern: /\bAIMaxRetriesExceededError\b/i, code: "AI_MAX_RETRIES_EXCEEDED" },
  { pattern: /insufficient credits for ai operation/i, code: "AI_INSUFFICIENT_CREDITS" },
  { pattern: /\bZotero not connected\b/i, code: "ZOTERO_NOT_CONNECTED" },
];

const MESSAGE_KEY_BY_CODE: Record<string, ToastErrorMessageKey> = {
  UNAUTHENTICATED: "convexAuthRequired",
  FORBIDDEN: "convexPermissionDenied",
  EXTRACTION_PLAN_REQUIRED: "extractionPlanRequired",
  NOT_FOUND: "convexNotFound",
  VALIDATION_ERROR: "convexInvalidInput",
  INVALID_DATA: "convexInvalidInput",
  INSUFFICIENT_CREDITS: "convexInsufficientCredits",
  AI_UNAUTHENTICATED: "aiUnauthenticated",
  AI_INSUFFICIENT_CREDITS: "aiInsufficientCredits",
  AI_CREDITS_DISABLED: "aiCreditsDisabled",
  AI_PLAN_ENTITLEMENT: "aiPlanEntitlement",
  AI_API_KEY_REQUIRED: "aiApiKeyRequired",
  AI_PROVIDER_ERROR: "aiProviderError",
  AI_VALIDATION_ERROR: "aiValidationError",
  AI_MAX_RETRIES_EXCEEDED: "aiMaxRetriesExceeded",
  API_KEY_INVALID_FORMAT: "apiKeyInvalidFormat",
  API_KEY_ENCRYPTION_KEY_INVALID: "apiKeyEncryptionMisconfigured",
  API_KEY_ENCRYPTED_FORMAT_INVALID: "apiKeyEncryptionMisconfigured",
  API_KEY_ENCRYPTION_KEY_MISSING: "apiKeyEncryptionMisconfigured",
  ZOTERO_NOT_CONNECTED: "zoteroNotConnected",
  ZOTERO_OAUTH_NOT_CONFIGURED: "zoteroOauthNotConfigured",
  ZOTERO_REQUEST_TOKEN_FAILED: "zoteroRequestTokenFailed",
  ZOTERO_INVALID_RESPONSE: "zoteroInvalidResponse",
  ZOTERO_API_ERROR: "zoteroApiError",
  BILLING_NO_SUBSCRIPTION_LINKED: "billingNoSubscriptionLinked",
  BILLING_SUBSCRIPTION_DATA_INVALID: "billingSubscriptionDataInvalid",
  BILLING_SUBSCRIPTION_PRICE_MISSING: "billingSubscriptionDataInvalid",
  BILLING_SUBSCRIPTION_INVALID: "billingSubscriptionInvalid",
  BILLING_AUTHENTICATION_FAILED: "billingAuthenticationFailed",
  BILLING_NETWORK_ERROR: "billingNetworkError",
  BILLING_RATE_LIMITED: "billingRateLimited",
  BILLING_STRIPE_ERROR: "billingStripeError",
  BILLING_PLAN_CHANGE_CONFLICT: "billingPlanChangeConflict",
  BILLING_INVALID_PRICE_ID: "billingInvalidPrice",
  BILLING_CANCEL_TO_FREE_REQUIRES_PORTAL: "billingCancelRequiresPortal",
  BILLING_NO_ACTIVE_SUBSCRIPTION: "billingNoActiveSubscription",
  BILLING_SUBSCRIPTION_ITEM_NOT_FOUND: "billingSubscriptionDataInvalid",
  BILLING_PERIOD_END_UNAVAILABLE: "billingSubscriptionDataInvalid",
  CREDITS_TOPUP_BUNDLE_INVALID: "creditsTopupBundleInvalid",
  CREDITS_PRODUCT_NOT_CONFIGURED: "creditsProductMisconfigured",
};

const INSUFFICIENT_CREDITS_CODES = new Set<string>([
  "AI_INSUFFICIENT_CREDITS",
  "INSUFFICIENT_CREDITS",
]);

const PLAN_UPGRADE_CODES = new Set<string>([
  "EXTRACTION_PLAN_REQUIRED",
  "AI_PLAN_ENTITLEMENT",
]);

function asRecord(value: unknown): ErrorRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as ErrorRecord;
}

function trimToString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readErrorData(error: unknown): unknown {
  const record = asRecord(error);
  if (!record) return undefined;
  return record.data;
}

function readRawMessage(error: unknown): string | undefined {
  const direct = trimToString(error);
  if (direct) return direct;

  if (error instanceof Error) {
    const fromError = trimToString(error.message);
    if (fromError) return fromError;
  }

  const record = asRecord(error);
  if (!record) return undefined;
  return trimToString(record.message);
}

function readMessageFromData(data: unknown): string | undefined {
  const dataMessage = trimToString(asRecord(data)?.message);
  if (dataMessage) return dataMessage;
  return trimToString(data);
}

function readCodeFromData(data: unknown): string | undefined {
  const code = trimToString(asRecord(data)?.code);
  if (code) return code;
  const stringData = trimToString(data);
  if (stringData && /^[A-Z0-9_]+$/.test(stringData)) {
    return stringData;
  }
  return undefined;
}

function readCodeFromError(error: unknown): string | undefined {
  const code = trimToString(asRecord(error)?.code);
  if (!code) return undefined;
  if (/^[A-Z0-9_]+$/.test(code)) {
    return code;
  }
  return undefined;
}

function sanitizeLegacyConvexMessage(message: string): string | undefined {
  const sanitized = message
    .replace(/\[CONVEX[^\]]*\]\s*/gi, "")
    .replace(/\[Request ID:[^\]]+\]\s*/gi, "")
    .replace(/^Server Error\s*/i, "")
    .replace(/^Uncaught\s*/i, "")
    .replace(/\s*Called by client\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

function hasConvexSignature(message?: string): boolean {
  if (!message) return false;
  return CONVEX_MESSAGE_SIGNATURES.some((signature) => message.includes(signature));
}

function inferLegacyCode(...messages: Array<string | undefined>): string | undefined {
  for (const message of messages) {
    if (!message) continue;
    for (const { pattern, code } of LEGACY_CODE_MATCHERS) {
      if (pattern.test(message)) {
        return code;
      }
    }
  }
  return undefined;
}

export function getToastMessageKeyForErrorCode(
  code?: string,
): ToastErrorMessageKey | undefined {
  if (!code) return undefined;
  return MESSAGE_KEY_BY_CODE[code];
}

export function isInsufficientCreditsCode(code?: string): boolean {
  if (!code) return false;
  return INSUFFICIENT_CREDITS_CODES.has(code);
}

export function isPlanUpgradeCode(code?: string): boolean {
  if (!code) return false;
  return PLAN_UPGRADE_CODES.has(code);
}

export function resolveToastError(error: unknown, fallback: string): ResolvedToastError {
  const data = readErrorData(error);
  const recordCode = readCodeFromError(error);
  const dataCode = readCodeFromData(data);
  const rawMessage = readRawMessage(error);
  const dataMessage = readMessageFromData(data);
  const sanitizedMessage = rawMessage ? sanitizeLegacyConvexMessage(rawMessage) : undefined;
  const inferredCode = inferLegacyCode(dataMessage, sanitizedMessage, rawMessage);
  const code = dataCode ?? recordCode ?? inferredCode;
  const isConvex = Boolean(dataCode || data !== undefined || hasConvexSignature(rawMessage));

  if (isConvex && !code) {
    return {
      code: undefined,
      isConvex: true,
      message: fallback,
    };
  }

  return {
    code,
    isConvex,
    message: dataMessage ?? sanitizedMessage ?? rawMessage ?? fallback,
  };
}
