/**
 * Feature Flag Registry
 * =====================
 * Type-safe registry of all feature flags. The Convex `featureFlags` table
 * is the runtime source of truth; this registry provides:
 *   1. Compile-time autocomplete via the FlagName type
 *   2. Static defaults used as fallback while the DB query is loading
 */

type FlagDefault = {
  enabled: boolean;
  minimumTier: number;
  description: string;
};

export const FLAG_REGISTRY = {
  "extraction.enabled": { enabled: true, minimumTier: 0, description: "Master switch for the extraction feature" },
  "extraction.pdf": { enabled: true, minimumTier: 0, description: "PDF processing in extraction pipelines" },
  "extraction.insights": { enabled: true, minimumTier: 20, description: "AI-powered insights panel in extraction results" },
  "extraction.reviewQueue": { enabled: false, minimumTier: 20, description: "Manual review queue for extraction results" },
  "extraction.reportBuilder": { enabled: false, minimumTier: 20, description: "Report builder for extraction jobs" },
  "extraction.start": { enabled: true, minimumTier: 20, description: "Start new extraction jobs (Pro+)" },
  "extraction.templates": { enabled: true, minimumTier: 20, description: "Workflow template management (Pro+)" },
  "credits.enabled": { enabled: true, minimumTier: 0, description: "Credit system master switch" },
  "credits.topups": { enabled: true, minimumTier: 0, description: "On-demand credit top-up purchases" },
  "subscriptions.enabled": { enabled: true, minimumTier: 0, description: "Subscription/billing system master switch" },
  "subscriptions.plan.go": { enabled: true, minimumTier: 0, description: "Show the Go plan on the pricing page" },
  "subscriptions.plan.pro": { enabled: true, minimumTier: 0, description: "Show the Pro plan on the pricing page" },
  "subscriptions.plan.enterprise": { enabled: true, minimumTier: 0, description: "Show the Enterprise plan on the pricing page" },
} as const satisfies Record<string, FlagDefault>;

export type FlagName = keyof typeof FLAG_REGISTRY;
