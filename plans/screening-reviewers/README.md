# Screening with reviewers (OS-36)

A screening becomes a team's work: people and AI models are its reviewers, each casts one vote a
paper, a rule settles the paper, and a person settles what the rule can't. The design is the mock
on branch `mock/screening-reviewers` (`components/screening-mock/`, routes under
`/screening/mock`). This plan records what was decided, what is reused, the data shape and its
migration, and when the work is done. How agents work is in the root `AGENTS.md` and
`docs/agents/project.md`.

## Fixed decisions

Agreed by the user between 23 and 26 November 2026.

1. A reviewer is a person or a model. Each casts one vote a paper: include, maybe or exclude.
2. A person gives a decision, and a reason on Exclude: any criterion can be the reason. Answering
   each criterion is optional.
3. A model answers every criterion. Its vote follows its must-have answers: a no excludes, an
   unclear makes it maybe, else it includes. The minimum score is gone. Points only make stars.
4. A rule settles a paper: every reviewer agrees, most do, or the first vote decides. Models can
   settle alone when they all agree. Whoever started the screening settles conflicts unless someone
   else is named.
5. Votes are hidden from a reviewer only on papers that still wait for that reviewer's own vote,
   unless the screening shows them always.
6. Members of the screening's workspace see and change everything. Deleting it and moving it are
   for whoever started it and the workspace's admins. People outside vote or view: the guest role
   "editor" is the voting one, shown as Reviewer, and counts in the plan's guest limit.
7. The workspace that holds the screening pays for every model's reading, whoever added the model.
   Nothing tracks what each person spent. Hand screening is free.
8. One pass on title and abstract. No full-text stage. Maybe is a result a paper can end on.
9. A paper with no abstract is not screened, unless it comes with its own PDF. Its source leaves it out
   and lists it with the reason. So does a file that doesn't open, a record with no title, and a DOI that
   isn't found. A paper with its own PDF and no abstract is screened as the PDF: people read it in
   the page, and each AI reviewer is sent the whole file, which the workspace pays for. A scan is read
   the same way. Nothing is written by a model in place of an abstract. (Changed on 26 November: before,
   such a PDF was left out.)
10. Sources: a search, the library or a collection, another screening's included papers, a
    community, Zotero (a library or group, all of it or a collection, with or without its
    sub-collections, a range), reference files and tables, PDFs, pasted DOIs. Several a screening.
    A Zotero library of any size works: its collections are kept as rows the form pages and searches,
    and nothing is limited to a first page. A DOI neither index holds is asked of Crossref, then
    DataCite. A paper our own index holds with no abstract takes OpenAlex's.
    The form has the server read a new screening's sources before it starts, so it says what each
    holds, what another already brought and what is left out, as counted by what takes the papers.
11. Duplicates across sources: the same index ID, then the same DOI, then title and year only where
    one side has no DOI. The first source added keeps the paper.
12. A record no index knows is saved to the library when it is included, with what its source gave.
13. An uploaded PDF is its adder's own file. It never goes into the copies other accounts read
    (`convex/lib/paperPdfs.ts`), and it is shown to the people on its screening only. A cheap model
    reads its first two pages once, as the file, for its title and its DOI. Where the index holds that
    DOI under that title, the paper shows the index's title and abstract. PDFs are added in any number:
    each is a row of `screeningFiles`, read as work in the pool.
    A model is given a file the way the assistant gives one (`convex/assistant/`). The PDF code on the
    extraction side is not used: it is to be replaced.
14. Living screening: the growing sources are checked again every day, week or month, or by hand.
    A check asks the same index its search ran on. Only new papers join, at the end of the list.
15. Limits per plan, set in Autumn beside `collections`, `concurrency` and `guests`: papers a
    screening (Free 1,000, Southern 5,000, the same for a personal workspace and an organization)
    and models a screening (5 on every plan).
16. A passage is the sentence of the abstract a text model relied on for an answer. It shows beside
    that model's answer and nowhere else. A decision model (Jev) returns none. While voting, the
    aid is the words the organiser marked on each criterion, a field beside its guidance.
17. A criterion changed to must-have on a running screening keeps people's earlier votes and flags
    them for a new vote.
18. Emails: invited, new papers arrived, a conflict waits for you. One off switch a person a
    screening.
19. The assistant reads screenings and changes nothing in them for now.
20. A running screening moves to another workspace while no model is reading.
21. "Screen all" on a results page opens the new screening form with that search picked and its
    questions as criteria. The results page's own screening is untouched and separate.
