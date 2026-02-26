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
    downloadSuccessTitle: "Download complete",
  },
  clipboard: {
    copiedDescription: "Copied to clipboard.",
    copyFailedDescription: "Could not copy to clipboard. Please try again.",
  },
  validation: {
    failedTitle: "Validation failed",
    warningTitle: "Validation warning",
    fileTypeTitle: "Invalid file type",
    fileSizeTitle: "File too large",
  },
  job: {
    cancelledTitle: "Job cancelled",
    cancelFailedTitle: "Failed to cancel",
    deletedTitle: "Job deleted",
    deleteFailedTitle: "Failed to delete",
    createdTitle: "Job started",
    createFailedTitle: "Failed to start",
    duplicatedTitle: "Job duplicated",
    duplicateFailedTitle: "Failed to duplicate",
  },
  billing: {
    cancelledTitle: "Subscription cancelled",
    cancelFailedTitle: "Failed to cancel",
    portalFailedTitle: "Failed to open billing portal",
    checkoutFailedTitle: "Failed to start checkout",
    openBillingActionLabel: "Open Billing",
    openPricingActionLabel: "Open Pricing",
  },
  zotero: {
    connectedTitle: "Connected to Zotero",
    connectionFailedTitle: "Connection failed",
  },
  convex: {
    convexUnknownError: "Something went wrong. Please try again.",
    convexAuthRequired: "Please sign in to continue.",
    convexPermissionDenied: "You do not have permission to do that.",
    extractionPlanRequired: "Data extraction requires Pro. Upgrade to continue.",
    convexNotFound: "The requested resource could not be found.",
    convexInvalidInput: "Please review your input and try again.",
    convexInsufficientCredits: "You do not have enough credits to continue.",
    aiUnauthenticated: "Please sign in to use AI features.",
    aiInsufficientCredits: "You do not have enough AI credits.",
    aiPlanEntitlement: "This AI feature requires a higher plan.",
    aiApiKeyRequired: "Add an AI API key in settings to continue.",
    aiProviderError: "The AI provider is unavailable right now. Please try again.",
    aiValidationError: "The AI response could not be validated. Please retry.",
    aiMaxRetriesExceeded: "AI generation could not be completed. Please retry.",
    apiKeyInvalidFormat: "The API key format looks invalid.",
    apiKeyEncryptionMisconfigured: "API key encryption is not configured correctly.",
    zoteroNotConnected: "Connect Zotero to continue.",
    zoteroOauthNotConfigured: "Zotero OAuth is not configured.",
    zoteroRequestTokenFailed: "Unable to start Zotero authorization.",
    zoteroInvalidResponse: "Zotero returned an invalid response.",
    zoteroApiError: "Unable to load data from Zotero right now.",
    billingNoSubscriptionLinked: "No active subscription is linked to your account.",
    billingSubscriptionDataInvalid: "Subscription details are temporarily unavailable.",
    billingSubscriptionInvalid: "Your subscription could not be found in billing.",
    billingAuthenticationFailed: "Billing authentication failed. Please contact support.",
    billingNetworkError: "Network error while contacting billing. Please retry.",
    billingRateLimited: "Billing is busy right now. Please try again shortly.",
    billingStripeError: "Billing is temporarily unavailable. Please try again.",
    billingPlanChangeConflict: "Your plan could not be updated due to a billing conflict.",
    billingInvalidPrice: "That plan is no longer available. Please refresh and retry.",
    billingCancelRequiresPortal: "Use the billing portal to switch to the free plan.",
    billingNoActiveSubscription: "No active subscription was found for this account.",
    creditsTopupBundleInvalid: "That credit bundle is invalid. Please refresh and retry.",
    creditsProductMisconfigured: "Credit checkout is temporarily unavailable.",
  },
} as const;

export function formatEntityName(entity: string, fallback = "Item"): string {
  const trimmed = entity.trim();
  if (!trimmed) {
    return fallback;
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
