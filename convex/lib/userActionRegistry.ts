/**
 * Every registered user action, in one list. The assistant's tools are made from it
 * (`assistantTools`), and `scripts/check-user-actions.ts` fails CI when a public
 * function built from a registry entry is missing here.
 */
import { answersOfAction, changeAction, countSearchesAction, getSearchAction, listedSearchesAction, ratingsAction, ratingsOfAction, revisionsAction, searchHistoryAction, searchHistoryEntryAction, countShortcutsAction, listedShortcutsAction, shortcutsOfAction } from "../research/records";
import { mineAction as suggestionsAction } from "../research/suggestions";
import { ensureAction as overviewEnsureAction, getAction as overviewGetAction, removeLensAction as overviewRemoveLensAction, saveLensAction as overviewSaveLensAction, setViewAction as overviewSetViewAction, viewAction as overviewViewAction } from "../research/overviews";
import { createAction as searchCreateAction, deleteAction as searchDeleteAction, removeAction as searchRemoveAction, restoreAction as searchRestoreAction, resultsAction as searchResultsAction, updateAction as searchUpdateAction } from "../research/searches";
import { countAction as paperCountAction, getAction as paperGetAction, readPdfAction as paperPdfAction, searchAction as paperSearchAction } from "../research/papers";
import { findAction as lookupFindAction, namesAction as lookupNamesAction } from "../research/lookup";
import { getAction as authorGetAction } from "../research/authors";
import { getAction as topicGetAction } from "../research/topics";
import { citeAction } from "../research/citations";
import { listAction as activityListAction, startedByAction as activityStartedByAction } from "../activity/queries";
import { countsAction as makerCountsAction, totalAction as makerTotalAction } from "../workspaces/makers";
import { setLibraryRatingAction, removeFromLibraryAction, restoreLibraryItemAction, saveToLibraryAction, setPaperInCollectionAction } from "../library/mutations";
import { collectAction as libraryCollectAction, saveAction as librarySaveAction } from "../library/papers";
import { countJobsAction as extractionJobCountAction, getJobDetailsAction as extractionJobAction, listJobsAction as extractionJobsAction } from "../extraction/queries/jobs";
import { countJobFailuresAction as extractionFailureCountAction } from "../extraction/queries/failures";
import { countJobResultsAction as extractionResultCountAction, listJobResultsAction as extractionResultsAction, summarizeJobResultsAction as extractionSummaryAction } from "../extraction/queries/results";
import { undoAction as bulkUndoAction } from "../assistant/batches";
import { messagesAction as chatMessagesAction, stepsAction as chatStepsAction } from "../assistant/replies";
import { createAction as chatCreateAction, getAction as chatAction, listAction as chatsAction, modelsAction as chatModelsAction, peopleAction as chatAccessAction, removeAction as chatRemoveAction, renameAction as chatRenameAction, setModelAction as chatModelAction } from "../assistant/threads";
import { countPapersAction as libraryCountPapersAction, papersAction as libraryPapersAction, savedPaperAction } from "../library/queries";
import { createAction as createOrganizationAction, declineInvitationAction, deleteOrganizationAction, inviteAction, leaveAction, removeMemberAction, renameAction as renameOrganizationAction, resendInvitationAction, revokeInvitationAction,  setColourAction, setRoleAction } from "../organizations/manage";
import { invitationsAction as organizationInvitationsAction, membersAction as organizationMembersAction, myInvitationsAction, summaryAction as workspaceSummaryAction, workspaceAction, workspacesAction } from "../organizations/queries";
import { heldAction as moveHeldAction, moveAction, refusalsAction as moveRefusalsAction } from "../workspaces/move";
import { addAction as guestAddAction, candidatesAction as guestCandidatesAction, invitedAction as guestInvitedAction, leaveAction as guestLeaveAction, listAction as guestListAction, removeAction as guestRemoveAction, roomAction as guestRoomAction, setRoleAction as guestRoleAction } from "../sharing/guests";
import { getAction as guestInvitationAction, inviteAction as guestInviteAction, respondAction as guestRespondAction } from "../sharing/invitations";
import { countsAction as reportCountsAction, getAction as reportAction, pageAction as reportsPageAction, startsAction as reportStartsAction } from "../reports/flow";
import { countsAction as sharedCountsAction, editableCollectionsAction as sharedEditableCollectionsAction, listAction as sharedListAction } from "../sharing/shared";
import { addToCollectionAction, countCollectionsAction, createCollectionAction, deleteCollectionAction, getCollectionAction, listCollectionsAction, ratersAction as collectionRatersAction, removeFromCollectionAction, renameCollectionAction, setCollectionRatingAction } from "../library/collections";
import { estimateAction as screeningEstimateAction, listJobsAction as screeningJobsAction } from "../screening/queries";
import { answerAction as screeningAnswerAction, getAction as screeningPaperAction, listAction as screeningPapersAction } from "../screening/papers";
import { slotsAction as screeningSlotsAction, getScreeningJobAction, listScreeningResultsAction } from "../screening/queries";
import { screenAction } from "../screening/start";
import { countAdminsAction, listAdminsAction, listCandidatesAction } from "../admins/queries";
import { countAction as countLibraryAccessAction, countPeopleAction as countLibraryAccessPeopleAction, listAction as listLibraryAccessAction, listPeopleAction as listLibraryAccessPeopleAction } from "../organizations/libraryAccess";
import { listModelsAction as adminModelsAction, summaryAction as adminModelSummaryAction } from "../models/admin";
import { balanceAction, countChargesAction, listChargesAction, planAction, spendingAction } from "../billing/usage";
import { allowanceAction, setCapAction, spendingAction as memberSpendingAction } from "../billing/caps";
import { countKeysAction as walletKeyCountAction, listKeysAction as walletKeysAction } from "../wallet/queries";
import type { UserAction } from "./userActions";
import { cancelExtractionAction, deleteExtractionAction, startJobAction as extractionStartAction, duplicateJobAction as extractionDuplicateAction } from "../extraction/mutations/jobs";
import { pauseExtractionAction } from "../extraction/mutations/pause";
import { resumeExtractionAction } from "../extraction/mutations/resume";
import { getJobCostAction } from "../extraction/queries/costs";
import { cancelScreeningJobAction } from "../screening/mutations";
import { extractAction, resumeAction as extractionResumeHeldAction, retryAction as extractionRetryAction } from "../extraction/start";
import { findAction as mentionFindAction } from "../assistant/mentions";
import { readAction as fileReadAction } from "../assistant/files";
import { searchAction as webSearchAction } from "../research/web";
import { acceptAction as applicationAcceptAction, applyAction as applicationApplyAction, declineAction as applicationDeclineAction, hideAction as applicationHideAction, mineAction as applicationMineAction, setOpenAction as applicationSetOpenAction, standingAction as applicationStandingAction, waitingAction as applicationWaitingAction, waitingCountsAction as applicationWaitingCountsAction, withdrawAction as applicationWithdrawAction } from "../evidenceLibraries/applications";
import { addMemberAction as libraryAddMemberAction, changeRoleAction as libraryChangeRoleAction, removeMemberAction as libraryRemoveMemberAction, draftAction as libraryDraftAction, librariesAction as librariesListAction, revisionAction as libraryRevisionAction, editDraftAction as libraryEditDraftAction, teamAction as libraryTeamAction, inviteAction as libraryInviteAction, changeInvitationAction as libraryChangeInvitationAction, invitationsAction as libraryInvitationsAction, answerInvitationAction as libraryAnswerInvitationAction, startLibraryAction as libraryStartLibraryAction, sourcesAction as librarySourcesAction, runningCollectionsAction as libraryRunningCollectionsAction, runningInstitutionsAction as libraryRunningInstitutionsAction, runningPublicationsAction as libraryRunningPublicationsAction, runningPublicationAction as libraryRunningPublicationAction, syncSourceAction as librarySyncSourceAction, screeningRequestAction as libraryScreeningRequestAction, gradeSourceAction as libraryGradeSourceAction, trySourceSubjectAction as libraryTrySourceSubjectAction, setVisibilityAction as librarySetVisibilityAction, previewPapersAction as libraryPreviewPapersAction, addPapersAction as libraryAddPapersAction, addedPapersAction as libraryAddedPapersAction, removeAddedPaperAction as libraryRemoveAddedPaperAction, setAddedPapersSettingsAction as librarySetAddedPapersSettingsAction, connectCollectionAction as libraryConnectCollectionAction, putLiveAction as libraryPutLiveAction, submissionsAction as librarySubmissionsAction } from "../evidenceLibraries/assistant";
import { listPublicAction as publicCommunitiesAction } from "../evidenceLibraries/directory";
import { createAction as authorCreateAction, directoryAction as authorDirectoryAction, editorsAction as authorEditorsAction, invitationsAction as authorInvitationsAction, profileAction as authorProfileAction, publicationsAction as authorPublicationsAction } from "../authors/assistant";
import { addAction as authorRecordAddAction, claimAction as authorClaimAction, removeAction as authorRecordRemoveAction } from "../authors/links";
import { publicationsAction as topicPublicationsAction } from "../topics/assistant";
import { listAction as readLibrariesAction } from "../evidenceLibraries/readers";
import { addressAction as readerSourceAddressAction, changeRecordsAction as readerChangeRecordsAction, createCollectionAction as readerCreateCollectionAction, deleteCollectionAction as readerDeleteCollectionAction, recordsAction as readerRecordsAction, sourceAction as readerSourceAction, sourcesAction as readerSourcesAction } from "../evidenceLibraries/library";
import { openAction as libraryHandoffAction } from "../evidenceLibraries/handoffs";
import { collectionsAction as zoteroCollectionsAction, groupsAction as zoteroGroupsAction, itemsAction as zoteroItemsAction, pdfAction as zoteroPdfAction } from "../zotero/library";

