/**
 * Feature Flags - Public API
 */

// Registry & types
export { FLAG_REGISTRY } from "./registry";
export type { FlagName } from "./registry";

// Resolution
export { resolveFlag, resolveFlagDefault, resolveAllFlags } from "./resolve";
export type { ResolvedFlags } from "./resolve";

// Provider (preloaded server-side flags)
export { FeatureFlagProvider, useDbFlags } from "./provider";
