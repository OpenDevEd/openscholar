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
import { countChange } from "../research/recordCounts";
import { copyChangedFacets, countItemChange, fillAndCountMembership } from "../library/facets";
import { countAnswerChange, countPaperChange as countPaperFacets } from "../extraction/facets";
import { tallyAnswerChange } from "../extraction/tallies";
import { ADMIN_LIST, countList, libraryVersionList, organizationLibrariesOf, walletKeyList } from "./listCounts";

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
triggers.register("walletKeys", countList(walletKeyList));
triggers.register("admins", countList(() => ADMIN_LIST));
triggers.register("evidenceLibraryConfigOperations", countList(libraryVersionList));
triggers.register("evidenceLibraries", countList((library) => organizationLibrariesOf(library.organizationId)));
// A collection's view and every filtered count read what these keep (convex/library/facets.ts).
triggers.register("libraryItems", copyChangedFacets);
triggers.register("libraryItems", countItemChange);
triggers.register("libraryItemCollections", fillAndCountMembership);
// An extraction job's filtered views, counts and summaries read what these keep (convex/extraction/facets.ts, tallies.ts).
triggers.register("extractionPapers", countPaperFacets);
triggers.register("extractionAnswerRows", countAnswerChange);
triggers.register("extractionAnswerRows", tallyAnswerChange);