export const USER_ACTIONS: readonly UserAction[] = [
  authorDirectoryAction,
  authorProfileAction,
  authorEditorsAction,
  authorInvitationsAction,
  authorCreateAction,
  authorClaimAction,
  authorRecordAddAction,
  authorRecordRemoveAction,
  authorPublicationsAction,
  topicPublicationsAction,
  zoteroGroupsAction,
  zoteroCollectionsAction,
  zoteroItemsAction,
  zoteroPdfAction,
  librariesListAction,
  readLibrariesAction,
  readerSourcesAction,
  readerSourceAddressAction,
  readerSourceAction,
  readerRecordsAction,
  readerCreateCollectionAction,
  readerDeleteCollectionAction,
  readerChangeRecordsAction,
  libraryHandoffAction,
  libraryDraftAction,
  libraryRevisionAction,
  libraryTeamAction,
  libraryEditDraftAction,
  libraryAddMemberAction,
  libraryChangeRoleAction,
  libraryRemoveMemberAction,
  libraryInviteAction,
  libraryChangeInvitationAction,
  libraryInvitationsAction,
  libraryAnswerInvitationAction,
  libraryStartLibraryAction,
  librarySetVisibilityAction,
  applicationApplyAction,
  applicationWithdrawAction,
  applicationHideAction,
  applicationMineAction,
  applicationStandingAction,
  applicationWaitingAction,
  applicationWaitingCountsAction,
  applicationAcceptAction,
  applicationDeclineAction,
  applicationSetOpenAction,
  libraryPreviewPapersAction,
  libraryAddPapersAction,
  libraryAddedPapersAction,
  libraryRemoveAddedPaperAction,
  librarySetAddedPapersSettingsAction,
  libraryConnectCollectionAction,
  libraryPutLiveAction,
  librarySubmissionsAction,
  publicCommunitiesAction,
  librarySourcesAction,
  libraryRunningCollectionsAction,
  libraryRunningInstitutionsAction,
  libraryRunningPublicationsAction,
  libraryRunningPublicationAction,
  librarySyncSourceAction,
  libraryScreeningRequestAction,
  libraryGradeSourceAction,
  libraryTrySourceSubjectAction,
  extractionStartAction,
  extractionDuplicateAction,
  cancelExtractionAction,
  deleteExtractionAction,
  pauseExtractionAction,
  resumeExtractionAction,
  extractionRetryAction,
  extractionResumeHeldAction,
  getJobCostAction,
  cancelScreeningJobAction,
  chatsAction,
  chatAction,
  chatAccessAction,
  chatCreateAction,
  chatRenameAction,
  chatModelAction,
  chatModelsAction,
  lookupNamesAction,
  authorGetAction,
  topicGetAction,
  citeAction,
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
  suggestionsAction,
  overviewViewAction,
  overviewGetAction,
  overviewEnsureAction,
  overviewSaveLensAction,
  overviewRemoveLensAction,
  overviewSetViewAction,
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
  deleteOrganizationAction,
  moveHeldAction,
  moveRefusalsAction,
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
  reportsPageAction,
  reportAction,
  reportCountsAction,
  reportStartsAction,
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
  listLibraryAccessAction,
  countLibraryAccessAction,
  listLibraryAccessPeopleAction,
  countLibraryAccessPeopleAction,
  listCandidatesAction,
  adminModelsAction,
  adminModelSummaryAction,
];
