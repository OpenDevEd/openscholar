# Work together in organization workspaces

Milestone OS-20. Workflow rules live in the root `AGENTS.md` and
`docs/agents/project.md`. This file holds the decisions, the data changes, the
order, and where each part of the mock goes.

## Problem

On 2026-10-07 OpenScholar was a single-person product with four separate ways
to let someone else in:

| Area | Owner | Others get in through | Roles |
|---|---|---|---|
| Library, collections, ratings, searches, bookmarks, history, screening, extraction, exports | A person (`userId`) | Nothing | None |
| Assistant chats | A person | People or whole organizations (`assistantThreadAccess`) | read, write, owner |
| Author profiles | A person (`ownerId`) | Email invitations (`authorProfileMembers`) | owner, editor |
| Evidence Libraries | An organization | Organization admins, plus invitations to one library (`evidenceLibraryMembers`) | owner, editor, creator |

On top of those, three separate things decided whether a feature was on at all:
a global flag, an Autumn plan feature, and an organization switch set by hand in
Clerk metadata (`convex/webhooks/clerk_mappers.ts`, `convex/organizationFeatures.ts`).
Organizations came only from Clerk, with no way to create, join or manage one
in OpenScholar. A plain organization member got nothing from membership: only
`org:admin` saw the organization's Evidence Libraries (`ownedOrganizations` in
`convex/evidenceLibraries/queries.ts`). Billing, credits and plan limits
belonged to a person.

Measured on `dev` at `0d640b60` (2026-10-08): about 30 tables are owned through
`userId`, with 114 reads through `by_user` indexes. 89 user actions go through
the wrappers in `convex/lib/userActions.ts`, and 168 more public functions are
listed as pending in `scripts/user-actions-exempt.json` and read the person
through `requireAuth` directly.

## Decisions (2026-10-07, the user)

- Everything belongs to a workspace. Every account has a personal workspace, and
  every organization is a workspace.
- A workspace switcher picks the workspace you're in. Everything you do uses it:
  what you make belongs to it, and what you run spends its credits and follows
  its plan's limits and features.
- Inside an organization nothing is private. Every member sees all of its work,
  including every search in its History, with who started each.
- Anyone can create an organization, through Clerk. A free organization has up
  to 5 members.
- People outside a workspace can be invited to one item, as with Evidence
  Library invitations today. Guest access is given to a person, so the item
  shows under "Shared with me" in their personal workspace only, and work they
  run on it uses their own credits. Organizations show only their own work.
- An organization pays for a Team plan per seat. Its credits are one pool, with
  an optional monthly cap per member.
- Features come from the workspace's plan. The hand-set organization switches
  go, and the dev organizations move to plans that keep their features.
- In an organization, the AI preset is the organization's, and members have no
  "My key" (browser key) option.
- Items can move between workspaces. An organization with an Evidence Library
  can't be deleted until each library is moved or deleted.
- A personal workspace can have an Evidence Library.
- Ratings: a personal rating per person per paper, the same everywhere, plus
  each member's rating within a collection, visible to the collection's members.
- Lists show who started each item, items keep an activity list, and item pages
  show who else has them open.
- Projects, an overarching container for papers, collections, screenings,
  extractions and notes, come later. Collections stay the container for now.

