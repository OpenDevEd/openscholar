# Research assistant that can do everything a user can

Milestone: OS-17, issues OpenDevEd/openalex-count#321–#329. Workflow rules
live in the root `AGENTS.md` and `docs/agents/project.md`.

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
   feature. "Start chat" opens an assistant thread with the search attached
   by ID; papers are no longer copied into the prompt.
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
7. **Chats range freely.** A chat starts from whatever it was opened on and
   can attach more records as it goes.
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
10. **Build on Convex agent and AI SDK 7.** See "Tools considered" for why
    the other frameworks were not adopted.

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

### Records (#322)

- `searches`: owner, query, field, filters with the `SearchResult` filter
  shape, sort, last page, query and question history, screening questions and
  responses.
- `searchRevisions`: every change, recording whether a user or the assistant
  made it. Undo applies a revision.
- `queryShortcuts`: today's Bookmarks page.
- `paperRatings`.

Results are never stored. They're fetched on the server through
`lib/openalex`.

### Assistant threads (#324)

- `assistantThreads`: owner, title, attached record IDs, and the
  `@convex-dev/agent` thread ID.
- `assistantThreadAccess`: principal (user or organization) and role (`read`
  or `write`).
- `assistantAllowances`: thread, user, kind (`spendCredits`), optional
  per-action credit cap.
- One reply per thread at a time, reusing the existing thread lock.

### Context per turn (#326)

1. Instructions and the core tools. These never change, so they stay cached.
2. A snapshot rebuilt from Convex: attached records, open jobs, the user's
   current view.
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
thread event, and the assistant writes a readout.

## Scope and order

| Step | Issue | Depends on |
|---|---|---|
| 1 | #321 AI SDK 7 and agent 0.7 | none |
| 2 | #322 Searches, shortcuts and ratings in Convex | none |
| 3 | #323 Action registry and CI gate | none |
| 4 | #324 Assistant threads and sharing | #321, #323 |
| 5 | #325 Extraction only, chat from a search | #322, #324 |
| 6 | #326 Context budget | #324 |
| 7 | #327 Tools for searches, shortcuts, collections, saved papers, ratings, view | #322, #323, #326 |
| 8 | #328 Screening and extraction with approval and job cards | #327 |
| 9 | #329 Evidence Library drafts | #327 |

Steps 1–3 can run in parallel.

Later, without issues yet:

- documents in Tiptap with `@convex-dev/prosemirror-sync`, edited by the
  assistant, and exported to PDF through Typst;
- an MCP server over the registry;
- features built as the assistant needs them: findings (#60), full text (#57),
  deduplication, clustering, and repeatable citation chasing.

## Data migration

- Browser search history, shortcuts and ratings are user data. They're
  imported on sign-in, never wiped. The import is idempotent by local ID, and
  the local copy stays until the server confirms.
- Production (`main`) has no chat. Shared dev's chat jobs (6 on 2026-09-30),
  `chatPapers`, `chatSourceEvents` and chat-mode fields are development data.
  They're deleted with #325, not migrated.
- New tables need no migration.

## Checks

- Each issue runs its focused Vitest target and `tsc --noEmit`, and gets a
  browser check for any page it changes.
- #322: import from a real exported local store, run twice, with no
  duplicates.
- #323: the CI gate fails on a deliberately unregistered public mutation.
- #326: a scripted thread of several hundred turns with many tool calls stays
  under budget and still answers from early decisions.
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
- **Upgrade breakage.** The AI SDK 7 upgrade touches every AI call. #321
  lands on its own, before assistant work.
