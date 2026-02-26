import { isInsufficientCreditsCode, isPlanUpgradeCode } from "./error-resolver";

export type ToastActionRoute =
  | "/settings/ai"
  | "/settings/billing"
  | "/pricing"
  | "/sign-in";

const SIGN_IN_CODES = new Set<string>(["UNAUTHENTICATED", "AI_UNAUTHENTICATED"]);

const AI_SETTINGS_CODES = new Set<string>([
  "AI_API_KEY_REQUIRED",
  "AI_PROVIDER_ERROR",
  "AI_VALIDATION_ERROR",
  "AI_MAX_RETRIES_EXCEEDED",
  "API_KEY_INVALID_FORMAT",
  "API_KEY_ENCRYPTION_KEY_INVALID",
  "API_KEY_ENCRYPTED_FORMAT_INVALID",
  "API_KEY_ENCRYPTION_KEY_MISSING",
]);

const BILLING_CODES = new Set<string>([
  "CREDITS_TOPUP_BUNDLE_INVALID",
  "CREDITS_PRODUCT_NOT_CONFIGURED",
]);

export function resolveToastActionRoute(code?: string): ToastActionRoute | undefined {
  if (!code) {
    return undefined;
  }

  if (SIGN_IN_CODES.has(code)) {
    return "/sign-in";
  }

  if (isInsufficientCreditsCode(code) || BILLING_CODES.has(code)) {
    return "/settings/billing";
  }

  if (isPlanUpgradeCode(code)) {
    return "/pricing";
  }

  if (AI_SETTINGS_CODES.has(code)) {
    return "/settings/ai";
  }

  return undefined;
}
