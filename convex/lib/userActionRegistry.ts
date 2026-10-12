/**
 * Every registered user action, in one list. The assistant's tools are made from it
 * (`assistantTools`), and `scripts/check-user-actions.ts` fails CI when a public
 * function built from a registry entry is missing here.
 */
import { answersOfAction, changeAction, countSearchesAction, getSearchAction, listedSearchesAction, ratingsAction, ratingsOfAction, revisionsAction, searchHistoryAction, searchHistoryEntryAction, countShortcutsAction, listedShortcutsAction, shortcutsOfAction } from "../research/records";
import { createAction as searchCreateAction, deleteAction as searchDeleteAction, removeAction as searchRemoveAction, restoreAction as searchRestoreAction, resultsAction as searchResultsAction, updateAction as searchUpdateAction } from "../research/searches";
import { countAction as paperCountAction, getAction as paperGetAction, readPdfAction as paperPdfAction, searchAction as paperSearchAction } from "../research/papers";
import { findAction as lookupFindAction } from "../research/lookup";
import { listAction as activityListAction, startedByAction as activityStartedByAction } from "../activity/queries";
import { countsAction as makerCountsAction, totalAction as makerTotalAction } from "../workspaces/makers";
import { setLibraryRatingAction, removeFromLibraryAction, restoreLibraryItemAction, saveToLibraryAction, setPaperInCollectionAction } from "../library/mutations";
import { collectAction as libraryCollectAction, saveAction as librarySaveAction } from "../library/papers";
import { countJobsAction as extractionJobCountAction, getJobDetailsAction as extractionJobAction, listJobsAction as extractionJobsAction } from "../extraction/queries/jobs";
import { countJobFailuresAction as extractionFailureCountAction } from "../extraction/queries/failures";
import { countJobResultsAction as extractionResultCountAction, listJobResultsAction as extractionResultsAction, summarizeJobResultsAction as extractionSummaryAction } from "../extraction/queries/results";
import { undoAction as bulkUndoAction } from "../assistant/batches";
import { messagesAction as chatMessagesAction, stepsAction as chatStepsAction } from "../assistant/replies";
import { createAction as chatCreateAction, getAction as chatAction, listAction as chatsAction, peopleAction as chatAccessAction, removeAction as chatRemoveAction, renameAction as chatRenameAction, setModelAction as chatModelAction } from "../assistant/threads";
import { countPapersAction as libraryCountPapersAction, papersAction as libraryPapersAction, savedPaperAction } from "../library/queries";
import { createAction as createOrganizationAction, declineInvitationAction, deleteOrganizationAction, inviteAction, leaveAction, removeMemberAction, renameAction as renameOrganizationAction, resendInvitationAction, revokeInvitationAction, setAiPresetAction, setColourAction, setRoleAction } from "../organizations/manage";
import { invitationsAction as organizationInvitationsAction, membersAction as organizationMembersAction, myInvitationsAction, summaryAction as workspaceSummaryAction, workspaceAction, workspacesAction } from "../organizations/queries";
import { heldAction as moveHeldAction, moveAction } from "../workspaces/move";
import { addAction as guestAddAction, candidatesAction as guestCandidatesAction, invitedAction as guestInvitedAction, leaveAction as guestLeaveAction, listAction as guestListAction, removeAction as guestRemoveAction, roomAction as guestRoomAction, setRoleAction as guestRoleAction } from "../sharing/guests";
import { getAction as guestInvitationAction, inviteAction as guestInviteAction, respondAction as guestRespondAction } from "../sharing/invitations";
import { countsAction as sharedCountsAction, editableCollectionsAction as sharedEditableCollectionsAction, listAction as sharedListAction } from "../sharing/shared";
import { addToCollectionAction, countCollectionsAction, createCollectionAction, deleteCollectionAction, getCollectionAction, listCollectionsAction, ratersAction as collectionRatersAction, removeFromCollectionAction, renameCollectionAction, setCollectionRatingAction } from "../library/collections";
import { estimateAction as screeningEstimateAction, listJobsAction as screeningJobsAction } from "../screening/queries";
import { answerAction as screeningAnswerAction, getAction as screeningPaperAction, listAction as screeningPapersAction } from "../screening/papers";
import { slotsAction as screeningSlotsAction, getScreeningJobAction, listScreeningResultsAction } from "../screening/queries";
import { screenAction } from "../screening/start";
import { countAdminsAction, listAdminsAction, listCandidatesAction } from "../admins/queries";
import { listModelsAction as adminModelsAction, summaryAction as adminModelSummaryAction } from "../models/admin";
import { balanceAction, countChargesAction, listChargesAction, planAction, spendingAction } from "../billing/usage";
import { allowanceAction, setCapAction, spendingAction as memberSpendingAction } from "../billing/caps";
import { countKeysAction as walletKeyCountAction, listKeysAction as walletKeysAction } from "../wallet/queries";
import type { UserAction } from "./userActions";
import { cancelExtractionAction, deleteExtractionAction, startJobAction as extractionStartAction, duplicateJobAction as extractionDuplicateAction } from "../extraction/mutations/jobs";
import { pauseExtractionAction } from "../extraction/mutations/pause";
import { resumeExtractionAction } from "../extraction/mutations/resume";
import { retryFailedQuestionsAction } from "../extraction/mutations/retry";
import { getJobCostAction } from "../extraction/queries/costs";
import { cancelScreeningJobAction } from "../screening/mutations";
import { extractAction } from "../extraction/start";
import { findAction as mentionFindAction } from "../assistant/mentions";
import { readAction as fileReadAction } from "../assistant/files";
import { searchAction as webSearchAction } from "../research/web";

