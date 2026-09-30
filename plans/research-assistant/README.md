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

- OpenAlex search and paging on the server: `lib/openalex/*`, and
  `app/actions/openalex.ts` (`getSearchResults`, `readSearchPage`), which use
  OpenScholar's key.
- The history entry's shape: `SearchResult` in `lib/types/search.types.ts`,
  and `migrateSearchHistoryState` and `importSearchHistory` in `lib/store.ts`.
- Credit estimates: `lib/extraction/cost-estimate.ts`, and the screening
  estimate shown in the screening dialog.
- Reserve and settle billing: `convex/billing/charge.ts`.
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
  (`toModelOutput`).
- Past chats are searched through a tool, never pre-loaded.

### View context (#327)

Each message carries the route, the IDs on screen, the page, the selection
and the open panel. The same view goes to presence, so shared chats see each
other's context.

### Jobs (#328)

Start through the registry after approval. The tool returns the job ID at
once. A live card renders from the job's own queries. Completion adds a
thread event, and the assistant writes a readout. A queued job checks
credits, access and limits again when it starts, and a periodic sweep starts
queued jobs nothing woke. Extraction results are analysed on the server with
filter, group and count, so a comparison covers every row rather than the
first page. Fields added to a job (#344) report their own completion. Extraction's yes/no fields go to the
job's decision model when it has one (Jev today) and show as unquoted
decisions; every other answer, from any model, carries its quote (#339).

### Operations (#323, #328)

Every tool call and UI action that changes something runs as an operation
with a stored ID, receipt and result, shared by the UI and the assistant.
Retry resumes the unfinished operation; it never replays finished work or
rewinds charges. Editing a message starts a new request and keeps the history
of what the old one did. A finished job resumes the chat exactly once, as the
original sender, with their access and allowance checked again. The reply
lock is released while a job runs. `@convex-dev/workflow` coordinates this on
top of the existing job queues.

### Paper sets (#341)

Screening, extraction and collection changes take a paper set instead of
paper objects from the browser: a saved search, a collection, saved papers, a
screening's included or unclear papers, or a list of IDs. One resolver on the
server turns it into papers. A saved search maps its fields to the parameters
`buildOpenAlexWorksQuery` takes, the builder the results page and extraction
already share, and applies the rating filters ("only rated papers" and the
rating range) from the account's `paperRatings`, as the results page does in
the browser. So it returns the same papers as its results page. The set is
resolved into a fixed list before approval, recording the source's revision,
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
| 3 | #323 Action registry and CI gate | none |
| 4a | #334 Screening record: storage and migration | #322 |
| 4b | #334 Screening record: jobs on paper sets | #341 |
| 5 | #341 Paper sets by ID, with the duplicate check | #323 |
| 6 | #342 Undo for every reversible change | #323; screening undo needs #334 |
| 7 | #324 Assistant threads and sharing | #321, #323 |
| 8 | #325 Extraction only, chat from a search | #322, #324 |
| 9 | #326 Context budget | #324 |
| 10 | #327 Tools for searches, shortcuts, collections, saved papers, ratings, view, account search and the @ picker | #322, #323, #326, #342 |
| 11 | #335 Screening limits per plan, with a queue | #334 |
| 12 | #328 Screening and extraction with approval and job cards | #327, #334, #335, #341 |
| 13 | #329 Evidence Library drafts, homepage and publishing | #327, new-el#465 |
| 14 | #346 The assistant panel on every page | #324, #327 |

Steps 3 and 4a can start at once. These can run in parallel with the steps
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
- Production (`main`) has no chat. Shared dev's chat jobs (6 on 2026-09-30),
  `chatPapers`, `chatSourceEvents` and chat-mode fields are development data.
  They're deleted with #325, not migrated.
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
  papers, in the same order, as their results pages.
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
- **Cost of long agent loops.** Each turn has a step and credit cap, and the
  running cost is shown.
- **Registry coverage.** The exempt list must shrink over time. A permanent
  exempt entry needs a stated reason.
- **Upgrade breakage.** The AI SDK 7 upgrade touches every AI call. #321
  lands on its own, before assistant work.
- **Work across repositories.** Featuring a collection needs new-el#465
  released to the library before #329 can ship it.
