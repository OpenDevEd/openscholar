/**
 * Database triggers: code that runs in the same transaction as every insert, update and
 * delete of a table, whichever function makes it. Counters kept from a table register
 * here, so they can't drift from the rows they count (#351). The builders in
 * `./functions.ts` apply them, and so does `t.run` in tests (tests/convex-test-with-limits.ts).
 */
import { Triggers } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { settleEndedJob } from "../billing/spend";
import { noteEndedJob, tellIdleChat, trackChatJob } from "../assistant/jobEnds";
import { countJobChange, countPaperChange, countPaperErrorChange, countResultChange, reviseQuestionChange } from "../extraction/counts";
import { nameJob } from "../extraction/jobList";
import { recordRevisionApprovedQueries } from "../evidenceLibraries/approvedQueries";
import { countChange, countMakerChange } from "../research/recordCounts";
import { copyChangedFacets, countItemChange, fillAndCountMembership } from "../library/facets";
import { rerateOnMembership } from "../ratings";
import { countAnswerChange, countPaperChange as countPaperFacets } from "../extraction/facets";
import { tallyAnswerChange } from "../extraction/tallies";
import { adminText, jobText, keepSearchText, keepTextOfUser, memberText, searchText, shortcutText } from "./searchText";
import { ADMIN_LIST, countList, libraryVersionList, walletKeyList, workspaceLibrariesOf } from "./listCounts";
import { followShared, itemGuestsOf, sharedWithOf } from "../sharing/items";
import { refreshOnSearch } from "../research/suggestionRefresh";
import { recountOnGrant, recountOnMembership } from "../evidenceLibraries/peopleCount";

export const triggers = new Triggers<DataModel>();

triggers.register("extractionJobs", countJobChange);
triggers.register("extractionJobs", nameJob);
triggers.register("extractionJobs", countChange("extractionJobs"));
// Named by its path: the module that defines it is built with these triggers.
triggers.register("extractionJobs", settleEndedJob<Id<"extractionJobs">>(makeFunctionReference("extraction/start:settleHold")));
triggers.register("extractionResults", countResultChange);
triggers.register("extractionQuestions", reviseQuestionChange);
triggers.register("extractionPaperErrors", countPaperErrorChange);
triggers.register("extractionPapers", countPaperChange);
triggers.register("evidenceLibraryConfigSections", recordRevisionApprovedQueries);
triggers.register("searches", countChange("searches"));
// A search asks for its maker's suggested searches to be written again (../research/suggestionRefresh.ts).
triggers.register("searches", refreshOnSearch);
triggers.register("queryShortcuts", countChange("queryShortcuts"));
triggers.register("screeningJobs", countChange("screeningJobs"));
triggers.register("screeningJobs", settleEndedJob<Id<"screeningJobs">>(makeFunctionReference("screening/start:settleHold")));
// A job a reply started tells its chat when it ends; a chat that stops being busy hears the ends that waited (convex/assistant/jobEnds.ts).
triggers.register("screeningJobs", noteEndedJob("screening"));
triggers.register("extractionJobs", noteEndedJob("extraction"));
// While it runs, a job a reply started has a row its chat docks the job's live card from.
triggers.register("screeningJobs", trackChatJob("screening"));
triggers.register("extractionJobs", trackChatJob("extraction"));
triggers.register("assistantThreads", tellIdleChat);
// Each maker's count, in an organization, for its lists' Run by (#656).
for (const table of ["searches", "queryShortcuts", "screeningJobs", "extractionJobs", "collections", "assistantThreads"] as const) triggers.register(table, countMakerChange(table));
triggers.register("walletKeys", countList(walletKeyList));
triggers.register("admins", countList(() => ADMIN_LIST));
triggers.register("evidenceLibraryConfigOperations", countList(libraryVersionList));
triggers.register("evidenceLibraries", countList((library) => (library.workspaceId ? workspaceLibrariesOf(library.workspaceId) : null)));
// A collection's view and every filtered count read what these keep (convex/library/facets.ts).
triggers.register("libraryItems", copyChangedFacets);
triggers.register("libraryItems", countItemChange);
triggers.register("libraryItemCollections", fillAndCountMembership);
// An extraction job's filtered views, counts and summaries read what these keep (convex/extraction/facets.ts, tallies.ts).
triggers.register("extractionPapers", countPaperFacets);
triggers.register("extractionAnswerRows", countAnswerChange);
triggers.register("extractionAnswerRows", tallyAnswerChange);
// What each list's search index matches (./searchText.ts).
triggers.register("searches", keepSearchText("searches", (_ctx, row) => searchText(row.data)));
triggers.register("queryShortcuts", keepSearchText("queryShortcuts", (_ctx, row) => shortcutText(row.data)));
triggers.register("extractionJobs", keepSearchText("extractionJobs", (_ctx, row) => jobText(row)));
triggers.register("admins", keepSearchText("admins", adminText));
triggers.register("organizationMemberships", keepSearchText("organizationMemberships", memberText));
// Someone joining or leaving an organization moves its papers' averages (convex/ratings.ts).
triggers.register("organizationMemberships", rerateOnMembership);
triggers.register("users", keepTextOfUser);
// Guests (#653): an item's count is the people given it and the invitations still waiting, and a person's is what's shared with them, in all and of each kind.
// A community's count of people follows its team and its organization's admins (../evidenceLibraries/peopleCount.ts).
triggers.register("itemAccess", recountOnGrant);
triggers.register("organizationMemberships", recountOnMembership);
triggers.register("itemAccess", countList((grant) => itemGuestsOf(grant.item)));
triggers.register("itemInvitations", countList((invitation) => (invitation.state === "pending" ? itemGuestsOf(invitation.item) : null)));
triggers.register("itemAccess", countList((grant) => (grant.kind === "library" ? null : sharedWithOf(grant.userId))));
triggers.register("itemAccess", countList((grant) => sharedWithOf(grant.userId, grant.kind)));
triggers.register("collections", followShared("collection"));
triggers.register("screeningJobs", followShared("screening"));
triggers.register("extractionJobs", followShared("extraction"));
triggers.register("searches", followShared("search"));
triggers.register("authorProfiles", followShared("author"));
triggers.register("assistantThreads", followShared("chat"));
triggers.register("evidenceLibraries", followShared("library"));
