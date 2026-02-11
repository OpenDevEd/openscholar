import { showStyledToast, customToast, dismissToast } from "@/components/ui/sonner";

import {
  showLoadingToast,
  type AppToastPayload,
  type LoadingToastOptions,
  type ToastAction,
  type ToastKind,
} from "./core";
import {
  TOAST_MESSAGES,
  formatEntityName,
  formatEntityWithCount,
  formatOptionalLabel,
} from "./messages";

function openAISettings() {
  window.location.href = "/settings/ai";
}

function createAISettingsAction(): ToastAction & { icon: "settings" } {
  return {
    label: TOAST_MESSAGES.ai.settingsActionLabel,
    onClick: openAISettings,
    icon: "settings" as const,
  };
}

function createEntityDescription(verb: string, label?: string): string | undefined {
  if (!label) {
    return undefined;
  }

  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    return undefined;
  }

  if (trimmedLabel.includes(" ") || /[.!?]$/.test(trimmedLabel)) {
    return trimmedLabel;
  }

  const formattedLabel = formatOptionalLabel(trimmedLabel);
  if (!formattedLabel) {
    return undefined;
  }

  return `${formattedLabel} ${verb}.`;
}

function getStatusCode(message: string): string | null {
  const statusMatch = message.match(/\b(\d{3})\b/);
  return statusMatch?.[1] ?? null;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

export async function runWithLoadingToast<T>(options: LoadingToastOptions<T>): Promise<T> {
  const loadingToastId = showLoadingToast(options.loading);

  try {
    const result = await options.run();
    const successPayload = options.success?.(result);

    if (successPayload) {
      showStyledToast("success", successPayload.title, { description: successPayload.description });
    }

    return result;
  } catch (error) {
    showStyledToast("error", options.error(error).title, { 
      description: options.error(error).description 
    });
    throw error;
  } finally {
    dismissToast(loadingToastId);
  }
}

type AppToastApi = {
  ai: {
    configRequired: (description?: string) => void;
    failed: (operation: string, error: unknown) => void;
    succeeded: (title: string, description?: string) => void;
  };
  search: { failed: (error: unknown) => void };
  io: {
    downloadFailed: (formatLabel: string) => void;
    uploadFailed: (formatLabel: string, error?: unknown) => void;
    importResult: (entity: string, count: number) => void;
  };
  clipboard: {
    copied: (thing: string) => void;
    copyFailed: (thing: string) => void;
  };
  validation: { failed: (message: string) => void; warning: (message: string) => void };
  entity: {
    created: (entity: string, label?: string) => void;
    updated: (entity: string, label?: string) => void;
    deleted: (entity: string, label?: string) => void;
    cleared: (entity: string, count?: number) => void;
  };
  custom: typeof customToast;
  dismiss: typeof dismissToast;
};

export const appToast: AppToastApi = {
  ai: {
    configRequired: (description?: string) => {
      showStyledToast("error", TOAST_MESSAGES.ai.configRequiredTitle, {
        description: description || TOAST_MESSAGES.ai.configRequiredDescription,
        action: createAISettingsAction(),
      });
    },
    failed: (operation: string, error: unknown) => {
      const operationLabel = operation.trim() || "AI operation";
      showStyledToast("error", `${operationLabel} failed`, {
        description: getErrorMessage(error, TOAST_MESSAGES.fallback.unexpectedError),
        action: createAISettingsAction(),
      });
    },
    succeeded: (title: string, description?: string) => {
      showStyledToast("success", title, { description });
    },
  },
  search: {
    failed: (error: unknown) => {
      const message = getErrorMessage(error, TOAST_MESSAGES.search.failedDescription);
      const statusCode = getStatusCode(message);

      if (statusCode === "400") {
        showStyledToast("error", TOAST_MESSAGES.search.queryTooLargeTitle, {
          description: TOAST_MESSAGES.search.queryTooLargeDescription,
        });
        return;
      }

      if (statusCode === "429") {
        showStyledToast("error", TOAST_MESSAGES.search.rateLimitedTitle, {
          description: TOAST_MESSAGES.search.rateLimitedDescription,
        });
        return;
      }

      showStyledToast("error", TOAST_MESSAGES.search.failedTitle, {
        description: message,
      });
    },
  },
  io: {
    downloadFailed: (formatLabel: string) => {
      showStyledToast("error", TOAST_MESSAGES.io.downloadFailedTitle, {
        description: `Could not download ${formatLabel}. Please try again.`,
      });
    },
    uploadFailed: (formatLabel: string, error?: unknown) => {
      showStyledToast("error", TOAST_MESSAGES.io.uploadFailedTitle, {
        description: getErrorMessage(
          error,
          `Could not upload ${formatLabel}. Please try again.`
        ),
      });
    },
    importResult: (entity: string, count: number) => {
      if (count > 0) {
        showStyledToast("success", TOAST_MESSAGES.io.importCompletedTitle, {
          description: `Successfully imported ${formatEntityWithCount(entity, count)}.`,
        });
        return;
      }

      showStyledToast("warning", TOAST_MESSAGES.io.importSkippedTitle, {
        description: `No valid ${entity} found in the file.`,
      });
    },
  },
  clipboard: {
    copied: (thing: string) => {
      showStyledToast("success", `${thing} copied`, {
        description: TOAST_MESSAGES.clipboard.copiedDescription,
      });
    },
    copyFailed: (thing: string) => {
      showStyledToast("error", `Failed to copy ${thing}`, {
        description: TOAST_MESSAGES.clipboard.copyFailedDescription,
      });
    },
  },
  validation: {
    failed: (message: string) => {
      showStyledToast("error", TOAST_MESSAGES.validation.failedTitle, {
        description: message,
      });
    },
    warning: (message: string) => {
      showStyledToast("warning", TOAST_MESSAGES.validation.warningTitle, {
        description: message,
      });
    },
  },
  entity: {
    created: (entity: string, label?: string) => {
      showStyledToast("success", `${formatEntityName(entity)} created`, {
        description: createEntityDescription("was created", label),
      });
    },
    updated: (entity: string, label?: string) => {
      showStyledToast("success", `${formatEntityName(entity)} updated`, {
        description: createEntityDescription("was updated", label),
      });
    },
    deleted: (entity: string, label?: string) => {
      showStyledToast("success", `${formatEntityName(entity)} deleted`, {
        description: createEntityDescription("was deleted", label),
      });
    },
    cleared: (entity: string, count?: number) => {
      const description =
        typeof count === "number"
          ? `Cleared ${formatEntityWithCount(entity, count)}.`
          : undefined;

      showStyledToast("success", `${formatEntityName(entity)} cleared`, {
        description,
      });
    },
  },
  custom: customToast,
  dismiss: dismissToast,
};

export type { ToastKind, ToastAction, AppToastPayload, LoadingToastOptions };
