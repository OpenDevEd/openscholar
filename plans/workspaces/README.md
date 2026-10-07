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
  Library invitations today. They see it under "Shared with me" in every
  workspace, and work they run on it uses the workspace they're in.
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
- User actions: every action runs through `userMutation`, `accountMutation` and
  `assistantMutation` in `convex/lib/userActions.ts`, which know the action, the
  person, and whether the assistant made the change. They are the single place
  for the workspace check and for writing activity.
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
ratings, model API keys and "My key" settings (personal workspace only),
connected apps (`walletKeys`), the Zotero connection, request receipts and undo,
export downloads and resource locks.

What moves to the workspace: library papers, collections and their memberships,
removals and counts, searches with their revisions, history, screenings and
answers, bookmarks (`queryShortcuts`), record counts, screening and extraction
jobs, queues and slots, assistant chats, author profiles, Evidence Libraries,
and billing (accounts, holds, usage, transactions).

- A `workspaces` table: `kind` (personal or organization), the account or the
  organization, and its Autumn customer ID. A personal workspace keeps the
  existing Autumn customer, the user's ID, so no Autumn customer moves.
- Each moved record gets `workspaceId` and `createdBy`. `createdBy` takes the
  old `userId`, which is what makes "who started it" possible. `by_user` indexes
  become `by_workspace` ones.
- Evidence Libraries change from `organizationId` to `workspaceId`. This is saved
  library data, so it follows the migration rules in `docs/agents/project.md`.
  Names and addresses become unique per workspace. new-el has no notion of
  organizations, so it doesn't change.
- Every change widens, migrates with `@convex-dev/migrations` (audit and dry run
  first, then verified on shared dev and e2e), then narrows. Nothing is wiped,
  and no field stays as a fallback.

## Order and owners

1. #649: upgrade to Clerk 7 (Core 3).
2. #650: workspace ownership with personal workspaces only. No visible change.
   Owner of the invariant "every record has exactly one workspace and every
   action checks it": `convex/lib/userActions.ts` and a new `convex/workspaces/`.
3. #651: organizations in OpenScholar, the switcher, the workspace in the URL,
   Account and Workspace settings, and the organization's AI preset.
4. #652: Team plan, workspace billing, and features from plans. Owner of "the
   workspace you're in pays": `convex/billing/accounts.ts`. The Team plan's price,
   credits, limits and features need the user's decision first.
5. #653: guests. One access table replaces the three; owner `convex/sharing/`.
6. #654: moving items between workspaces. Evidence Libraries move through #46.
7. #655: ratings in one table, plus collection ratings.
8. #656: who started what, and activity per item.
9. #657: presence on every item.

#653 to #657 depend on #651 and can run in parallel after it.

## Checks

- Each issue runs its focused Convex tests (`convex-test` under Convex's limits)
  and the migration's dry run before it touches shared dev.
- #650 proves nothing changed: the same people see the same records before and
  after, on shared dev and e2e.
- #651 and every later issue: a browser pass on dev.openscholar.ai with two
  accounts. One creates an organization and invites the other. They switch
  workspaces, work in the organization, and see each other's work, attribution
  and presence. A third account, invited to one item only, sees it under
  "Shared with me".
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
