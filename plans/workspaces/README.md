# Work together in organization workspaces

Milestone OS-20. Workflow rules live in the root `AGENTS.md` and
`docs/agents/project.md`; this file holds the decisions, data changes and order.

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

## What to reuse

- Clerk: organizations, invitations, roles and membership limits. Our webhook
  already syncs organizations and memberships (`convex/webhooks/clerk.ts`,
  `organizations`, `organizationMemberships`). `clerkMiddleware` in `proxy.ts`
  can set the active organization from the URL (`organizationSyncOptions`).
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
  `PLAN_LIMITS` in `lib/billing/plans.ts`, and the Autumn client in
  `convex/billing/autumn.ts`. Autumn models a team directly: the organization is
  the customer, members are entities that count as seats, balances can be a
  customer-wide pool, and `check` and `track` take an entity ID.
- Lists: the cursor paging, counts and limit tests from OS-18
  (`plans/bounded-lists/README.md`).

## Data

What stays with the person: the account, platform admin rights, personal
ratings, connected apps (`walletKeys`), the Zotero connection, request receipts
and undo, export downloads and resource locks. `userAiConfig` (the preset, custom
task picks and "My key" settings) stays the person's and applies in their
personal workspace only.

What moves to the workspace: library papers, collections and their memberships,
removals and counts, searches with their revisions, history, screenings and
answers, bookmarks (`queryShortcuts`), record counts, screening and extraction
jobs, queues and slots, assistant chats, author profiles, Evidence Libraries,
and billing (accounts, holds, usage, transactions).

- A `workspaces` table: `kind` (personal or organization), the account or the
  organization, and its Autumn customer ID. #650 makes a personal workspace for
  every account and an organization workspace for every existing organization,
  so every record, Evidence Libraries included, has its workspace from the
  first migration. A personal workspace keeps the existing Autumn customer, the
  user's ID, so no Autumn customer moves; an organization gets its own Autumn
  customer on the free organization plan.
- Each moved record gets `workspaceId` and `createdBy`. `createdBy` takes the
  old `userId`, which is what makes "who started it" possible. `by_user` indexes
  become `by_workspace` ones.
- An organization's AI preset is its own record, keyed by workspace, set by
  admins and defaulting to the default preset. It holds a preset only: no custom
  picks and no keys.
- Evidence Libraries change from `organizationId` to `workspaceId`. This is saved
  library data, so it follows the migration rules in `docs/agents/project.md`.
  Library names become unique per workspace. Public addresses
  (`evidenceLibraryRuntimeBindings.by_targetBaseUrl`) and custom domains
  (`evidenceLibraryDomains.by_host`) stay unique across the platform, because an
  incoming host names no workspace. new-el has no notion of organizations, so it
  doesn't change.
- Deleting an account deletes its personal workspace only. Records in an
  organization stay the organization's, and their `createdBy` and activity show
  a kept name for a deleted member instead of pointing at a missing user. The
  30-day cleanup of deleted accounts (`convex/maintenance/mutations.ts`, which
  deletes their extraction jobs, chats and billing) is narrowed to the personal
  workspace.
- Every change widens, migrates with `@convex-dev/migrations` (audit and dry run
  first, then verified on shared dev and e2e), then narrows. Nothing is wiped,
  and no field stays as a fallback.

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

## Order and owners

Each step deploys on its own and keeps the decisions true while later steps are
still open.

1. #649: upgrade to Clerk 7 (Core 3).
2. #650: workspaces for every account and every existing organization, with
   billing keyed by workspace. No visible change: the switcher doesn't exist yet,
   so everyone works in their personal workspace, and organizations keep their
   Evidence Libraries. Owner of "every record has exactly one workspace and every
   action checks it": `convex/lib/userActions.ts` and a new `convex/workspaces/`.
   Owner of "the workspace you're in pays": `convex/billing/accounts.ts`.
3. #655: ratings in one table, personal per person, plus collection ratings.
   It lands before organizations open, so members never share one rating.
4. #651: organizations in OpenScholar, the switcher, the workspace in the URL,
   Account and Workspace settings, and the organization's AI preset. An
   organization works on the free organization plan and its own credits from
   the start. Deletion goes through OpenScholar, which refuses while the
   organization has an Evidence Library; deleting from Clerk's own components is
   switched off in the instance's organization settings.
5. #652: the Team plan, seats, credit caps per member, and features from plans
   in place of the organization switches. The Team plan's price, credits, limits
   and features need the user's decision first.
6. #653: guests. One access table replaces the three, with the roles above;
   owner `convex/sharing/`.
7. #654: moving items between workspaces. An Evidence Library moves through the
   ownership transfer in #46. A collection an Evidence Library follows can't
   leave the library's workspace while the library follows it; the move names
   the library to stop following it first.
8. #656: who started what, and activity per item.
9. #657: presence on every item.

#652, #653, #654, #656 and #657 depend on #651 and can run in parallel after it.

## Checks

- Each issue runs its focused Convex tests (`convex-test` under Convex's limits)
  and the migration's dry run before it touches shared dev.
- #650 proves nothing changed: the same people see the same records before and
  after, on shared dev and e2e.
- #651 and every later issue: a browser pass on dev.openscholar.ai with two
  accounts. One creates an organization and invites the other. They switch
  workspaces, work in the organization, and see each other's work, attribution
  and presence. A third account, invited to one item only, sees it under
  "Shared with me" in its personal workspace and not in its organizations.
- #652: a real charge on the e2e Autumn setup, taken from an organization's pool
  and refused past a member's cap.
- The full CI suite gates each PR.

## Done when

Every issue in OS-20 is closed, and the browser pass above works on
dev.openscholar.ai without a fallback to the old per-person ownership.

## Risks

- Clerk caps an organization at 20 members without its $100-a-month B2B add-on,
  which also gates joining by email domain. The first team past 20 needs that
  decision.
- #650 touches nearly every table and index. Large tables migrate in batches,
  and reads switch only once the backfill is verified.
- Every action needs a workspace argument, so assistant tools and the action
  registry (`npm run check:user-actions`) change with #650.
