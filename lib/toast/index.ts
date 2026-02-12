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
    downloadSuccess: (count: number, entity: string, format: string) => void;
    uploadSuccess: (count: number, entity: string) => void;
    uploadNoValid: (entity: string) => void;
  };
  clipboard: {
    copied: (thing: string) => void;
    copyFailed: (thing: string) => void;
  };
  validation: { 
    failed: (message: string) => void; 
    warning: (message: string) => void;
    fileType: (allowedTypes?: string) => void;
    fileSize: (maxSizeMB: number) => void;
  };
  entity: {
    created: (entity: string, label?: string) => void;
    updated: (entity: string, label?: string) => void;
    deleted: (entity: string, label?: string) => void;
    cleared: (entity: string, count?: number) => void;
  };
  job: {
    cancelled: () => void;
    cancelFailed: () => void;
    deleted: () => void;
    deleteFailed: () => void;
    created: () => void;
    createFailed: () => void;
    duplicated: () => void;
    duplicateFailed: () => void;
  };
  billing: {
    cancelled: () => void;
    cancelFailed: () => void;
    portalFailed: () => void;
    checkoutFailed: () => void;
  };
  zotero: {
    connected: () => void;
    failed: (error?: string) => void;
  };
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string, action?: ToastAction) => void;
  warning: (title: string, description?: string) => void;
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
    downloadSuccess: (count: number, entity: string, format: string) => {
      showStyledToast("success", TOAST_MESSAGES.io.downloadSuccessTitle, {
        description: `Downloaded ${formatEntityWithCount(entity, count)} as ${format}.`,
      });
    },
    uploadSuccess: (count: number, entity: string) => {
      showStyledToast("success", TOAST_MESSAGES.io.importCompletedTitle, {
        description: `Successfully imported ${formatEntityWithCount(entity, count)}.`,
      });
    },
    uploadNoValid: (entity: string) => {
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
    fileType: (allowedTypes?: string) => {
      showStyledToast("error", TOAST_MESSAGES.validation.fileTypeTitle, {
        description: allowedTypes ? `Only ${allowedTypes} files are supported.` : "File type not supported.",
      });
    },
    fileSize: (maxSizeMB: number) => {
      showStyledToast("error", TOAST_MESSAGES.validation.fileSizeTitle, {
        description: `File exceeds the maximum size of ${maxSizeMB}MB.`,
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
  job: {
    cancelled: () => {
      showStyledToast("success", TOAST_MESSAGES.job.cancelledTitle);
    },
    cancelFailed: () => {
      showStyledToast("error", TOAST_MESSAGES.job.cancelFailedTitle);
    },
    deleted: () => {
      showStyledToast("success", TOAST_MESSAGES.job.deletedTitle);
    },
    deleteFailed: () => {
      showStyledToast("error", TOAST_MESSAGES.job.deleteFailedTitle);
    },
    created: () => {
      showStyledToast("success", TOAST_MESSAGES.job.createdTitle);
    },
    createFailed: () => {
      showStyledToast("error", TOAST_MESSAGES.job.createFailedTitle);
    },
    duplicated: () => {
      showStyledToast("success", TOAST_MESSAGES.job.duplicatedTitle);
    },
    duplicateFailed: () => {
      showStyledToast("error", TOAST_MESSAGES.job.duplicateFailedTitle);
    },
  },
  billing: {
    cancelled: () => {
      showStyledToast("success", TOAST_MESSAGES.billing.cancelledTitle);
    },
    cancelFailed: () => {
      showStyledToast("error", TOAST_MESSAGES.billing.cancelFailedTitle);
    },
    portalFailed: () => {
      showStyledToast("error", TOAST_MESSAGES.billing.portalFailedTitle);
    },
    checkoutFailed: () => {
      showStyledToast("error", TOAST_MESSAGES.billing.checkoutFailedTitle);
    },
  },
  zotero: {
    connected: () => {
      showStyledToast("success", TOAST_MESSAGES.zotero.connectedTitle);
    },
    failed: (error?: string) => {
      showStyledToast("error", TOAST_MESSAGES.zotero.connectionFailedTitle, {
        description: error,
      });
    },
  },
  success: (title: string, description?: string) => {
    showStyledToast("success", title, { description });
  },
  error: (title: string, description?: string, action?: ToastAction) => {
    showStyledToast("error", title, { description, action });
  },
  warning: (title: string, description?: string) => {
    showStyledToast("warning", title, { description });
  },
  custom: customToast,
  dismiss: dismissToast,
};

export { useAppToast } from "./use-app-toast";
export type { ToastKind, ToastAction, AppToastPayload, LoadingToastOptions };
