import { useKeywordExpansionStore } from './store';
import { validateAndExpandKeywordsSilently as validateSilently, type ExpandShortcuts } from './keyword-validation';

/** The browser's shortcut expansion: the signed-in account's shortcuts, or this browser's. */
export const browserExpand: ExpandShortcuts = (query) => useKeywordExpansionStore.getState().expandQuery(query);

/** Validates a query's shortcuts against the browser's, without showing warnings. */
export const validateAndExpandKeywordsSilently = (query: string) => validateSilently(query, browserExpand);
