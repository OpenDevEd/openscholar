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
   as whoever sent the message, with that person's permissions and credits.
7. **Chats range over the whole account.** Nothing is attached to a chat: the
   assistant can reach every record the sender can, through account search.
   Typing @ in a message points at one record precisely, and the message
   stores that record's ID. Changed on 2026-09-30, see "Decision changes".
8. **Spending credits always asks first.** The approval card shows the
   estimate and offers **Allow once** and **Always allow in this chat**. The
   allowance is stored per chat and per person, can carry a per-action credit
   cap, and can be turned off in the chat's settings. Reversible writes run
   without asking and offer undo.
9. **Heavy reading runs through our own features, not sub-agents.** The
   assistant orchestrates: "compare methods across 300 papers" becomes an
   extraction job, and the assistant reads its structured results. When a
   general-purpose sub-agent keeps being needed for the same kind of task,
   that task becomes a feature. The job is the showpiece: a live card in the
   thread with progress, credits and results, and a short readout when it
   finishes.
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
risk level (`read`, `reversible`, `approval`), and a credit estimator for
actions that spend credits. The public mutation and the assistant tool are
generated from the entry. The CI check lists `convex/` public functions
against the registry and a reasoned exempt list, such as auth plumbing and
webhooks.

### Records (#322, built in PR #332)

- `searches`: owner, query, field, filters with the `SearchResult` filter
  shape, sort, last page, query and question history, and screening
  questions. Screening answers are stored in chunks inside the search today;
  #334 moves them to their own table first, because changing one answer
  stores every response of the search again.
- `searchRevisions`: every change, recording whether a user or the assistant
  made it. Undo restores a revision through a restore command (#342).
- Every change goes through `applyCommand(ctx, userId, command, author)` in
  `convex/research/records.ts`, with a receipt per request so a retried tool
  call applies once. Assistant tools call it directly with
  `author: "assistant"`. The read queries still check the browser's account;
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


### Paper sets (#341)

Screening, extraction and collection changes take a paper set instead of
paper objects from the browser: a saved search, a collection, saved papers, a
screening's included or unclear papers, or a list of IDs. One resolver on the
server turns it into papers. A saved search maps its fields to the parameters
`buildOpenAlexWorksQuery` takes, the builder the results page and extraction
already share, so it returns the same papers as its results page. The resolver
removes duplicates with #51's check (DOI, then normalized title and year,
across different OpenAlex IDs) and applies the job's paper limit.

### Screening record (#334)

One table holds every screening answer: one row per search or collection and
paper, with each question's answer, Jev's confidence and who set it (the
model, a person or the assistant). The results page, Screen all and the
assistant read and write it. When a job finishes, the assistant checks the
papers whose unclear answers decide whether they're in, settles what it can
through the same action a person uses, and offers undo (#328). There is no
separate review screen.

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
and its failure reason.

## Requests and what they need

| A person asks | They expect | Changes that make it work |
|---|---|---|
| Tighten this search | Versions tried with their counts, the best applied, undo | #336, #343, #342 |
| Screen them | The whole search screened, duplicates caught, unclear papers settled, results on the search page | #334, #341, #51, #335, #328 |
| Save the included ones to a collection | Works after the screening, without picking a collection first, undoable | #341, #342 |
| Compare their designs and samples | A table, an answer built from it, follow-up fields without starting over | #341, #344, #337, #339 |
| Feature them on our library's homepage | The collection first on the homepage, with text written, as a draft | #329, new-el#465 |
| Publish it | Progress in the real stages, a plain failure reason, retry | #329 |

## Scope and order

| Step | Issue | Depends on |
|---|---|---|
| 1 | #321 AI SDK 7 and agent 0.7 (done, PR #331) | none |
| 2 | #322 Searches, shortcuts and ratings in Convex (done, PR #332) | none |
| 3 | #323 Action registry and CI gate | none |
| 4 | #334 Screening record; its first step, the answers table, can start now | #322; paper sets from #341 |
| 5 | #341 Paper sets by ID | #323, #51 |
| 6 | #342 Undo for every reversible change | #323 |
| 7 | #324 Assistant threads and sharing | #321, #323 |
| 8 | #325 Extraction only, chat from a search | #322, #324 |
| 9 | #326 Context budget | #324 |
| 10 | #327 Tools for searches, shortcuts, collections, saved papers, ratings, view, account search and the @ picker | #322, #323, #326, #342 |
| 11 | #335 Screening limits per plan, with a queue | #334 |
| 12 | #328 Screening and extraction with approval and job cards | #327, #334, #335, #341 |
| 13 | #329 Evidence Library drafts, homepage and publishing | #327, new-el#465 |

Steps 3 and 4 can start at once. These have no dependency on the steps above
and can run in parallel: #336 (query count check), #337 and #339 (extraction
calls and quotes), #343 (Sub-Saharan Africa), #344 (fields added to a job),
#51 (duplicates across OpenAlex IDs) and new-el#465. #338 (agreement with
people) follows #334.

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
- Screening answers saved on searches are user data. #334 moves them, with
  their chunks, into the answers table, verifies the move, and only then
  deletes the chunk storage.


## Checks

- Each issue runs its focused Vitest target and `tsc --noEmit`, and gets a
  browser check for any page it changes.
- #322: import from a real exported local store, run twice, with no
  duplicates.
- #323: the CI gate fails on a deliberately unregistered public mutation.
- #334: the answers migration on a copy of shared dev's searches loses no
  answer, and changing one answer writes one row.
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

- Every eval task ends with a result. No step stops at a limitation that one
  of these issues removes.

## Risks

- **Prompt injection.** Abstracts, web results and other users' messages
  are untrusted text. Writes need approval or offer undo, and a tool result
  can never grant approval.
- **Tool choice across models.** Tool calling varies by model. The assistant
  is offered only on models that pass the eval set.
- **Cost of long agent loops.** Each turn has a step and credit cap, and the
  running cost is shown.
- **Registry coverage.** The exempt list must shrink over time. A permanent
  exempt entry needs a stated reason.

- **Work across repositories.** Featuring a collection needs new-el#465
  released to the library before #329 can ship it.
