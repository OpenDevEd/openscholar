/**
 * Every registered user action, in one list. The assistant's tools are made from it
 * (`assistantTools`), and `scripts/check-user-actions.ts` fails CI when a public
 * function built from a registry entry is missing here.
 */
import { answersOfAction, changeAction, countSearchesAction, getSearchAction, listedSearchesAction, ratingsAction, ratingsOfAction, revisionsAction, searchHistoryAction, searchHistoryEntryAction, countShortcutsAction, listedShortcutsAction, shortcutsOfAction } from "../research/records";
import { clearLibraryRatingAction, removeFromLibraryAction, restoreLibraryItemAction, saveToLibraryAction, setPaperInCollectionAction } from "../library/mutations";
import { countJobsAction as extractionJobCountAction, listJobsAction as extractionJobsAction } from "../extraction/queries/jobs";
import { countJobFailuresAction as extractionFailureCountAction } from "../extraction/queries/failures";
import { countJobResultsAction as extractionResultCountAction, listJobResultsAction as extractionResultsAction } from "../extraction/queries/results";
import { grantAction as chatGrantAction, listAccessAction as chatAccessAction, revokeAction as chatRevokeAction } from "../assistant/sharing";
import { createAction as chatCreateAction, getAction as chatAction, listAction as chatsAction, removeAction as chatRemoveAction, renameAction as chatRenameAction } from "../assistant/threads";
import { savedPaperAction } from "../library/queries";
import { estimateAction as screeningEstimateAction } from "../screening/queries";
import { answerAction as screeningAnswerAction, getAction as screeningPaperAction, listAction as screeningPapersAction } from "../screening/papers";
import { slotsAction as screeningSlotsAction } from "../screening/queries";
import { screenAction } from "../screening/start";
import { countAdminsAction, listAdminsAction, listCandidatesAction } from "../admins/queries";
import { countChargesAction, listChargesAction, spendingAction } from "../billing/usage";
import { countKeysAction as walletKeyCountAction, listKeysAction as walletKeysAction } from "../wallet/queries";
import type { UserAction } from "./userActions";

export const USER_ACTIONS: readonly UserAction[] = [
  chatsAction,
  chatAction,
  chatCreateAction,
  chatRenameAction,
  chatRemoveAction,
  chatAccessAction,
  chatGrantAction,
  chatRevokeAction,
  extractionJobsAction,
  extractionJobCountAction,
  extractionResultsAction,
  extractionResultCountAction,
  extractionFailureCountAction,
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
  listChargesAction,
  countChargesAction,
  spendingAction,
  walletKeysAction,
  walletKeyCountAction,
  listAdminsAction,
  countAdminsAction,
  listCandidatesAction,
];
