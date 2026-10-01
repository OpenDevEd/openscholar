/**
 * Every registered user action, in one list. The assistant's tools are made from it
 * (`assistantTools`), and `scripts/check-user-actions.ts` fails CI when a public
 * function built from a registry entry is missing here.
 */
import { changeAction, getSearchAction, ratingsAction, revisionsAction, searchesAction, searchHistoryAction, shortcutsAction } from "../research/records";
import type { UserAction } from "./userActions";

export const USER_ACTIONS: readonly UserAction[] = [
  searchesAction,
  getSearchAction,
  revisionsAction,
  searchHistoryAction,
  shortcutsAction,
  ratingsAction,
  changeAction,
];
