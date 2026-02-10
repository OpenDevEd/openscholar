export const TOAST_MESSAGES = {
  fallback: {
    unexpectedError: "An unexpected error occurred. Please try again.",
  },
  ai: {
    settingsActionLabel: "Open AI Settings",
    configRequiredTitle: "AI configuration required",
    configRequiredDescription: "Please configure your AI settings to continue.",
  },
  search: {
    queryTooLargeTitle: "Search query too large",
    queryTooLargeDescription: "Please try simplifying your search.",
    rateLimitedTitle: "Too many requests",
    rateLimitedDescription: "Please wait a moment before trying again.",
    failedTitle: "Search failed",
    failedDescription: "An unexpected error occurred.",
  },
  io: {
    downloadFailedTitle: "Download failed",
    uploadFailedTitle: "Upload failed",
    importCompletedTitle: "Import completed",
    importSkippedTitle: "Nothing imported",
    importSkippedDescription: "No valid entries were found in the file.",
  },
  clipboard: {
    copiedDescription: "Copied to clipboard.",
    copyFailedDescription: "Could not copy to clipboard. Please try again.",
  },
  validation: {
    failedTitle: "Validation failed",
    warningTitle: "Validation warning",
  },
} as const;

export function formatEntityName(entity: string): string {
  const trimmed = entity.trim();
  if (!trimmed) {
    return "Item";
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function formatEntityWithCount(entity: string, count: number): string {
  return `${count} ${entity}`.trim();
}

export function formatOptionalLabel(label?: string): string | undefined {
  if (!label) {
    return undefined;
  }

  return `"${label}"`;
}
