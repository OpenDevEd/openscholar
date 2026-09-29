/**
 * The AI tasks OpenScholar routes to models. Each preset sets a model and an
 * effort for every task (`aiModelConfig` key `preset.<preset>.<task>`); Custom
 * holds the user's own pick for each.
 */
export const CLOUD_TASKS = ["chat", "extraction", "screenAll"] as const;
/** Tasks that run in the browser when the user pays with their own key. */
export const BROWSER_TASKS = ["screening", "questionToQuery", "refine", "translate", "broadenNarrow"] as const;
export const AI_TASKS = [...CLOUD_TASKS, ...BROWSER_TASKS] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** Which search task a query enhancement is. */
export const SEARCH_TASKS = ["questionToQuery", "refine", "broadenNarrow"] as const;
export type SearchTask = (typeof SEARCH_TASKS)[number];

export const PRESET_KEYS = ["cheap", "fast", "balanced", "intelligent"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
/** What a user runs on: a fixed preset, or their own pick for each task. */
export type ModelChoice = PresetKey | "custom";
/** The preset a user starts on, and the fallback when a pick is gone. */
export const DEFAULT_PRESET: PresetKey = "balanced";

export const presetConfigKey = (preset: PresetKey, task: AiTask) => `preset.${preset}.${task}`;

/** What a user runs on: their choice, or Custom when credits are off (presets need credits). */
export const effectiveChoice = (creditsEnabled: boolean, saved: ModelChoice | undefined): ModelChoice =>
  creditsEnabled ? (saved ?? DEFAULT_PRESET) : "custom";

/** The preset a task falls back to when Custom has no live pick for it. */
export const fallbackPreset = (saved: ModelChoice | undefined): PresetKey =>
  saved && saved !== "custom" ? saved : DEFAULT_PRESET;
