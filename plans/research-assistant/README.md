# Research assistant that can do everything a user can

Milestone: OS-17, issues OpenDevEd/openalex-count#321–#329, #334–#336, #341 and
#342. Supporting issues in other milestones: #51 and #343 (OS-12), #337, #339
and #344 (OS-14), #338 (OS-13), and OpenDevEd/new-el#465 (EL-16). Workflow
rules live in the root `AGENTS.md` and `docs/agents/project.md`.

## Problem

OpenScholar's chat is a mode of an extraction job. "Start chat" copies a
search's papers into the job, and every turn sends every abstract to the
model. The chat can't search OpenAlex, change a search, or touch bookmarks,
collections, screening, extraction or libraries. It also can't see what the
user is looking at.

Most of the state the assistant would act on doesn't exist on the server.
Search history, the Bookmarks page's query shortcuts and paper ratings live
only in the browser.

## Goal

An assistant that works the product the way a person does, and can do
everything a user can, calling the same actions as the UI:

- searches OpenAlex, reads and pages through results, and changes the user's
  search while the user watches;
- creates and edits bookmarks, collections and saved papers by ID;
- starts screening and extraction jobs and reads their results;
- edits Evidence Library drafts;
- later, writes documents and PDFs.

## Fixed decisions (2026-09-30)

1. **Extraction becomes extraction only.** The assistant is a separate
   feature. "Start chat" opens an assistant thread with an @ mention of
   that search already in the composer, so the first message carries its ID;
   papers are no longer copied into the prompt. Changed on 2026-09-30, see
   "Decision changes".
2. **The assistant can do everything a user can, and nothing more.** Every
   user action is registered once in an action registry. The UI mutation and
   the assistant tool are both generated from that entry. A CI check fails
   when a public mutation or action is neither registered nor exempt with a
   reason. A new feature therefore has to decide its assistant story before
   it ships.
3. **Tools address records by ID.** Searches, shortcuts, collections, saved
   papers, ratings, jobs and libraries are Convex records with IDs. Tools
   return IDs, and later calls use them.
4. **The assistant changes the page by changing the record.** The page
   subscribes to the record, so an assistant edit shows live for everyone who
   has it open. Browser-only tools handle view actions that store nothing,
   such as navigating, scrolling to a paper or opening a panel.
5. **Search history, query shortcuts and ratings move to Convex.**
   Signed-out users keep the local stores. Signing in imports them once.
   Display preferences stay local. User API keys (`ai-config-storage`)
   never reach the assistant.
6. **Chats belong to people.** The owner grants read or write access to users
   or organizations, and an organization grant covers every member. Tools run
   as whoever sent the message, with that person's permissions and credits. Sharing
   a chat shares the conversation only, including the excerpts already in it.
   Searches, collections, jobs and libraries keep their own access, and the
   assistant never shows the sender a record they can't open. The share sheet
   says so. Decided on 2026-09-30, after review.
7. **Chats range over the whole account.** Nothing is attached to a chat: the
   assistant can reach every record the sender can, through account search.
   Typing @ in a message points at one record precisely, and the message
   stores that record's ID. Changed on 2026-09-30, see "Decision changes".
8. **Spending credits always asks first.** The approval card shows the
   estimate and offers **Allow once** and **Always allow in this chat**. The
   allowance is stored per chat and per person, can carry a per-action credit
   cap, and can be turned off in the chat's settings. Reversible writes with no
   effect outside the account run without asking and offer undo. Replies
   themselves are billed like chat messages today, without approval, under a
   per-turn credit cap shown in the composer; the turn pauses at the cap. An approval covers
   one payer, operation, set of inputs and maximum spend. After a top-up, the
   waiting operation resumes once. Stop ends the reply and drops its queued
   follow-ups, but a running job keeps going and keeps its own Cancel.
   Decided on 2026-09-30, after review.
