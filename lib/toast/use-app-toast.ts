"use client";

import { useTranslations } from "next-intl";
import { showStyledToast, customToast, dismissToast } from "@/components/ui/sonner";
import { showLoadingToast, type LoadingToastOptions } from "./core";
import { formatEntityName, formatEntityWithCount, formatOptionalLabel } from "./messages";

function openAISettings() {
  window.location.href = "/settings/ai";
}

function getErrorMessage(error: unknown, fallback: string): string {
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
        const operationLabel = operation.trim() || "AI operation";
        showStyledToast("error", t("operationFailed", { operation: operationLabel }), {
          description: getErrorMessage(error, t("unexpectedError")),
          action: {
            label: t("openAISettings"),
            onClick: openAISettings,
            icon: "settings" as const,
          },
        });
      },
      succeeded: (title: string, description?: string) => {
        showStyledToast("success", title, { description });
      },
    },
    search: {
      failed: (error: unknown) => {
        const message = getErrorMessage(error, t("unexpectedError"));
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
        showStyledToast("error", t("uploadFailed"), {
          description: getErrorMessage(
            error,
            t("uploadFailedDescription", { format: formatLabel }),
          ),
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
    },
    entity: {
      created: (entity: string, label?: string) => {
        showStyledToast("success", t("entityCreated", { entity: formatEntityName(entity) }), {
          description: createEntityDescription("was created", label),
        });
      },
      updated: (entity: string, label?: string) => {
        showStyledToast("success", t("entityUpdated", { entity: formatEntityName(entity) }), {
          description: createEntityDescription("was updated", label),
        });
      },
      deleted: (entity: string, label?: string) => {
        showStyledToast("success", t("entityDeleted", { entity: formatEntityName(entity) }), {
          description: createEntityDescription("was deleted", label),
        });
      },
      cleared: (entity: string, count?: number) => {
        const description =
          typeof count === "number"
            ? t("clearedCount", { count: formatEntityWithCount(entity, count) })
            : undefined;
        showStyledToast("success", t("entityCleared", { entity: formatEntityName(entity) }), {
          description,
        });
      },
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
