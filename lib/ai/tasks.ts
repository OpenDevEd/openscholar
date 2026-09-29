/**
 * The AI tasks OpenScholar routes to models. "Recommended" runs each on the
 * model an admin sets for it (`aiModelConfig` key `task.<id>`); "One model"
 * runs them all on the user's chosen model.
 */
export const CLOUD_TASKS = ["chat", "extraction", "screenAll"] as const;
/** Tasks that run in the browser when the user pays with their own key. */
export const BROWSER_TASKS = ["screening", "questionToQuery", "refine", "translate", "broadenNarrow"] as const;
export const AI_TASKS = [...CLOUD_TASKS, ...BROWSER_TASKS] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** Which search task a query enhancement is. */
export const SEARCH_TASKS = ["questionToQuery", "refine", "broadenNarrow"] as const;
export type SearchTask = (typeof SEARCH_TASKS)[number];

export const taskConfigKey = (task: AiTask) => `task.${task}`;