9. **Heavy reading runs through our own features, not sub-agents.** The
   assistant orchestrates: "compare methods across 300 papers" becomes an
   extraction job, and the assistant reads its structured results. When a
   general-purpose sub-agent keeps being needed for the same kind of task,
   that task becomes a feature. The job is the showpiece: a live card in the
   thread with progress, credits and results, and a short readout when it
   finishes.
10. **Build on Convex agent and AI SDK 7.** See "Tools considered" for why
    the other frameworks were not adopted.
11. **Every request ends in a result.** When a tool can't give a person what
    they'd reasonably expect from a request, the tool changes; the assistant
    never stops at a limitation an issue here could remove. That means jobs
    take sets of papers by ID and resolve them on the server (#341), every
    reversible change returns the command that reverses it (#342), a job over
    a plan limit waits in a queue instead of being refused (#335), and a
    finished job wakes the chat so the assistant carries on (#328), including
    settling unclear screening answers itself. Numbers the assistant shows
    come from the real estimators and job results. Added on 2026-09-30, after
    checking every step of the mock against the code.
12. **Undoable is not the same as safe.** Each action is labelled on three
    separate counts: whether it spends credits, whether it has an effect
    outside the account (publishing, access changes, a collection that syncs
    to a public library), and whether it can be undone. Anything with an
    outside effect asks first, even when it can be undone. Approval only comes
    from the person's own click in the UI, never from text the model read or
    another participant's message. Added on 2026-09-30, after review.

## Decision changes

- **2026-09-30, decisions 1 and 7.** Was: a chat starts from whatever it
  was opened on and can attach more records as it goes, and "Start chat"
  opens a thread with the search attached by ID. Now: nothing is attached.
  The assistant reaches every record the sender can through account search,
  and @ in a message points at one record by ID; "Start chat" puts an @
  mention of the search in the composer. Reason: the assistant can already
  reach everything the person can, so attaching only added a step and a
  second list to manage, while @ keeps the one thing attaching did well,
  pointing at an exact record. Proof: the assistant mock on branch
  `mock/research-assistant` (commit 9f607773) runs the whole flow without
  attaching, with the @ picker in the composer.
- **2026-10-02, how the remaining steps are built.** The decisions above stand.
  What changed is how steps 4b to 14 are built, after the Convex-limits work
  (OS-18, #350 to #413) measured the system at full size:
  - Was: jobs, operations and thread events wrote wherever was convenient. Now:
    each item writes only its own rows, and a batch worker does shared
    bookkeeping, as Screen all (`convex/screening/bookkeeping.ts`), the usage
    ledger (`convex/billing/ledger.ts`) and extraction
    (`convex/extraction/queue/dispatcher.ts`, `convex/extraction/countsWorker.ts`)
    already do. Reason: on e2e, 40 writers into one screening lost a third of
    their writes to conflicts. Proof: #383, #390, #405 to #407.
  - Was: "reserve and settle billing" in general. Now: an approval's maximum
    spend is an Autumn hold, and under it the hold is the only Autumn charge.
    Each item records its cost in the usage ledger only, and the hold is
    confirmed once with their sum when the work ends. The per-reply cap is a
    hold per reply, settled the same way. Screen all started from the page
    keeps its per-item `track` with no hold. Reason: #395 moved every charge
    onto Autumn's lock-confirm flow; combining a parent hold with per-item
    tracks would deduct the same usage twice. Proof: #395, #405, the review
    of PR #414, and Firecrawl, which does both the same way: a monitor check
    locks its estimate for an hour and confirms the lock once with the pages'
    actual total (`apps/api/src/services/monitoring/runner.ts`), while a
    crawl bills each page through batch billing with no lock.
  - New: what reaches the model is exactly what a registry entry's `returns`
    validator declares. `check:convex-rules` fails on any function that can
    return a field its validator doesn't declare, so an internal column can't
    reach the model or another person in a shared chat. Reason: `mine`
    returned an internal billing column on 2026-10-02 and crashed every page
    during charges. Proof: #412, #413.
  - Was: paper sets resolved on the server, with no speed target. Now: the
    resolver asks OpenAlex only for the fields a job keeps and reads numbered
    pages in parallel (OpenAlex allows them up to 10,000 results). Screen all's
    button and the assistant use the same path: the button waits for the
    resolve, then shows the running job. Reason: for 1,000 papers, today's
    browser reads take 12.8 s for 22 MB of complete works; the same papers
    with only the fields Screen all keeps, in five parallel pages, take about
    2 s. Proof: timed against the OpenAlex API on 2026-10-02. The user chose
    the waiting button the same day.
  - Was: "how many screening jobs run at once per plan" (#335). Now, copied
    from Firecrawl: there's no limit on jobs. Each person has a limit on
    papers running at once, set by their plan's `concurrency` balance in
    Autumn. A job's papers beyond it wait in that person's queue, oldest
    first, and each paper that finishes starts the next one. A job may also
    set a lower cap of its own. The shared pools stay as the backend's total
    capacity, with every person's limit below it. Reason: the pools are shared
    by everyone (Screen all 20 papers at a time, extraction 40). Screen all
    enqueues every paper of a job when it's created, and extraction's
    dispatcher gives one job a window as large as the whole pool, so in both a
    second person's job waits behind the first one's papers. Proof:
    Firecrawl's per-team semaphore and queue (`apps/api/src/lib/concurrency-limit.ts`:
    `getEffectiveConcurrencyLimit` reads Autumn's `CONCURRENCY` balance,
    `concurrentJobDone` promotes queued work while the team is under it, and
    `maxConcurrency` caps a single crawl).
  - Was: the plan treated shared dev as disposable development data. Now:
    shared dev is the live deployment. Migrations run there, and its data is
    user data, so #325 moves existing chat threads into assistant threads
    instead of deleting them.
- **2026-10-04, the old chats.** Was: #325 moves shared dev's chat jobs into
  assistant threads before deleting chat mode. Now: #325 deletes them. Reason:
  the user said the chat data can go; the chat is a system that leaves once
  the assistant exists, and nothing more is built on it. For the same reason
  the chat's lists were not paged under #422: its seven pending entries in
  `scripts/convex-rules.json` name #325 and leave with that code (#467). "Start
  chat" still puts an @ mention of the search in the composer; the user kept
  that the same day. Everything else on shared dev stays user data.

## Tools considered (2026-09-30)

| Option | Decision | Reason |
|---|---|---|
| `@convex-dev/agent` (Apache-2.0) | Keep, upgrade to 0.7 | Threads, messages and streaming live in our Convex, under our auth, updating live for every viewer |
| AI SDK 7 (Apache-2.0) | Keep | Agent loop, `needsApproval`, `toolSearch()` with `deferLoading`, `activeTools`, `prepareStep`, `toModelOutput` |
| CopilotKit + AG-UI (MIT) | Borrow the ideas only | Persistent threads, replay and memory are in its cloud-hosted "Intelligence"; self-hosting adds a runtime and a SQLite-style store beside Convex |
| Mastra (Apache-2.0 except `ee/`) | Not the runtime | `@mastra/convex` runs Mastra on its own Node server against Convex with the admin key and its own tables, bypassing per-user auth |
| LangGraph JS (MIT), Letta (Apache-2.0) | No | Another service with its own state |
| assistant-ui (MIT) | No | We already use AI Elements |
| `@convex-dev/workflow` (Apache-2.0) | Use | Durable job orchestration and runs paused on approval |
| `@convex-dev/presence` (Apache-2.0) | Use | Who is viewing a shared chat, and each user's current view |
| Tiptap (MIT) + `@convex-dev/prosemirror-sync` (Apache-2.0) | Use later | Collaborative documents stored in Convex that the server can edit |
| Typst (Apache-2.0) | Use later | Document to PDF |
| MCP TypeScript SDK | Later | Serve the same registry as an MCP server |

BlockNote was set aside because its AI packages are GPL-3.0 or paid.

## Current code to reuse

- OpenAlex search and paging on the server: `lib/openalex/*` (the shared
  query builder in `works-query.ts`, one page in `read-works.ts`), with
  OpenScholar's key. `readSearchPage` in `app/actions/openalex.ts` is what the
  screening dialog calls from the browser today; the paper-set resolver (#341)
  replaces that path. History searches already resolve on the server in
  `convex/extraction/expandSources.ts`.
- The action registry, built in #347: `convex/lib/userActions.ts`
  (`defineUserQuery`, `defineUserMutation`), `convex/lib/userActionRegistry.ts`,
  the tool builder `convex/lib/assistantTools.ts`, and the gate
  `scripts/check-user-actions.ts` with `scripts/user-actions-exempt.json`.
- Research records and screening answers: `convex/research/records.ts`
  (`applyCommand`), and the screening record from #385, whose answers a single
  writer moves in `convex/screening/drain.ts`.
- Batch-worker bookkeeping on `@convex-dev/batch-worker`:
  `convex/screening/bookkeeping.ts`, `convex/billing/ledger.ts`,
  `convex/extraction/queue/dispatcher.ts` and `convex/extraction/countsWorker.ts`.
  Live job progress reads `screeningJobProgress` and `extractionJobCounts`.
- The history entry's shape: `SearchResult` in `lib/types/search.types.ts`,
  and `migrateSearchHistoryState` and `importSearchHistory` in `lib/store.ts`.
- Credit estimates: `lib/extraction/cost-estimate.ts`, and `estimateScreening`,
  which the screening dialog and `createScreeningJob` both use.
- Billing on Autumn (#395): holds settled with one lock confirm and recorded in
  `billingHolds`, per-item tracking for bulk work, and one throttled account
  refresh per user (`convex/billing/charge.ts`, `convex/billing/accounts.ts`).
- CI rules that every new function meets: `scripts/check-convex-rules.ts`
  (bounded reads, `returns` validators that declare exactly what's returned,
  clock-free queries, triggers on every write), and Convex tests that run
  under Convex's transaction limits.
- Paper search index: `@convex-dev/rag`, as used in
  `convex/extraction/workpoolActions.ts`.
- Chat streaming, stop and billing: `convex/chat/messages.ts`,
  `convex/chat/billing.ts` and `convex/chat/concurrency.ts`. These move to the
  assistant, and the extraction-specific parts go.
- Chat UI on AI Elements: `components/extraction/chat/*` (#309/#310).
- Organization roles: the Clerk projection in `organizationMemberships`, and
  the Evidence Library Owner and Editor checks.

## Architecture

### Action registry (#323)

One entry per user action: the core function (acting user plus arguments,
with the access checks inside), input schema, assistant-facing description,
the three properties from decision 12, a credit estimator for actions that
spend credits, and the command that reverses it when it can be undone (#342).
The public mutation and the assistant tool are generated from the entry. The
CI check lists `convex/` public functions and Next.js server actions against
the registry and a reasoned exempt list, such as auth plumbing and webhooks.
The exempt list is only for plumbing, never for a missing user action. The
inventory includes creating a library, finding, cancelling and retrying jobs,
and exports.

### Records (#322, built in PR #332)

- `searches`: owner, query, field, filters with the `SearchResult` filter
  shape, sort, last page, query and question history, and screening
  questions. Screening answers are stored in chunks inside the search today;
  #334 moves them to their own table first, because changing one answer
  stores every response of the search again.
- `searchRevisions`: every change, recording whether a user or the assistant
  made it. Undo restores a revision through a restore command (#342).
- Every change goes through `applyCommand(ctx, userId, command, author)` in
  `convex/research/records.ts`. Assistant tools call it with
  `author: "assistant"`. The per-request receipts live in the `change`
  mutation around it, not in `applyCommand`, so tools get them through the
  shared operations below. The read queries still check the browser's account;
  #323 gives them user-ID cores.
- Searches and collections get a text search index for account search
  (#327). Saved papers already have one.
- `queryShortcuts`: today's Bookmarks page.
- `paperRatings`.

Results are never stored. They're fetched on the server through
`lib/openalex`.

### Assistant threads (#324)

- `assistantThreads`: owner, title, the IDs of the records it has worked on,
  and the `@convex-dev/agent` thread ID.
- `assistantThreadAccess`: principal (user or organization) and role (`read`
  or `write`).
- `assistantAllowances`: thread, user, kind (`spendCredits`), optional
  per-action credit cap.
- One reply per thread at a time, reusing the existing thread lock.

### Context per turn (#326)

1. Instructions and the core tools. These never change, so they stay cached.
2. A snapshot rebuilt from Convex for the person sending the message: the
   records the current message and the recent turns point at with @, open
   jobs, and the sender's current view. Each record is checked against the
   sender's access first, so one they can't open never reaches the model,
   including after access is revoked. The thread keeps the IDs of every
   record it has worked on, and tools load any of them on demand, so the
   snapshot stays bounded however long the chat runs.
3. A running summary of older turns, compacted in large chunks under a
   per-model budget.
4. Recent turns, with old tool results cut to one line.

Everything else arrives through tools:

- Deferred tools are found with `toolSearch()`, and the current page's tools
  are pre-loaded with `activeTools`.
- Results are paged and filterable, and go to the model as a summary plus IDs
  (`toModelOutput`), built only from the registry entry's validated result.
- Past chats are searched through a tool, never pre-loaded.
- OpenAlex requests count against the sender's own allowance (300 a minute,
  20,000 a day per account). Today that limit lives in the Next.js process
  (`lib/openalex/spend-requests.ts` over `request-limiter.ts`), keyed by the
  Clerk session, so a Convex action such as the #341 resolver would bypass
  it. The limit moves into Convex, keyed by the acting user, on
  `@convex-dev/rate-limiter`, and the Next.js actions and Convex actions both
  spend from it. Firecrawl does the same with `rate-limiter-flexible` on
  Redis, keyed by team (`apps/api/src/services/rate-limiter.ts`). Each turn has an OpenAlex request budget on top, and a count
  check asks for one result, not a page.

### View context (#327)

Each message carries the route, the IDs on screen, the page, the selection
and the open panel. The same view goes to presence, so shared chats see each
other's context.

### Jobs (#328)

Start through the registry after approval. The tool returns the job ID at
once. A live card renders from the job's progress rows (`screeningJobProgress`,
`extractionJobCounts`), which the batch workers keep. Completion adds a thread
event as its own row, written by the step that finishes the job (`finishIfDone`
in Screen all's bookkeeping, the counts worker in extraction), never by each
paper. The assistant writes a readout. Jobs are never refused for being too
many (#335). Each person can have a limited number of papers running at once,
set by their plan's `concurrency` balance in Autumn. A job's papers wait in that
person's queue, and the batch worker that does a job's bookkeeping starts the
next queued papers whenever that person is under their limit, as Firecrawl's
`concurrentJobDone` does. Extraction's dispatcher
(`convex/extraction/queue/dispatcher.ts`) already refills from a batch worker,
per job; it changes to refill per person. Screen all moves onto the same
dispatcher instead of enqueuing every paper at creation. A queued job checks
credits, access and limits again when it starts, and a periodic sweep starts
queued jobs nothing woke. Extraction results are analysed on the server with
filter, group and count, so a comparison covers every row rather than the
first page. Fields added to a job (#344) report their own completion. Extraction's yes/no fields go to the
job's decision model when it has one (Jev today) and show as unquoted
decisions; every other answer, from any model, carries its quote (#339).

### Operations (#323, #328)

Every tool call and UI action that changes something runs as an operation
with a stored ID, receipt and result, shared by the UI and the assistant.
Operations, receipts and thread events are rows of their own; nothing patches
a shared thread or job record per step.
Retry resumes the unfinished operation; it never replays finished work or
rewinds charges. Editing a message starts a new request and keeps the history
of what the old one did. A finished job resumes the chat exactly once, as the
original sender, with their access and allowance checked again. The reply
lock is released while a job runs. `@convex-dev/workflow` coordinates this on
top of the existing job queues.

Credits use the flow from #395. An approval's maximum spend is an Autumn hold,
recorded in `billingHolds`. Under it the hold is the only Autumn charge: each
item writes its cost to the usage ledger without calling Autumn, the work
stops when the ledger reaches the approved maximum, and the hold is confirmed
once with the sum when the work ends. A reply holds its per-reply cap the same
way. Screen all started from the page has no approval and keeps its per-item
`track` (`hold: false`); a job never uses both paths. The hold's expiry covers
the job's expected length, and the `billingHolds` backstop releases it if the
work never ends.

### Paper sets (#341)

Screening, extraction and collection changes take a paper set instead of
paper objects from the browser: a saved search, a collection, saved papers, a
screening's included or unclear papers, or a list of IDs. One resolver on the
server turns it into papers. A saved search maps its fields to the parameters
`buildOpenAlexWorksQuery` takes, the builder the results page and extraction
already share, and applies the rating filters ("only rated papers" and the
rating range) from the account's `paperRatings`, as the results page does in
the browser. So it returns the same papers as its results page. The resolver
asks OpenAlex only for the fields the job keeps (`select`) and reads numbered
pages in parallel, which OpenAlex allows up to 10,000 results; 1,000 papers
take about 2 s that way, against 12.8 s for the browser's cursor pages today.
Screen all's button calls the same resolver as the assistant, waits for it,
and then shows the running job. The set is resolved into a fixed list before
approval, recording the source's revision,
the papers in order, duplicates removed and anything left out; the job runs on
that list, so papers added while it waits don't change what was approved.
"All results", "this page" and "selected papers" are separate choices. A set
larger than one job allows runs as several batches under one approval, with
one total estimate, queued through #335, so "screen them" covers the whole
search. Duplicates are matched conservatively: the same
normalized DOI or OpenAlex ID merges, title and year merge only when no DOIs
conflict, and every alias and its source is kept.

### Screening record (#334)

A screening is its own record, with versioned questions and scoring rules, run
on whichever model is configured for screening (Jev today); every model in
the picker has to work. Its answers are keyed by screening and paper: the
model's original answer and its confidence, per question when the model
reports one, any change with who made it (the model, a named person or the
assistant) and when, and whether a person reviewed or accepted it. A search
points at the screening it shows. Search revisions point at the screening and the
time instead of answer chunks, and restoring an old revision rebuilds its
answers from the screening's history. The results page, Screen all and the
assistant read and write it. When a job finishes, the assistant checks the
papers whose unclear answers could decide whether they're in: per question,
the scoring rules give the lowest and highest points an unclear answer allows,
and a paper is checked when that range crosses the minimum. It settles only
the answers it finds evidence for, through the same action a person uses, and
offers undo (#328). There is no separate review screen.

### Undo (#342)

A reversible action's registry entry returns the command that reverses it,
and the assistant keeps it on the step that made the change: a search revision
to restore, the exact papers a collection change added or removed, the draft
section rows it replaced, the answers it settled. When someone else has
changed the record since, undo says so instead of overwriting them.

### Evidence Library homepage (#329, OpenDevEd/new-el#465)

Homepage text is `home.intro`, plus `identity.tagline` and
`identity.description` for page titles and search results. Featuring an
OpenScholar collection connects it as a source and places it in the
Collections section's order. new-el#465 makes each connected OpenScholar
collection a library collection with a key derived from its ID, and lets the
order name one whose first import hasn't run yet. Publishing reports the
operation's stages (queued, assembling, validating, publishing, activating)
and its failure reason. Activation and the collection's sync are tracked
separately: the request finishes when the collection is on the homepage with
its papers, or reports the sync that failed. A retry reuses the approved
revision; a changed draft needs a new approval. Removing the source removes
its place in the order.

## Requests and what they need

| A person asks | They expect | Changes that make it work |
|---|---|---|
| Tighten this search | Versions that keep the question's constraints, tried with their counts, the best applied or the original kept, undo | #336, #343, #342 |
| Screen them | The whole search screened, duplicates caught, unclear papers settled, results on the search page | #334, #341, #51, #335, #328 |
| Save the included ones to a collection | Works after the screening, without picking a collection first, undoable | #341, #342 |
| Compare their designs and samples | A table, an answer built from every row, follow-up fields without starting over | #341, #344, #337, #339, #328 |
| Feature them on our library's homepage | The collection first on the homepage, with text written, as a draft | #329, new-el#465 |
| Publish it | Progress in the real stages, a plain failure reason, retry | #329 |
| Any of these, in the panel on any page | The panel, history, model picker, stop, retry and edit, commands in their own tab only | #346 |

## Scope and order

| Step | Issue | Depends on |
|---|---|---|
| 1 | #321 AI SDK 7 and agent 0.7 (done, PR #331) | none |
| 2 | #322 Searches, shortcuts and ratings in Convex (done, PR #332) | none |
| 3 | #323 Action registry and CI gate. Done in PR #347 for queries and mutations; still to build: action entries (external calls such as OpenAlex), their assistant twins through `runAction`, and registered Next.js server actions in `check-user-actions.ts`. #341 needs them first | none |
| 4a | #334 Screening record: storage and migration (done, PR #385, migrated on shared dev) | #322 |
| 4b | #334 Screening record: jobs on paper sets | #341 |
| 5 | #341 Paper sets by ID, with the duplicate check | #323's action entries |
| 6 | #342 Undo for every reversible change | #323; screening undo needs #334 |
| 7 | #324 Assistant threads and sharing | #321, #323 |
| 8 | #325 Extraction only, chat from a search | #322, #324 |
| 9 | #326 Context budget | #324 |
| 10 | #327 Tools for searches, shortcuts, collections, saved papers, ratings, view, account search and the @ picker | #322, #323, #326, #342 |
| 11 | #335 Papers at once per plan, with a queue | #334 |
| 12 | #328 Screening and extraction with approval and job cards | #327, #334, #335, #341 |
| 13 | #329 Evidence Library drafts, homepage and publishing | #327, new-el#465 |
| 14 | #346 The assistant panel on every page | #324, #327 |

Next are #323's action entries, then steps 5 and 4b together: the resolver,
and Screen all and extraction taking a paper set, which cuts Screen all's wait
at the start from about 13 s to about 2 s for 1,000 papers. On 2026-10-02, 207
public functions were still pending registration in
`scripts/user-actions-exempt.json`: 62 under #329, 48 under #323, 48 under
#328, 32 under #327, 15 under #325, and one each under #336
(`ai/actions:enhanceSearchQuery`) and #334
(`ai/actions:generateBatchScreeningResponses`). These can run in parallel with the steps
above: #336 (query count check), #337 with #339 (extraction calls and
quotes), #343 (Sub-Saharan Africa), #344 (fields added to a job) and
new-el#465. #338 (agreement with people) follows #334. #51 stays with OARS
(#50); the OpenAlex duplicate check it needs ships in #341. #328 ships the
mock's extraction flow together with #344.

Later, without issues yet:

- documents in Tiptap with `@convex-dev/prosemirror-sync`, edited by the
  assistant, and exported to PDF through Typst;
- an MCP server over the registry;
- features built as the assistant needs them: findings (#60), full text (#57),
  clustering, and repeatable citation chasing.

## Data migration

- Browser search history, shortcuts and ratings are user data. They're
  imported on sign-in, never wiped. The import is idempotent by local ID, and
  the local copy stays until the server confirms.
- Shared dev is the live deployment, so its data is user data. The one
  exception is its chat jobs (9 on 2026-10-04): #325 deletes them, with their
  `chatPapers`, `chatSourceEvents` and threads, when it removes chat mode from
  extraction. Decided on 2026-10-04, see "Decision changes". Before it deletes
  anything there, chat is switched off, so no reply or thread setup is in
  flight, and a dry run lists what would go and is checked: only jobs with
  `mode: "chat"`, the rows that point at them, and the agent threads their
  `chatThreadId` names. Credit transactions keep their job ID, as they do when
  a job is deleted today. Afterwards a verifier reads 0 chat-mode jobs, 0 chat
  rows left pointing at one, none of the listed agent threads, and every
  extraction-mode job ID that existed before.
- Each migration runs on shared dev, and on e2e when its tests need it, and is
  verified there before a schema is narrowed. #384 and #403 narrow after
  theirs.
- Screening answers are user data. #334 moves them in stages that can resume:
  answers on current searches, the answers old search revisions point to,
  Screen-all results, and browser stores that haven't imported yet. It
  verifies values and references before deleting any chunk storage, and never
  invents per-question confidence where only an overall figure was saved.
- New tables need no migration.

## Checks

- Each issue runs its focused Vitest target and `tsc --noEmit`, and gets a
  browser check for any page it changes.
- #322: import from a real exported local store, run twice, with no
  duplicates.
- #323: the CI gate fails on a deliberately unregistered public mutation.
- #326: a scripted thread of several hundred turns with many tool calls stays
  under budget and still answers from early decisions.
- #334: the answers migration on a copy of shared dev's searches, revisions
  and screening jobs loses no answer, restoring an old revision still shows
  its answers, and changing one answer writes one row.
- Prompt injection: scripted abstracts and messages that try to trigger writes,
  approvals or disclosure fail.
- #341: saved searches with filters, OQL and sorting resolve to the same
  papers, in the same order, as their results pages, and 1,000 papers resolve
  in a few seconds on shared dev, timed from the button.
- Anything that spends credits or changes what a query returns: before merge,
  a browser check on e2e with the branch deployed, a signed-in page open and a
  real Autumn charge, watching that the page stays up and the balance moves.
  The 2026-10-02 crash was invisible to unit tests and scripted load runs.
- Bulk work: the 1,000-paper tests run under Convex's transaction limits, and
  a load run on e2e with real models lands every item exactly once.
- `npm run check:convex-rules` and `npm run check:user-actions` pass on every
  PR; neither gets an exception without a stated reason.
- #327 and #328: an eval set of scripted tasks checks tool choice, arguments,
  credits spent and outcome. For example: search for primary-school RCTs,
  save 50 to a new collection, screen them.
- Final gate: CI on each PR, and on shared dev a live run of the eval tasks,
  in the browser, with two users sharing one chat.

## Completion

- Every public user action is registered or exempt with a reason, and CI
  enforces it.
- The assistant covers every registered action.
- Extraction has no chat code.
- History, shortcuts and ratings are server records for signed-in users.
- The eval set passes on shared dev.
- Every eval task ends with a result. No step stops at a limitation that one
  of these issues removes.

## Risks

- **Prompt injection.** Abstracts, web results and other users' messages
  are untrusted text. Writes with an outside effect need approval, others
  offer undo, and only the person's own click grants approval.
- **Tool choice across models.** Tool calling varies by model. The assistant
  is offered only on models that pass the eval set.
- **Shared limits.** OpenAlex allowances are per account and the job pools are
  shared by everyone. A tool loop can spend a person's OpenAlex allowance, and
  one large job can hold a pool. Turns have an OpenAlex budget, and every
  person's papers run under their plan's concurrency limit, below the pool's
  size (#335).
- **Cost of long agent loops.** Each turn has a step and credit cap, and the
  running cost is shown.
- **Registry coverage.** The exempt list must shrink over time. A permanent
  exempt entry needs a stated reason.
- **Upgrade breakage.** The AI SDK 7 upgrade touches every AI call. #321
  lands on its own, before assistant work.
- **Work across repositories.** Featuring a collection needs new-el#465
  released to the library before #329 can ship it.
