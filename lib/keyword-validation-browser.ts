import { useKeywordExpansionStore } from './store';
import { shortcutNames } from './query-shortcuts';
import { validateAndExpandKeywordsSilently as validateSilently, type ExpandShortcuts } from './keyword-validation';

/**
 * The browser's shortcut expansion: this browser's shortcuts, or for a signed-in account
 * those it has read by name. An account reads the shortcuts a query names with
 * `ensureQueryShortcuts` (in an action) or `useQueryShortcuts` (while a component shows the
 * query) before expanding it.
 */
export const browserExpand: ExpandShortcuts = (query) => useKeywordExpansionStore.getState().expandQuery(query);

/** Validates a query's shortcuts against the browser's, without showing warnings. */
export const validateAndExpandKeywordsSilently = (query: string) => validateSilently(query, browserExpand);

/** Reads the shortcuts these queries name, so the code that follows expands them. */
export const ensureQueryShortcuts = (...queries: Array<string | null | undefined>) =>
  useKeywordExpansionStore.getState().ensureShortcuts(queries.flatMap((query) => (query ? shortcutNames(query) : [])));
