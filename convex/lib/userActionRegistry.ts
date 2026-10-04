/**
 * Every registered user action, in one list. The assistant's tools are made from it
 * (`assistantTools`), and `scripts/check-user-actions.ts` fails CI when a public
 * function built from a registry entry is missing here.
 */
import { answersOfAction, changeAction, countSearchesAction, getSearchAction, listedSearchesAction, ratingsAction, ratingsOfAction, revisionsAction, searchHistoryAction, searchHistoryEntryAction, countShortcutsAction, listedShortcutsAction, shortcutsOfAction } from "../research/records";
import { clearLibraryRatingAction, removeFromLibraryAction, restoreLibraryItemAction, saveToLibraryAction, setPaperInCollectionAction } from "../library/mutations";
import { countJobsAction as extractionJobCountAction, listJobsAction as extractionJobsAction } from "../extraction/queries/jobs";
import { countJobResultsAction as extractionResultCountAction, listJobResultsAction as extractionResultsAction } from "../extraction/queries/results";
import { savedPaperAction } from "../library/queries";
import { estimateAction as screeningEstimateAction } from "../screening/queries";
import { answerAction as screeningAnswerAction, getAction as screeningPaperAction, listAction as screeningPapersAction } from "../screening/papers";
import { slotsAction as screeningSlotsAction } from "../screening/queries";
import { screenAction } from "../screening/start";
import type { UserAction } from "./userActions";

export const USER_ACTIONS: readonly UserAction[] = [
  extractionJobsAction,
  extractionJobCountAction,
  extractionResultsAction,
  extractionResultCountAction,
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
  answersOfAction,
  changeAction,
  savedPaperAction,
  screeningEstimateAction,
  screenAction,
  screeningSlotsAction,
  screeningPaperAction,
  screeningPapersAction,
  screeningAnswerAction,
  saveToLibraryAction,
  clearLibraryRatingAction,
  removeFromLibraryAction,
  restoreLibraryItemAction,
  setPaperInCollectionAction,
];