export const USER_ACTIONS: readonly UserAction[] = [
  extractionStartAction,
  extractionDuplicateAction,
  cancelExtractionAction,
  deleteExtractionAction,
  pauseExtractionAction,
  resumeExtractionAction,
  retryFailedQuestionsAction,
  getJobCostAction,
  cancelScreeningJobAction,
  chatsAction,
  chatAction,
  chatAccessAction,
  chatCreateAction,
  chatRenameAction,
  chatModelAction,
  chatRemoveAction,
  chatMessagesAction,
  chatStepsAction,
  mentionFindAction,
  webSearchAction,
  fileReadAction,
  paperPdfAction,
  bulkUndoAction,
  extractionJobsAction,
  extractionJobCountAction,
  extractionJobAction,
  extractionResultsAction,
  extractionResultCountAction,
  extractionSummaryAction,
  extractionFailureCountAction,
  listedSearchesAction,
  countSearchesAction,
  getSearchAction,
  searchCreateAction,
  searchUpdateAction,
  searchRestoreAction,
  searchRemoveAction,
  searchDeleteAction,
  searchResultsAction,
  paperSearchAction,
  paperCountAction,
  paperGetAction,
  libraryPapersAction,
  librarySaveAction,
  libraryCollectAction,
  libraryCountPapersAction,
  balanceAction,
  screeningJobsAction,
  getScreeningJobAction,
  listScreeningResultsAction,
  lookupFindAction,
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
  extractAction,
  screeningSlotsAction,
  screeningPaperAction,
  screeningPapersAction,
  screeningAnswerAction,
  saveToLibraryAction,
  setLibraryRatingAction,
  removeFromLibraryAction,
  restoreLibraryItemAction,
  setPaperInCollectionAction,
  listCollectionsAction,
  countCollectionsAction,
  getCollectionAction,
  createCollectionAction,
  renameCollectionAction,
  deleteCollectionAction,
  addToCollectionAction,
  removeFromCollectionAction,
  setCollectionRatingAction,
  collectionRatersAction,
  activityListAction,
  activityStartedByAction,
  makerCountsAction,
  makerTotalAction,
  workspacesAction,
  workspaceAction,
  organizationMembersAction,
  organizationInvitationsAction,
  myInvitationsAction,
  workspaceSummaryAction,
  createOrganizationAction,
  inviteAction,
  resendInvitationAction,
  revokeInvitationAction,
  declineInvitationAction,
  setRoleAction,
  memberSpendingAction,
  allowanceAction,
  setCapAction,
  removeMemberAction,
  leaveAction,
  renameOrganizationAction,
  setColourAction,
  setAiPresetAction,
  deleteOrganizationAction,
  moveHeldAction,
  moveAction,
  guestAddAction,
  guestInviteAction,
  guestRoleAction,
  guestRemoveAction,
  guestLeaveAction,
  guestRespondAction,
  guestRoomAction,
  guestListAction,
  guestInvitedAction,
  guestCandidatesAction,
  guestInvitationAction,
  sharedListAction,
  sharedCountsAction,
  sharedEditableCollectionsAction,
  listChargesAction,
  countChargesAction,
  spendingAction,
  planAction,
  walletKeysAction,
  walletKeyCountAction,
  listAdminsAction,
  countAdminsAction,
  listCandidatesAction,
  adminModelsAction,
  adminModelSummaryAction,
];
