import type { AIKeyMode } from "@/lib/types";
import {
  resolveCreditsAvailability,
  type CreditsAvailability,
  type CreditsSettlement,
} from "@/lib/credits/availability";

export {
  resolveCreditsAvailability,
  type CreditsAvailability,
  type CreditsSettlement,
};
export type AIExecutionTarget = "local" | "credits";
export type AIExecutionErrorReason =
  | "api_key_required"
  | "insufficient_credits"
  | "credits_disabled";

export type AIExecutionDecision =
  | {
      type: "execute";
      target: AIExecutionTarget;
    }
  | {
      type: "error";
      reason: AIExecutionErrorReason;
    };

type ModeRoutingInput = {
  mode: AIKeyMode;
  hasApiKey: boolean;
  creditsEnabled: boolean;
  isAuthenticated: boolean;
};

type ExecutionRoutingInput = ModeRoutingInput & {
  creditsAvailability: CreditsAvailability;
};

type ErrorRecord = Record<string, unknown>;

const SMART_FALLBACK_ERROR_CODES = new Set<string>([
  "AI_UNAUTHENTICATED",
  "UNAUTHENTICATED",
  "AI_INSUFFICIENT_CREDITS",
  "INSUFFICIENT_CREDITS",
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

export function resolveModeConfigurability({
  mode,
  hasApiKey,
  creditsEnabled,
  isAuthenticated,
}: ModeRoutingInput): boolean {
  if (mode === "local") {
    return hasApiKey;
  }
  if (mode === "credits") {
    return true;
  }
  return hasApiKey || (creditsEnabled && isAuthenticated);
}

export function resolveExecutionDecision({
  mode,
  hasApiKey,
  creditsEnabled,
  isAuthenticated,
  creditsAvailability,
}: ExecutionRoutingInput): AIExecutionDecision {
  if (mode === "local") {
    if (!hasApiKey) {
      return { type: "error", reason: "api_key_required" };
    }
    return { type: "execute", target: "local" };
  }

  if (mode === "credits") {
    if (!creditsEnabled) {
      return { type: "error", reason: "credits_disabled" };
    }
    return { type: "execute", target: "credits" };
  }

  if (!isAuthenticated) {
    if (!hasApiKey) {
      return { type: "error", reason: "api_key_required" };
    }
    return { type: "execute", target: "local" };
  }

  if (!creditsEnabled) {
    if (!hasApiKey) {
      return { type: "error", reason: "api_key_required" };
    }
    return { type: "execute", target: "local" };
  }

  if (creditsAvailability === "unavailable") {
    if (!hasApiKey) {
      return { type: "error", reason: "insufficient_credits" };
    }
    return { type: "execute", target: "local" };
  }

  return { type: "execute", target: "credits" };
}

export function resolveErrorCode(error: unknown): string | undefined {
  const record = asRecord(error);
  const dataRecord = asRecord(record?.data);

  const dataCode = trimToString(dataRecord?.code);
  if (dataCode) return dataCode;

  const recordCode = trimToString(record?.code);
  if (recordCode) return recordCode;

  const dataText = trimToString(record?.data);
  if (dataText && /^[A-Z0-9_]+$/.test(dataText)) {
    return dataText;
  }

  return undefined;
}

export function shouldRetrySmartWithLocalFallback({
  mode,
  hasApiKey,
  errorCode,
}: {
  mode: AIKeyMode;
  hasApiKey: boolean;
  errorCode?: string;
}): boolean {
  if (mode !== "smart" || !hasApiKey || !errorCode) {
    return false;
  }
  return SMART_FALLBACK_ERROR_CODES.has(errorCode);
}
