"use client";

import { useTranslations } from "next-intl";
import { showStyledToast, customToast, dismissToast } from "@/components/ui/sonner";
import { showLoadingToast, type LoadingToastOptions } from "./core";
import { formatEntityName, formatEntityWithCount, formatOptionalLabel } from "./messages";
import {
  getToastMessageKeyForErrorCode,
  isInsufficientCreditsCode,
  resolveToastError,
} from "./error-resolver";

function openAISettings() {
  window.location.href = "/settings/ai";
}

function openBillingSettings() {
  window.location.href = "/settings/billing";
}

function getStatusCode(message: string): string | null {
  const statusMatch = message.match(/\b(\d{3})\b/);
  return statusMatch?.[1] ?? null;
}

function createEntityDescription(verb: string, label?: string): string | undefined {
  if (!label) return undefined;
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return undefined;
  if (trimmedLabel.includes(" ") || /[.!?]$/.test(trimmedLabel)) return trimmedLabel;
  const formattedLabel = formatOptionalLabel(trimmedLabel);
  if (!formattedLabel) return undefined;
  return `${formattedLabel} ${verb}.`;
}

export function useAppToast() {
  const t = useTranslations("toast");

  const resolveErrorDetails = (error: unknown, fallback: string) => {
    const resolved = resolveToastError(error, fallback);
    const mappedKey = getToastMessageKeyForErrorCode(resolved.code);
    return {
      code: resolved.code,
      message: mappedKey
        ? t(mappedKey)
        : resolved.isConvex
          ? t("convexUnknownError")
          : resolved.message,
    };
  };

  return {
    ai: {
      configRequired: (description?: string) => {
        showStyledToast("error", t("aiConfigRequired"), {
          description: description || t("aiConfigRequiredDescription"),
          action: {
            label: t("openAISettings"),
            onClick: openAISettings,
            icon: "settings" as const,
          },
        });
      },
      failed: (operation: string, error: unknown) => {
        const operationLabel = operation.trim() || t("aiOperation");
        const resolved = resolveErrorDetails(error, t("unexpectedError"));
        const action = isInsufficientCreditsCode(resolved.code)
          ? {
              label: t("openBilling"),
              onClick: openBillingSettings,
              icon: "arrow-right" as const,
            }
          : resolved.code === "AI_API_KEY_REQUIRED"
            ? {
                label: t("openAISettings"),
                onClick: openAISettings,
                icon: "settings" as const,
              }
            : undefined;
        showStyledToast("error", t("operationFailed", { operation: operationLabel }), {
          description: resolved.message,
          action,
        });
      },
      succeeded: (title: string, description?: string) => {
        showStyledToast("success", title, { description });
      },
    },
    search: {
      failed: (error: unknown) => {
        const { message } = resolveErrorDetails(error, t("unexpectedError"));
        const statusCode = getStatusCode(message);
        if (statusCode === "400") {
          showStyledToast("error", t("searchQueryTooLarge"), {
            description: t("searchQueryTooLargeDescription"),
          });
          return;
        }
        if (statusCode === "429") {
          showStyledToast("error", t("tooManyRequests"), {
            description: t("tooManyRequestsDescription"),
          });
          return;
        }
        showStyledToast("error", t("searchFailed"), { description: message });
      },
    },
    io: {
      downloadFailed: (formatLabel: string) => {
        showStyledToast("error", t("downloadFailed"), {
          description: t("downloadFailedDescription", { format: formatLabel }),
        });
      },
      uploadFailed: (formatLabel: string, error?: unknown) => {
        const { message } = resolveErrorDetails(
          error,
          t("uploadFailedDescription", { format: formatLabel }),
        );
        showStyledToast("error", t("uploadFailed"), {
          description: message,
        });
      },
      importResult: (entity: string, count: number) => {
        if (count > 0) {
          showStyledToast("success", t("importCompleted"), {
            description: t("importCompletedDescription", {
              count: formatEntityWithCount(entity, count),
            }),
          });
          return;
        }
        showStyledToast("warning", t("nothingImported"), {
          description: t("nothingImportedDescription", { entity }),
        });
      },
      downloadSuccess: (count: number, entity: string, format: string) => {
        showStyledToast("success", t("downloadSuccess"), {
          description: t("downloadSuccessDescription", {
            count: formatEntityWithCount(entity, count),
            format,
          }),
        });
      },
      uploadSuccess: (count: number, entity: string) => {
        showStyledToast("success", t("importCompleted"), {
          description: t("uploadSuccessDescription", {
            count: formatEntityWithCount(entity, count),
          }),
        });
      },
      uploadNoValid: (entity: string) => {
        showStyledToast("warning", t("nothingImported"), {
          description: t("nothingImportedDescription", { entity }),
        });
      },
    },
    clipboard: {
      copied: (thing: string) => {
        showStyledToast("success", t("thingCopied", { thing }), {
          description: t("copiedDescription"),
        });
      },
      copyFailed: (thing: string) => {
        showStyledToast("error", t("failedToCopyThing", { thing }), {
          description: t("copyFailedDescription"),
        });
      },
    },
    validation: {
      failed: (message: string) => {
        showStyledToast("error", t("validationFailed"), { description: message });
      },
      warning: (message: string) => {
        showStyledToast("warning", t("validationWarning"), { description: message });
      },
      fileType: (allowedTypes?: string) => {
        showStyledToast("error", t("fileTypeTitle"), {
          description: allowedTypes ? t("onlyFilesSupported", { allowedTypes }) : t("fileTypeNotSupported"),
        });
      },
      fileSize: (maxSizeMB: number) => {
        showStyledToast("error", t("fileSizeTitle"), {
          description: t("fileExceedsMaxSize", { maxSizeMB }),
        });
      },
    },
    entity: {
      created: (entity: string, label?: string) => {
        showStyledToast("success", t("entityCreated", { entity: formatEntityName(entity, t("entityItem")) }), {
          description: createEntityDescription("was created", label),
        });
      },
      updated: (entity: string, label?: string) => {
        showStyledToast("success", t("entityUpdated", { entity: formatEntityName(entity, t("entityItem")) }), {
          description: createEntityDescription("was updated", label),
        });
      },
      deleted: (entity: string, label?: string) => {
        showStyledToast("success", t("entityDeleted", { entity: formatEntityName(entity, t("entityItem")) }), {
          description: createEntityDescription("was deleted", label),
        });
      },
      cleared: (entity: string, count?: number) => {
        const description =
          typeof count === "number"
            ? t("clearedCount", { count: formatEntityWithCount(entity, count) })
            : undefined;
        showStyledToast("success", t("entityCleared", { entity: formatEntityName(entity, t("entityItem")) }), {
          description,
        });
      },
    },
    job: {
      cancelled: () => showStyledToast("success", t("jobCancelled")),
      cancelFailed: () => showStyledToast("error", t("jobCancelFailed")),
      deleted: () => showStyledToast("success", t("jobDeleted")),
      deleteFailed: () => showStyledToast("error", t("jobDeleteFailed")),
      created: () => showStyledToast("success", t("jobCreated")),
      createFailed: () => showStyledToast("error", t("jobCreateFailed")),
      duplicated: () => showStyledToast("success", t("jobDuplicated")),
      duplicateFailed: () => showStyledToast("error", t("jobDuplicateFailed")),
    },
    billing: {
      cancelled: () => showStyledToast("success", t("billingCancelled")),
      cancelFailed: () => showStyledToast("error", t("billingCancelFailed")),
      portalFailed: () => showStyledToast("error", t("billingPortalFailed")),
      checkoutFailed: () => showStyledToast("error", t("billingCheckoutFailed")),
    },
    zotero: {
      connected: () => showStyledToast("success", t("zoteroConnected")),
      failed: (error?: string) => {
        const { message } = resolveErrorDetails(error, t("zoteroConnectionFailed"));
        showStyledToast("error", t("zoteroConnectionFailed"), { description: message });
      },
    },
    success: (title: string, description?: string) => {
      showStyledToast("success", title, { description });
    },
    error: (title: string, description?: string, action?: { label: string; onClick: () => void; icon?: "settings" | "arrow-right" }) => {
      showStyledToast("error", title, { description, action });
    },
    warning: (title: string, description?: string) => {
      showStyledToast("warning", title, { description });
    },
    custom: customToast,
    dismiss: dismissToast,
    runWithLoading: async <T>(options: LoadingToastOptions<T>): Promise<T> => {
      const loadingToastId = showLoadingToast(options.loading);
      try {
        const result = await options.run();
        const successPayload = options.success?.(result);
        if (successPayload) {
          showStyledToast("success", successPayload.title, {
            description: successPayload.description,
          });
        }
        return result;
      } catch (error) {
        showStyledToast("error", options.error(error).title, {
          description: options.error(error).description,
        });
        throw error;
      } finally {
        dismissToast(loadingToastId);
      }
    },
  };
}
