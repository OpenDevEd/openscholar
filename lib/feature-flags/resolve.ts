/**
 * Flag Resolution — pure functions that collapse a flag to a boolean.
 */

import { FLAG_REGISTRY, type FlagName } from "./registry";

/**
 * Resolve a single flag from DB data.
 * A flag is enabled if: globally enabled AND user tier >= minimumTier.
 */
export function resolveFlag(
  enabled: boolean,
  minimumTier: number,
  userTier: number | null,
): boolean {
  if (!enabled) return false;
  if (minimumTier === 0) return true;
  return userTier !== null && userTier >= minimumTier;
}

/**
 * Resolve a flag from its static default (used during loading).
 */
export function resolveFlagDefault(name: FlagName, userTier: number | null): boolean {
  const def = FLAG_REGISTRY[name];
  return resolveFlag(def.enabled, def.minimumTier, userTier);
}

export type ResolvedFlags = { readonly [K in FlagName]: boolean };

/**
 * Resolve all flags from DB data.
 * @param dbFlags - Array of { key, enabled, minimumTier } from the featureFlags table
 * @param userTier - The user's plan tier (0/10/20/30), null if unknown
 */
export function resolveAllFlags(
  dbFlags: Array<{ key: string; enabled: boolean; minimumTier: number }> | undefined,
  userTier: number | null,
): ResolvedFlags {
  const result = {} as Record<string, boolean>;

  for (const name of Object.keys(FLAG_REGISTRY) as FlagName[]) {
    const dbFlag = dbFlags?.find((f) => f.key === name);
    if (dbFlag) {
      result[name] = resolveFlag(dbFlag.enabled, dbFlag.minimumTier, userTier);
    } else {
      result[name] = resolveFlagDefault(name, userTier);
    }
  }

  return Object.freeze(result) as ResolvedFlags;
}
