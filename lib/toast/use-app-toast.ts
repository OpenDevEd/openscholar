"use client";

import { useTranslations } from "next-intl";
import { showStyledToast } from "@/components/ui/sonner";
import { resolveToastActionRoute } from "./action-routing";
import {
  getToastMessageKeyForErrorCode,
  resolveToastError,
} from "./error-resolver";
import type { ToastAction } from "./core";

function navigateTo(
  path: "/settings/ai" | "/settings/billing" | "/pricing" | "/sign-in"
) {
  window.location.href = path;
}

function getStatusCode(message: string): string | null {
  const statusMatch = message.match(/\b(\d{3})\b/);
  return statusMatch?.[1] ?? null;
}

function buildActionFromRoute(
  route: "/settings/ai" | "/settings/billing" | "/pricing" | "/sign-in",
  t: ReturnType<typeof useTranslations>,
  tc: ReturnType<typeof useTranslations>
): ToastAction {
  if (route === "/sign-in") {
    return {
      label: tc("signIn"),
      onClick: () => navigateTo("/sign-in"),
      icon: "arrow-right",
    };
  }

  if (route === "/settings/ai") {
    return {
      label: t("openAISettings"),
      onClick: () => navigateTo("/settings/ai"),
      icon: "settings",
    };
  }

  if (route === "/settings/billing") {
    return {
      label: t("openBilling"),
      onClick: () => navigateTo("/settings/billing"),
      icon: "arrow-right",
    };
  }

  return {
    label: t("openPricing"),
    onClick: () => navigateTo("/pricing"),
    icon: "arrow-right",
  };
}

export type AppToastApi = {
  ai: {
    configRequired: (description?: string) => void;
    failed: (operation: string, error: unknown) => void;
  };
  search: { failed: (error: unknown) => void };
  io: {
    downloadFailed: (formatLabel: string) => void;
    uploadFailed: (formatLabel: string, error?: unknown) => void;
  };
  clipboard: {
    copyFailed: (thing: string) => void;
  };
  validation: {
    failed: (message: string) => void;
    fileType: (allowedTypes?: string) => void;
    fileSize: (maxSizeMB: number) => void;
  };
  job: {
    cancelFailed: () => void;
    deleteFailed: () => void;
    createFailed: (error?: unknown) => void;
    duplicateFailed: () => void;
  };
  billing: {
    cancelFailed: () => void;
    portalFailed: (error?: unknown) => void;
    checkoutFailed: (error?: unknown) => void;
  };
  zotero: {
    failed: (error?: unknown) => void;
  };
  error: (title: string, description?: string, action?: ToastAction) => void;
};

export function getErrorMessage(error: unknown, fallback: string): string {
  const resolved = resolveToastError(error, fallback);
  return resolved.message;
}

export function useAppToast(): AppToastApi {
  const t = useTranslations("toast");
  const tc = useTranslations("common");

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

  const getActionFromCode = (code?: string): ToastAction | undefined => {
    const route = resolveToastActionRoute(code);
    if (!route) {
      return undefined;
    }

    return buildActionFromRoute(route, t, tc);
  };

  return {
    ai: {
      configRequired: (description?: string) => {
        showStyledToast("error", t("aiConfigRequired"), {
          description: description || t("aiConfigRequiredDescription"),
          action: buildActionFromRoute("/settings/ai", t, tc),
        });
      },
      failed: (operation: string, error: unknown) => {
        const operationLabel = operation.trim() || t("aiOperation");
        const resolved = resolveErrorDetails(error, t("unexpectedError"));

        showStyledToast("error", t("operationFailed", { operation: operationLabel }), {
          description: resolved.message,
          action: getActionFromCode(resolved.code),
        });
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
          t("uploadFailedDescription", { format: formatLabel })
        );
        showStyledToast("error", t("uploadFailed"), {
          description: message,
        });
      },
    },
    clipboard: {
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
      fileType: (allowedTypes?: string) => {
        showStyledToast("error", t("fileTypeTitle"), {
          description: allowedTypes
            ? t("onlyFilesSupported", { allowedTypes })
            : t("fileTypeNotSupported"),
        });
      },
      fileSize: (maxSizeMB: number) => {
        showStyledToast("error", t("fileSizeTitle"), {
          description: t("fileExceedsMaxSize", { maxSizeMB }),
        });
      },
    },
    job: {
      cancelFailed: () => showStyledToast("error", t("jobCancelFailed")),
      deleteFailed: () => showStyledToast("error", t("jobDeleteFailed")),
      createFailed: (error?: unknown) => {
        const resolved = resolveErrorDetails(error, t("unexpectedError"));
        showStyledToast("error", t("jobCreateFailed"), {
          description: resolved.message,
          action: getActionFromCode(resolved.code),
        });
      },
      duplicateFailed: () => showStyledToast("error", t("jobDuplicateFailed")),
    },
    billing: {
      cancelFailed: () => showStyledToast("error", t("billingCancelFailed")),
      portalFailed: (error?: unknown) => {
        const resolved = resolveErrorDetails(error, t("billingPortalFailed"));
        showStyledToast("error", t("billingPortalFailed"), {
          description: resolved.message,
          action: getActionFromCode(resolved.code),
        });
      },
      checkoutFailed: (error?: unknown) => {
        const resolved = resolveErrorDetails(error, t("billingCheckoutFailed"));
        showStyledToast("error", t("billingCheckoutFailed"), {
          description: resolved.message,
          action: getActionFromCode(resolved.code),
        });
      },
    },
    zotero: {
      failed: (error?: unknown) => {
        const { message } = resolveErrorDetails(error, t("zoteroConnectionFailed"));
        showStyledToast("error", t("zoteroConnectionFailed"), { description: message });
      },
    },
    error: (title: string, description?: string, action?: ToastAction) => {
      showStyledToast("error", title, { description, action });
    },
  };
}
