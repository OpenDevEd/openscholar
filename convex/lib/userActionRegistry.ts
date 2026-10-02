/**
 * Every registered user action, in one list. The assistant's tools are made from it
 * (`assistantTools`), and `scripts/check-user-actions.ts` fails CI when a public
 * function built from a registry entry is missing here.
 */
import { changeAction, getSearchAction, ratingsAction, revisionsAction, searchesAction, searchHistoryAction, searchHistoryEntryAction, shortcutsAction } from "../research/records";
import { clearLibraryRatingAction, removeFromLibraryAction, restoreLibraryItemAction, saveToLibraryAction, setPaperInCollectionAction } from "../library/mutations";
import { savedPaperAction } from "../library/queries";
import { estimateAction as screeningEstimateAction } from "../screening/queries";
import { screenSearchAction } from "../screening/start";
import type { UserAction } from "./userActions";

export const USER_ACTIONS: readonly UserAction[] = [
  searchesAction,
  getSearchAction,
  revisionsAction,
  searchHistoryAction,
  searchHistoryEntryAction,
  shortcutsAction,
  ratingsAction,
  changeAction,
  savedPaperAction,
  screeningEstimateAction,
  screenSearchAction,
  saveToLibraryAction,
  clearLibraryRatingAction,
  removeFromLibraryAction,
  restoreLibraryItemAction,
  setPaperInCollectionAction,
];