22. Translation is left out for now.
23. Existing screenings move to the new shape: one model reviewer, results kept.
24. One People panel holds everyone on a screening, in place of separate "Add a person", "Add a
    model" and "Share". A person outside the workspace is a Reviewer or a Viewer, and adding
    someone is sharing with them. What workspace members can do is said once, at its top.
    (Proposed on 25 November. On 26 November the user said what was going to be mocked "should be
    part of the final version".)

## What is reused

- Reading a set a page at a time: `convex/screening/start.ts`, `convex/paperSets/`.
- One model call a paper in a pool, with a limit per workspace: `convex/screening/workpoolActions.ts`,
  `slots.ts`, `convex/workpool.ts`. One bookkeeping writer in batches: `bookkeeping.ts`
  (`@convex-dev/batch-worker`). What made it fast is in the memory note "Convex module load cost":
  one `enqueueActionBatch` a pass, the plan's facts read in the worker's query, light modules.
- Credits held and settled: `convex/billing/charge.ts`. Points and stars: `scoring.ts`.
- Saving included papers, pruning the source collection, community collections:
  `bookkeeping.ts` `shelve`, `convex/evidenceLibraries/writes.ts`.
- Sharing, invitations and their email: `convex/sharing/`. Activity: `convex/activity/`. Who has it
  open: `convex/presence.ts`. Moving: `convex/workspaces/move.ts`.
- Exports built a page at a time: `convex/exports.ts`. Citation files: `lib/citations/`.
- Zotero groups, collections and items: `convex/zotero/`. Community sources:
  `components/screening/library-sources.tsx`, `lib/evidence-libraries/source-address.ts`.
- Reference files: Zotero's translation server, the address communities already use
  (`services.zotero.translationUrl`). A PDF goes to a model as a file, as in `convex/assistant/pdf.ts`.
- Criteria from a research question: `screeningQuestionsSchema` in `lib/ai/core/schemas.ts`.
- The pages: the mock's components, moved from `components/screening-mock/` and fed real data.

## Data

`screeningJobs` stays the screening, with the same IDs: sharing, activity, extraction sources and
addresses all name it. `screeningResults` stays one row a paper.

New on `screeningJobs`: the research question, criteria fields (short name, must-have, guidance,
marked words, when added), the rule, the living schedule, finished and paused marks, and a shape
version. A status `draft`: the screening the form's sources are read into before it starts, seen by
its maker alone. Starting it gives its papers to the reviewers by the sum that deals a paper as it
arrives. One never started goes after a week. New on `screeningResults`: its place, its source, the check that brought it, its result
(include, maybe, exclude, conflict, waiting), who settled it, points and stars.

New tables:

- `screeningReviewers`: a person, an invited address or a model on a screening, with their counts.
- `screeningVotes`: one row a paper and reviewer it is given to. Waiting until cast. A model's row
  is its unit of work in the pool. Holds the vote, answers, confidences, passages, reason and note.
- `screeningSources`: each place papers come from, its range, what it held, took, merged and left
  out, and where a living check last stood.
- `screeningLeftOut`: what a source held and the screening doesn't take, with why.
- `screeningFiles`: each PDF handed to a screening, with what its first reading found.
- `screeningCards`: the few facts of a paper its lists are narrowed by, a small row beside it, kept
  by a trigger: counts under a filter are read from these, since a few thousand whole papers are
  more than one read holds.
- `zoteroTrees` and `zoteroCollections`: a person's Zotero collections as last read, with what each
  holds with everything under it.
- `screeningChecks`: each check of the sources, what it found and added.
- `screeningAgreement`: for each pair of reviewers, how their votes fell against each other.
- `screeningMessages` and `screeningThreadReads`: a paper's discussion, and what each person has read.
- `screeningNotices`: who turned a screening's emails off.

One owner for each invariant:

- A paper's result and the screening's counts: the bookkeeping worker, the only writer of both.
- Who a paper is given to: the function that deals papers, run when papers arrive and when the
  rule or the people change.
- What a reviewer may see of other votes: one function, read by every query and every export.
- Whether two records are one paper: one function, used by every source.

## Migration

Widen, migrate, narrow. The widening lands in `dev` alone first, so the test backend's rows never
hold a shape another branch refuses. Then the feature. Then a migration
(`@convex-dev/migrations`) gives every existing screening one model reviewer, the rule "first vote
decides", a vote for each screened paper from its answers, a result from its outcome (included to
include, unclear to maybe, excluded to exclude, failed to a failed read), and its changed answers as
a result set by that person. Then the old fields and the old pages go. Shared dev is migrated when
this ships to dev. Production follows later, with the same migration.

## Slices

1. Schema widening.
2. Core: a screening with people, the rule, votes, results, counts. List, form, frame, Screen,
   Papers and Overview on real data.
3. Models as reviewers: several a screening, passages, the workspace pays, pause, resume, retry.
4. Sources: several a screening, duplicates, what is left out, files, PDFs, DOIs, Zotero, limits.
5. Living checks, emails, discussion, outside reviewers, activity, finish, reopen, delete, move.
6. Changing a running screening with what the change does shown first. Exports.
7. Migration, removal of the old screening, every language, the assistant's read-only actions,
   size cases.

Each slice is checked by its own Convex tests, then walked in a browser on a throwaway Convex
project by first-use walkers who see only the screen, with coherence, duplication and wording
checkers beside them.

## Done when

- Every part of the mock works on real data at `/screening`, and the mock's folder and routes are gone.
- The rule cases, the visibility function and the dealing function each pass their tests for every
  setting against every change mid-course.
- A screening at each plan's paper limit loads every page, exports and checks within Convex's limits.
- Models read in the pool at the rate today's screening does, measured on the same backend.
- Shared dev's existing screenings open in the new pages with their results.
- `npm run check:user-actions`, `check:convex-rules`, `check:ui-rules` and CI pass.

## Risks

- The Papers page offers many filters with several sorts. Each combination that isn't a search
  needs an index, so the set offered is the set indexed.
- "What saving does" is a pass over every paper. At the paper limit it takes a moment and shows a wait.
- A living check of a Zotero source runs through the Zotero account of whoever added it.
- Our own index refuses "created since". A check of a search on it runs the search again.
