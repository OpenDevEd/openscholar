/**
 * Feature Flag Registry
 * =====================
 * Type-safe registry of all feature flags. The Convex `featureFlags` table
 * is the runtime source of truth; this registry provides:
 *   1. Compile-time autocomplete via the FlagName type
 *   2. Static defaults used as fallback while the DB query is loading
 *   3. The rows `featureFlags/internal:seed` inserts
 *
 * A flag is an on/off switch for everyone. `planFeature` also requires the
 * user's plan in Autumn to grant that feature; which plans do is set in
 * Autumn's dashboard.
 */

type FlagDefault = {
  enabled: boolean;
  planFeature?: string;
  description: string;
};

export const FLAG_REGISTRY = {
  "extraction.enabled": { enabled: true, description: "Master switch for the extraction feature" },
  "extraction.pdf": { enabled: true, description: "PDF processing capability gate (per-job toggle visibility)" },
  "extraction.chat": { enabled: false, description: "Chat mode for job creation (paper Q&A)" },
  "extraction.start": { enabled: true, planFeature: "extraction", description: "Start new extraction jobs" },
  "assistant.enabled": { enabled: false, description: "The research assistant and its chats" },
  "credits.enabled": { enabled: true, description: "Credit system master switch" },
  "credits.topups": { enabled: true, description: "On-demand credit top-up purchases" },
  "subscriptions.enabled": { enabled: true, description: "Subscription/billing system master switch" },
  "subscriptions.plan.enterprise": { enabled: true, description: "Show the Enterprise plan on the pricing page" },
} as const satisfies Record<string, FlagDefault>;

export type FlagName = keyof typeof FLAG_REGISTRY;