The issues record the later 2026-10-07 decisions on the assistant and connected
apps (#651), guest permissions, author profiles and Evidence Library roles
(#653), and the order of ratings and moves (#654, #655).

## Decisions made with the mock (2026-10-07 and 2026-10-08, the user)

The mock on branch `mock/workspaces` is the agreed design. Each line names the
commit that shows it.

- Every item is in exactly one workspace, and every list shows only the
  workspace's items. Switching away from an item the next workspace doesn't have
  lands where that section starts there (Search, Library, Screening,
  Extraction). Each workspace reopens the chat that was last open in it. Opening
  a link to an item in one of your workspaces switches you to that workspace
  (`e40b2928`).
- A search has one link. It carries the search's ID and its query, and an OQL
  query goes after `#oql=` (`buildShareableUrl`). Members of the search's
  workspace and its guests open the original. Anyone else gets their own copy in
  the workspace they're in, marked as a copy. A member can save a copy of
  someone else's search (`4f860cfd`).
- Plan names, limits and credits shown anywhere are the workspace's: your
  account's in your own workspace, the organization's in one. New screening and
  New extraction take no more papers than the plan allows in one request, and
  Start says why (`025e4a79`).
- The credit check on New screening and New extraction names the workspace that
  pays, beside the balance (`c5a3a4aa`).
- New screening and New extraction show the models they run on read-only, with
  a link to AI settings (`c5a3a4aa`).
- An item's card starts with one row: who started it, who has it open,
  Activity, and Share. Share keeps its own button style everywhere (`6961e0b5`).
- People always show with their photo, and initials only when there is none.
  Your own name carries a "You" chip, and a role shows as its icon and word.
  Your personal workspace's tile is your photo, except in the switcher, which
  uses a home mark (`2a7aa95e`, `91bf3c0c`).
- One share panel serves every item. In an organization it lists "Everyone in
  <organization>" first, then guests, with no owner row, and picking a
  suggestion closes the list. In the assistant, sharing a chat opens a card
  stacked in the panel (`2a7aa95e`).
- An organization picks a colour in its General settings. The colour tints the
  rail, and a generated logo uses it (`c5a3a4aa`).
- The sidebar is one fixed rail with only what no page shows: the logo, the
  workspace tile, the sections, running jobs as rings, and the account menu with
  credits, theme and language (`3ebb2272`, `97dbb5ed`).
- On a phone, a page header's actions fold into one menu, and the search card's
  footer spans the width (`4edb80e1`).
- New extraction takes papers from several sources at once: searches,
  collections, saved papers, screenings, Zotero and PDFs. Each source picks its
  papers with screening's range control, and a tray fills toward the papers the
  plan takes in one request. In Zotero, a whole library or collection takes a
  range, single items can be ticked, and items are found by title, creator or
  year, as Zotero's own search does (`9736292b` to `82534ab9`).

Replaced decisions:

- 2026-10-07: "share collections with people only, no organizations" (earlier
  the same day) gave way to workspaces, once organizations became creatable.
- 2026-10-07: a layout with no switcher, listing every workspace's items
  together like Google Drive or Zotero, was proposed and rejected by the user in
  favour of the switcher.
- 2026-10-07: items shared with you showed under "Shared with me" in every
  workspace and ran on the workspace you were in. The user moved them to the
  personal workspace, so an organization never pays for, or lists, work on
  items only one of its members can open.
- 2026-10-07: a sidebar rail with a second panel (as in Slack or ClickUp) was
  rejected because it repeats what the page shows.
- 2026-10-08: a reply still running in another workspace's chat was to stay
  visible in a jobs dock. No app-wide dock exists, and the user decided no
  indicator is needed: the reply shows when you switch back.

## Decisions on the open questions (2026-10-08, the user)

Asked with a recommendation each, all answered the same day:

1. Papers at once and replies at once are one pool per workspace, as Firecrawl
   counts concurrency per team. An organization's plan sets what all its members
   run together (#650, #652).
2. Organizations have no "Clear all" in History. A search is deleted by whoever
   started it or by an admin (#651). In your own workspace "Clear all" stays.
3. The Team plan is as the mock shows it: $24 a seat, 8,000 credits a seat each
   month, Pro's limits with 40 papers at once, and 1,000 shared credits a month
   for a free organization. Every one of these is set in Autumn's dashboard and
   reaches OpenScholar through the synced catalog (`convex/billing/catalog.ts`),
   as personal plans do, so changing one changes no code (#652).
4. A collection sorts by rating on its members' average, kept as ratings change
   (#655).
5. Organization slugs are turned on in Clerk, and an organization's pages sit
   under `/o/<slug>` (#651).
6. A search expands the bookmarks of the workspace it's in, and no others
   (#650).
7. Moving items was mocked before it is built (`92e0fc54`, #654). The user then
   accepted the mock's three rules for a move: a running screening or extraction
   moves once it has finished, guests keep their access, and the Evidence
   Library a collection leaves keeps the papers it saved.
8. An Evidence Library's Viewers, the organization's members without a role in
   it, see it in OpenScholar only: in the libraries list, and its settings
   read-only. new-el's `/admin` keeps owner, editor and creator (#653).
9. A library in your own workspace isn't mocked. New library offers your own
   workspace once #650 and #651 let a library belong to one.

## What the mock leaves out

Building on real data closes these. None needs a decision.

- In an organization, the mock's Library and "Saved papers" are your own
  library. The organization's library is its own (`libraryItems` by workspace).
- Members' collections never appear in the mock's Library. Real collection lists
  show every member's, with who made each.
- Bookmarks aren't scoped to a workspace in the mock.
- The demo organizations' counts disagree with their pages. Learning Lab's
  settings count a live Evidence Library and 5 collections that its pages don't
  show, and Pricing starts its Team calculator at 8 seats while Members shows
  11. Real settings read the same counts the lists do.
- A collection in your own workspace that has guests shows no collection
  ratings. Collection ratings show whenever a collection has anyone besides you.
- The mock keeps which workspace your items are in in the browser
  (`lib/workspaces-mock/items.ts`), and doesn't record the collection a screening
  makes for its included papers. The server records both, on the record itself.
- Screening's slots read "Your paper slots". They are the workspace's pool.

## Owners

One place owns each rule, and nothing else implements it again.

| Rule | Owner |
|---|---|
| Who is acting, in which workspace, with which role | `convex/workspaces/actor.ts` (`actorFor`), called only by the wrappers in `convex/lib/userActions.ts` |
| Every public function names its workspace and is checked | the wrappers, enforced by `npm run check:user-actions` |
| Who may open an item, and with which role | `convex/sharing/access.ts` (`requireItem`), replacing the role reads in `convex/assistant/access.ts`, `convex/authors/access.ts` and `convex/evidenceLibraries/access.ts` |
| Who pays | `convex/billing/charge.ts`. Reserve, settle and release take a payer: the workspace's Autumn customer and, in an organization, the member's entity |
| Which members are billed as seats | `convex/billing/seats.ts`, from the Clerk webhook's memberships, with a daily reconcile |
| What a plan allows | `planLimit` and `hasPlanFeature` in `convex/billing/accounts.ts`, keyed by workspace. `convex/organizationFeatures.ts` goes |
| What changed on an item | the wrappers, which write activity from each entry's `activity` declaration (`convex/activity/`) |
| Who has an item open | `convex/presence.ts`, rooms keyed by item, moved from `convex/assistant/presence.ts` |
| How many records a workspace and each member have | `convex/research/recordCounts.ts` and the triggers in `convex/lib/triggers.ts`, keyed by workspace, and by workspace and creator |
| A set of papers and a range of it | screening's `paperSetValidator` with `first` and `last`. Extraction's sources take the same shape |
| Which workspace a page is in | the address: `proxy.ts` (`organizationSyncOptions`) and `lib/workspaces/url.ts` (`useWorkspace`, `workspaceHref`) |
| How a person, a role or a workspace looks | `components/ui/identity.tsx`, `components/ui/identity-avatar.tsx`, and the workspace parts moved out of the mock |

What keeps it small and fast:

- A personal workspace needs no membership read: its `userId` is the person.
  An organization takes one indexed read
  (`organizationMemberships.by_organizationId_and_clerkUserId_and_state`), once
  per call, in `actorFor`.
- Organization-wide visibility comes from the workspace, never from rows per
  member. A guest is one grant row per person and item.
- Every list reads one index range per page (`by_workspace...`, or
  `by_workspace_and_createdBy...` when filtered by person). Totals come from the
  counters, never from reading a list.
- One migration helper backfills every table.
- The address is the only record of the workspace you're in. Nothing about it
  is stored in the browser.
- The mock's client-side filtering (`useListHere`, `countIn`) and its made-up
  data are deleted, not ported.

## What to reuse

- Clerk: organizations, invitations, roles and membership limits. Our webhook
  already syncs organizations and memberships (`convex/webhooks/clerk.ts`,
  `convex/webhooks/projections.ts`, `organizations`, `organizationMemberships`).
  `clerkMiddleware` in `proxy.ts` can set the active organization from the URL
  (`organizationSyncOptions.organizationPatterns`, which takes `:slug` or `:id`).
  Convex never trusts the token's active organization; it checks the synced
  memberships. The dev instance has organization creation on, a default limit of
  5 members, domains off and slugs off (checked 2026-10-07).
- Access: `convex/assistant/access.ts` (roles, `requireThread`),
  `convex/authors/access.ts`, `convex/evidenceLibraries/access.ts`
  (`readLibraryRole`, invitations). These merge into one access table and one
  check.
- User actions: `convex/lib/userActions.ts` builds every user action through
  its wrappers (`userQuery`, `accountQuery`, `assistantQuery`, `userMutation`,
  `accountMutation`, `assistantMutation`, `userAction`, `assistantAction`), which
  know the action, the person, and whether the assistant made the change. All of
  them, not only the mutations, take the workspace and check it, and write
  activity. Functions listed in `scripts/user-actions-exempt.json` that read or
  change workspace data (such as `assistant/replies:send`) get the same check,
  and `npm run check:user-actions` fails on a workspace-data function without it.
- Presence: `convex/assistant/presence.ts` on `@convex-dev/presence`, a
  10-second heartbeat (`lib/assistant/presence.ts`) and the avatar ring in
  `components/assistant/sheets.tsx`.
- Billing: `planLimit` and `readAccount` in `convex/billing/accounts.ts`,
  `PLAN_LIMITS` in `lib/billing/plans.ts`, the one spending path in
  `convex/billing/charge.ts`, and the Autumn client in `convex/billing/autumn.ts`.
  Autumn models a team directly: the organization is the customer, members are
  entities that count as seats, balances can be a customer-wide pool, and
  `check` and `track` take an entity ID.
- Lists: the cursor paging, counts and limit tests from OS-18
  (`plans/bounded-lists/README.md`), and the count triggers in
  `convex/lib/triggers.ts`.
- Paper sets: screening reads a set and a range of it (`paperSetValidator`,
  `first`, `last`). Extraction reads a collection's range through
  `librarySet` already, and a search only from its first result
  (`searchFilters.limit` in `convex/extraction/expandSources.ts`).
- The mock's components, listed under "Where the mock goes".

## Data

What stays with the person: the account, platform admin rights, personal
ratings, the Zotero connection, request receipts and undo, export downloads and
resource locks. Connected apps (`walletKeys`) stay the person's, and each names
the workspace it draws on (#651). `userAiConfig` (the preset, custom task picks
and "My key" settings) stays the person's and applies in their personal
workspace only.

What moves to the workspace: library papers, collections and their memberships,
removals and counts, searches with their revisions, history, screenings and
answers, bookmarks (`queryShortcuts`), record counts, screening and extraction
jobs, queues and slots, assistant chats with their steps, limits, spenders and
files, author profiles, Evidence Libraries, and billing (accounts, customers,
subscriptions, holds, usage, credits and transactions).

- A `workspaces` table: `kind` (personal or organization), the account or the
  organization, and its Autumn customer ID. #650 makes a personal workspace for
  every account and an organization workspace for every existing organization,
  so every record, Evidence Libraries included, has its workspace from the
  first migration. New ones are made where accounts and organizations are made
  (`convex/lib/userCreation.ts`, `convex/webhooks/projections.ts`). A personal
  workspace keeps the existing Autumn customer, the user's ID, so no Autumn
  customer moves; an organization gets its own Autumn customer on the free
  organization plan.
- Each root record gets `workspaceId` and `createdBy`: library papers,
  collections, searches, bookmarks, screening and extraction jobs, chats, author
  profiles, Evidence Libraries and billing accounts. `createdBy` takes the old
  `userId`, which is what makes "who started it" possible. `by_user` indexes
  become `by_workspace` ones, plus `by_workspace_and_createdBy` where a list
  filters by person. The search index on `searches` filters by `workspaceId` and
  `createdBy` instead of `userId`.
- Rows under a parent (a search's revisions and history, a job's papers, a
  library's drafts, revisions, sections and credentials, a chat's steps and
  files) keep only their parent's ID and are reached through it. A `userId`
  copied onto one is dropped, or becomes `createdBy` where the row records who
  made it (a search revision, a chat step). The extraction queue and screening
  slots are the exception: they count a workspace's pool, so they carry
  `workspaceId` for their index.
- `by_user_and_localId` becomes `by_workspace_and_localId`. A local ID is unique
  only within one owner: importing the same file makes the same `import:` ID for
  two people. So a search's link carries the search's document ID, which is
  unique everywhere, and the page resolves it to the workspace and local ID it
  opens, for any member or guest.
- An organization's AI preset and colour are its own record, keyed by
  workspace, set by admins. The preset defaults to the default preset and holds a
  preset only: no custom picks and no keys.
- Evidence Libraries change from `organizationId` to `workspaceId`. This is saved
  library data, so it follows the migration rules in `docs/agents/project.md`.
  Library names become unique per workspace. Public addresses
  (`evidenceLibraryRuntimeBindings.by_targetBaseUrl`) and custom domains
  (`evidenceLibraryDomains.by_host`) stay unique across the platform, because an
  incoming host names no workspace. new-el has no notion of organizations, so it
  doesn't change. The one name it receives, `organisationName` on a refused
  admin session (`convex/evidenceLibraries/sessionAccess.ts`), becomes the
  workspace's name: the organization's, or the owner's for a personal library.
- Deleting an account deletes its personal workspace only. Records in an
  organization stay the organization's, and their `createdBy` and activity show
  a kept name for a deleted member instead of pointing at a missing user. The
  30-day cleanup of deleted accounts (`convex/maintenance/mutations.ts`, which
  deletes their extraction jobs, chats and billing, and then the `users` row) is
  narrowed to the personal workspace. The tombstone it already writes
  (`clerkDeletedUsers`, today the Clerk ID and when) gains the old user ID and
  the display name, in the same transaction that deletes the `users` row, and
  `createdBy` resolves through it. Nothing else about the person is kept.
- Every change widens, migrates with `@convex-dev/migrations` (audit and dry run
  first, then verified on shared dev and e2e), then narrows. Nothing is wiped,
  and no field stays as a fallback. One helper backfills every root table, told
  how to read that table's owner: its `userId` for a person's records, and for
  an Evidence Library its `organizationId`, mapped to that organization's
  workspace, with `createdBy` read from `createdByClerkUserId` through
  `users.by_clerk_id`.

## Roles

Workspace roles are Admin and Member. Item roles for guests keep each kind's
capabilities, mapped without anyone gaining a permission:

| Kind | Today | Guest roles after #653 |
|---|---|---|
| Collection, search, screening, extraction | none | Viewer, Editor |
| Assistant chat | read, write, owner | read becomes Viewer, write becomes Editor; owner becomes the workspace's |
| Author profile | owner, editor | editor becomes Editor; owner becomes the workspace's |
| Evidence Library | owner, editor, creator | Editor and Creator stay as they are (a Creator still can't publish); owner becomes the workspace's admins |

#653 ships a test per row proving each old grant keeps exactly its old
capabilities.

## Order

Each step deploys on its own and keeps the decisions true while later steps are
still open.

### Phase 0: parts of the mock that need no workspace

These ship now, alongside #649 and #650, each as its own issue and pull request.
Each takes its code from the mock by hand; nothing is merged from the mock
branch. They are filed under OS-20, since they come from its mock, except New
extraction (OS-14).

1. #685, cleanup: the dead code, packages and CSS the earlier designs left
   (`99784617`), older pages in the current design (`cae949af`), quieter dark
   outlines (`029e79b0`), quick date picks (`ed7a36cc`), long names in rows
   (`21ca7179`), and the chat list's pill filters (`7a0007f2`).
2. #686, one way to show people: `components/ui/identity.tsx` and
   `components/ui/identity-avatar.tsx` everywhere a person, a role or an
   organization shows, building on #667.
3. #687, the search page on phones and a tighter search card: the header's
   actions in one menu, the footer across the width, the view-mode rail's
   background (`4edb80e1`, the `panel-header.tsx` well).
4. #688, New screening's range fields take a whole number before moving the
   range, and sources with no papers can't be picked (`42a529f6`). This is a
   real bug on `dev` today. #689, New screening shows its model read-only
   through `components/models/models-in-use.tsx` (`c5a3a4aa`).
5. #690, New extraction from several sources (OS-14). Client: `setup-view.tsx`,
   the tray, `components/screening/source-row.tsx` shared with screening, and
   `pdf-upload.tsx`. Server: an extraction source becomes a paper set and a
   range, the shape screening already reads, so a search range can start past
   its first result. The bucket store and its old wizard go. Zotero waits for
   phase Z.
6. #691, a collection heads the library's command center, and one New collection
   dialog and Manage serve every entry point, without sharing (`c7698e5c`,
   `44aae24c`, `ee50cbf1`, `db1da149`).
7. #696, a screening takes a name of its own as it starts, from New screening's
   name field or the assistant (`53db9c56`). The job keeps it as `name`, and
   `jobName` shows it before the name its papers give it. The mock keeps it in
   the browser and puts it on the job at its read seam.

### Phase 1 to 9: OS-20

1. #649: upgrade to Clerk 7 (Core 3).
2. #650: workspaces for every account and every existing organization, with
   billing keyed by workspace. No visible change: everyone works in their
   personal workspace, and organizations keep their Evidence Libraries. Slots
   and replies at once become one pool per workspace, and bookmarks expand per
   workspace. In slices, each deployed on its own:
   1. The `workspaces` table, made with accounts and organizations and
      backfilled. `actorFor`. Every wrapper takes `workspaceId` and passes
      `run` an actor (person, workspace, role, author) instead of a user ID. The
      client passes the personal workspace from one query until #651 puts the
      workspace in the address. Pending functions that touch workspace data move
      behind the wrappers here, so the check has no gaps. Done in #701, #703 and
      #704, except the pending functions.
      Changed 2026-10-08 (agreed with the user in the implementation thread,
      after #704): each pending function that touches workspace data takes the
      workspace check in the slice that moves its data, instead of all of them
      here. Reason: 136 of the 168 pending functions wait on OS-17's
      registration issues (#323, #327, #328, #329), and until a slice moves its
      data a function reads and writes the rows it did before. Evidence Library
      functions keep their own library access check (`readLibraryRole`) until
      slice 6. The gate that keeps this from leaving gaps: `check:user-actions`
      fails on any public function, plumbing included, of a module listed under
      `inWorkspace` in `scripts/user-actions-exempt.json` that doesn't take the
      workspace; each slice adds its modules (#706 adds `research/records` and
      `research/searches`, and `research/records:importBatch` with them).
   2. Research records: searches, revisions, history, screenings, bookmarks,
      record counts.
   3. Library: papers, collections, memberships, removals, counts.
   4. Jobs: screening and extraction jobs, queues, slots, usage rows.
   5. Assistant: chats, steps, limits, spenders, files, bulk changes.
   6. Author profiles and Evidence Libraries, under the saved-data rules.
   7. Billing: every billing table by workspace, the payer in
      `convex/billing/charge.ts`, `planLimit` and `hasPlanFeature` by workspace.
   8. Account deletion narrowed, then every table narrowed.
3. #655: ratings in one table, personal per person, plus collection ratings.
   It lands before organizations open, so members never share one rating. A
   collection sorts on its members' average rating. UI: the collection raters
   and star picker from `library-additions.tsx`.
4. #651: organizations in OpenScholar, the switcher, the workspace in the URL,
   Account and Workspace settings, and the organization's AI preset. An
   organization works on the free organization plan and its own credits from
   the start. Deletion goes through OpenScholar, which refuses while the
   organization has an Evidence Library; deleting from Clerk's own components is
   switched off in the instance's organization settings. Organization slugs go
   on in Clerk, and organizations have no "Clear all" in History. Specifically:
   - Organization pages live under `app/o/[slug]/`, one-line route files that
     re-export the personal pages. `useWorkspace` reads the segment, and every
     link and URL helper (`buildResultsUrl` and the others in
     `lib/search-params/index.ts`, plus 25 direct links in 14 files on `dev`)
     goes through `workspaceHref`. No rewrites: the bundled Next.js 16 docs warn
     that `usePathname` can mismatch through a rewrite.
   - Switching follows the mock's rules (`useSwitching` in
     `components/workspaces-mock/workspace-items.ts`), with navigation in place
     of the browser store. A link to an item outside the workspace in the
     address goes to the same item in its own workspace, when you belong to it.
   - The tab's panel state (`lib/assistant/place.ts`, kept in session storage)
     holds the chat last open in each workspace, keyed by workspace, in place
     of its one `threadId`. That is where the panel is, not which workspace
     you're in, which only the address holds.
   - Members, invitations, roles, leaving and deleting call Clerk's backend
     from Convex actions, behind the mock's own screens.
5. #652: the Team plan, seats, credit caps per member, and features from plans
   in place of the organization switches, with the values above set in Autumn.
   - Seats follow memberships. `convex/billing/seats.ts` creates a member's
     Autumn entity when the Clerk webhook projects an active membership and
     deletes it when the membership ends, keyed by the membership's ID so a
     retried webhook changes nothing twice. A daily reconcile compares each
     paid organization's active memberships with its Autumn entities and fixes
     any difference, and #652's migration makes entities for the memberships
     that came before it.
   - Deleting a paid organization cancels its Team plan in Autumn first, as a
     step of the deletion that is safe to repeat. The organization is deleted
     in Clerk only once Autumn shows no active plan, and the daily reconcile
     cancels any plan whose organization is gone.
6. #653: guests. One access table and one invitation table replace the three,
   with the roles above; owner `convex/sharing/`. Includes "Shared with me", the
   `/shared/[id]` landing page, the share panel, search links and copies, and a
   per-plan `guests` limit in Autumn.
7. #654: moving items between workspaces. An Evidence Library moves through the
   ownership transfer in #46. A collection an Evidence Library follows can't
   leave the library's workspace while the library follows it; the move names
   the library to stop following it first. The mock (`92e0fc54`,
   `components/workspaces-mock/move-dialog.tsx`) puts Move between Activity and
   Share on every item's row and beside Share on your chats, lists your other
   workspaces, and shows what goes with the item. You go with it: it stays open
   in the workspace it moved to, and its activity records where it came from.
   Only an organization's admins move its work out of it. A running job moves
   once it has finished, guests keep their access, and the library a
   collection leaves keeps the papers it saved.
8. #656: who started what, and activity per item. The "Run by" filter reads
   `by_workspace_and_createdBy` and the per-member counts.
9. #657: presence on every item.

#652, #653, #654, #656 and #657 depend on #651 and can run in parallel after it.

### Phase Z: Zotero at scale

#425 pages every read from Zotero. On top of it, #692 (OS-14) mirrors a
person's Zotero libraries and collections in Convex: names searched and paged on
the server, versions so only changes sync, item keys stored in chunks for a
picked set and fetched 50 at a time, one fetch helper with Zotero's backoff and
about 4 requests at once. Zotero then becomes a source in New screening and New
extraction, with the mock's picker (`components/workspaces-mock/zotero-source.tsx`).

### Last: the mock goes

Delete `components/workspaces-mock/`, `lib/workspaces-mock/`, and the mock's
hooks into real code: `mockRead` in `lib/auth/use-auth-query.ts` and
`lib/hooks/use-cursor-page.ts`, the mock slot in `lib/search/initializer.tsx`,
and `unfollowedChat` in `lib/assistant/place.ts`. Retire the branch.

## Where the mock goes

| Mock part | Goes to | Issue |
|---|---|---|
| `move-dialog.tsx`, Move in `item-actions.tsx` and in the chat rows | moving items | #654 |
| `sidebar-content.tsx` (the rail), `switcher.tsx` (switching, creating, invitations), `components/ui/progress-ring.tsx` | `components/workspaces/` and the app sidebar | #651 |
| `settings-mock.tsx` General, Members and AI; `app/settings/layout.tsx` split; `app/settings/workspace/*` | Workspace settings | #651 |
| `settings-mock.tsx` Plan and credits with member caps, `org-plans.tsx` Team card | Workspace billing, Pricing | #652 |
| `workspace-plan.ts` (`useWorkspacePlan`), `org-job-credits.tsx` (`CreditCheck`), `org-credits.tsx` (assistant approvals from the pool) | the same hooks on real data | #651, #652 |
| `workspace-items.ts` (`useSwitching`) | `lib/workspaces/` with navigation | #651 |
| `library-list.tsx` (the workspace is the list's filter), `new-library-form.tsx` (a library is made in the workspace you're in, and `organization-picker.tsx`'s picker goes) | the Evidence Libraries list and New library | #651 |
| `assistant-mock.tsx` (members' chats, the preset pill, spending) | the assistant panel | #651 |
| `connect-mock.tsx` | `/connect` and Connections settings | #651 |
| `landing.tsx` (`/join/[id]`, `/shared/[id]`) | those pages | #651, #653 |
| `components/shared/share-panel.tsx`, `share-dialog.tsx`, `chat-invites.ts`, `shared-mock.tsx`, guests in `collection-dialogs.tsx` | sharing | #653 |
| `team-access.tsx` (owners are the workspace's admins, "Everyone in <organization>" are Viewers, Editor and Creator by invitation) | a library's Team settings | #653 |
| `history-additions.tsx` (search origin chips, links, copies, Save a copy) | the search page | #653 |
| `item-actions.tsx` (`ItemBar`, `HereActions`, `ItemActions`) | one item row on every item page | #653, #656, #657 |
| `team-list.tsx`, `parts.tsx` (`RunByFilter`, faces with rings), `activity.tsx`, `bookmarks-additions.tsx`, `extraction-additions.tsx`, `screening-additions.tsx` | lists filtered on the server, activity sheet | #656 |
| Presence faces in `item-actions.tsx` and `extraction-additions.tsx` | `convex/presence.ts` rooms | #657 |
| `library-additions.tsx` (collection ratings) | the library | #655 |
| `parts.tsx` workspace parts (`WorkspaceTile`, `WorkspaceTag`, `PersonTag`, `PlanChip`, `Chip`, `AvatarStack`) | `components/workspaces/` | #651 |
| `zotero-source.tsx` | Zotero sources | phase Z |
| `lib/workspaces-mock/*`, `real-organizations.ts`, `useListHere`, `countIn`, the mock starts in `extraction-data.ts` and `screening-additions.tsx` | deleted | last |

## Checks

- Each issue runs its focused Convex tests (`convex-test` under Convex's limits)
  and the migration's dry run before it touches shared dev.
- #650 proves nothing changed: the same people see the same records before and
  after, on shared dev and e2e.
- Browser passes on dev.openscholar.ai, each from the issue that builds what it
  checks, then kept by every later issue:
  - #651: two accounts. One creates an organization and invites the other.
    They switch workspaces, work in the organization and see each other's work.
    Switching while a search, a screening, an extraction, a collection and a
    chat are open, and opening each one's link from the other workspace, behave
    as the mock does.
  - #653: a third account, invited to one item only, sees it under "Shared with
    me" in its personal workspace and not in its organizations.
  - #654: each kind of item moves, and the refused moves say why.
  - #656: lists show who started each item, and its activity what changed.
  - #657: each item shows who else has it open.
- #652: a real charge on the e2e Autumn setup, taken from an organization's pool
  and refused past a member's cap.
- Phase 0: each part's focused tests and a browser pass of the changed page in
  Chromium and Firefox.
- The full CI suite gates each PR.

## Done when

Every issue in OS-20 is closed, the browser pass above works on
dev.openscholar.ai without a fallback to the old per-person ownership, and
nothing from the mock (`workspaces-mock`, `mockRead`, the mock slots) is left on
`dev`.

## Risks

- Clerk caps an organization at 20 members without its $100-a-month B2B add-on,
  which also gates joining by email domain. The first team past 20 needs that
  decision.
- #650 touches nearly every table and index. Large tables migrate in batches,
  and reads switch only once the backfill is verified.
- Every action needs a workspace argument, so assistant tools and the action
  registry (`npm run check:user-actions`) change with #650. The 168 pending
  functions are the gap to close first.
- A link built without `workspaceHref` drops an organization's prefix and opens
  the item in the personal workspace. #651's browser pass clicks through every
  section inside an organization.
- The mock is 19 commits behind `dev` (checked 2026-10-08), so phase 0 ports its
  code by hand.
