/**
 * Flag Resolution — pure functions that collapse a flag to a boolean.
 */

import { FLAG_REGISTRY, type FlagName } from "./registry";

type FlagRow = { key: string; enabled: boolean; planFeature?: string };

/**
 * A flag is on when it's enabled and, if it names a plan feature, the user's
 * plans grant it. `planFeatures` is null while the user's plan is unknown.
 */
export function resolveFlag(
  enabled: boolean,
  planFeature: string | undefined,
  planFeatures: readonly string[] | null,
): boolean {
  if (!enabled) return false;
  if (!planFeature) return true;
  return planFeatures?.includes(planFeature) ?? false;
}

/** Resolve a flag from its static default (used during loading). */
export function resolveFlagDefault(name: FlagName, planFeatures: readonly string[] | null): boolean {
  const def: { enabled: boolean; planFeature?: string } = FLAG_REGISTRY[name];
  return resolveFlag(def.enabled, def.planFeature, planFeatures);
}

export type ResolvedFlags = { readonly [K in FlagName]: boolean };

/** Resolve every registered flag from the DB rows, falling back to defaults. */
export function resolveAllFlags(
  dbFlags: FlagRow[] | undefined,
  planFeatures: readonly string[] | null,
): ResolvedFlags {
  const result = {} as Record<string, boolean>;
  for (const name of Object.keys(FLAG_REGISTRY) as FlagName[]) {
    const dbFlag = dbFlags?.find((f) => f.key === name);
    result[name] = dbFlag
      ? resolveFlag(dbFlag.enabled, dbFlag.planFeature, planFeatures)
      : resolveFlagDefault(name, planFeatures);
  }
  return Object.freeze(result) as ResolvedFlags;
}
