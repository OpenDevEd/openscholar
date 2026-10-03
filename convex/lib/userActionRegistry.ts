/**
 * Every registered user action, in one list. The assistant's tools are made from it
 * (`assistantTools`), and `scripts/check-user-actions.ts` fails CI when a public
 * function built from a registry entry is missing here.
 */
import { changeAction, countSearchesAction, getSearchAction, listedSearchesAction, ratingsAction, ratingsOfAction, revisionsAction, searchHistoryAction, searchHistoryEntryAction, countShortcutsAction, listedShortcutsAction, shortcutsOfAction } from "../research/records";
import { clearLibraryRatingAction, removeFromLibraryAction, restoreLibraryItemAction, saveToLibraryAction, setPaperInCollectionAction } from "../library/mutations";
import { savedPaperAction } from "../library/queries";
import { estimateAction as screeningEstimateAction } from "../screening/queries";
import { screenSearchAction } from "../screening/start";
import type { UserAction } from "./userActions";

export const USER_ACTIONS: readonly UserAction[] = [
  listedSearchesAction,
  countSearchesAction,
  getSearchAction,
  revisionsAction,
  searchHistoryAction,
  searchHistoryEntryAction,
  listedShortcutsAction,
  countShortcutsAction,
  shortcutsOfAction,
  ratingsAction,
  ratingsOfAction,
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
