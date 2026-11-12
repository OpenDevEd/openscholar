# Publish to Openscholar Reports

Milestones OS-32 (`OpenDevEd/openalex-count`) and EL-36 (`OpenDevEd/new-el`).
Workflow rules live in the root `AGENTS.md` and `docs/agents/project.md` of each
repository. This file holds the decisions, what the build reuses, the data, the
slices and when each is done.

## Problem

A researcher with a finished report has no way to give it a DOI unless a
community publishes it for them. Openscholar Reports is a series Openscholar
publishes itself: the author signs a publishing agreement, gets a DOI, uploads
the PDF, confirms the details read from it, passes a set of checks and
activates the DOI. The report then has a page at `/papers/R…` like any paper.

## The mock is the specification

Branch `mock/publish-reports` holds the agreed design, built inside the real
app with a local file for a store (`.publish-mock/state.json`,
`lib/publish-mock/`, `app/actions/publish-mock.ts`, `components/publish-mock/`).
The user reviewed it screen by screen on 2026-11-09 and 10. The build keeps its
screens, wording, addresses and behaviour, and replaces the store and the
server actions with Convex. Every commit on that branch counts, late fixes
included.

## Decisions (2026-11-09 and 10, the user)

- **Flow.** `/publish`: sign the agreement, a DOI is reserved and the report
  gets a key `R…`, upload the PDF, confirm the details an AI model read from it,
  run the checks, activate. A report that passes exists; one that fails has no
  page and no lookup finds it.
- **A report belongs to the workspace it starts in.** A person's own workspace
  and each organisation's have separate lists (`/publish`, `/o/<slug>/publish`).
  In an organisation's workspace every member sees its reports; the report's
  owner (who started it) and the workspace's admins change them.
- **Limits are per workspace.** Two defaults: 1 report a day for a person's own
  workspace, 0 for an organisation's. Admins give a workspace its own number.
  A start counts for 24 hours and a discard doesn't give it back; raising a
  limit opens (new limit minus used) more the same day.
- **Activating spends from a balance (2026-11-12).** Each workspace has a
  balance of activations in Autumn (`report_activations`), filled by plan items
  and by balances given in Autumn's dashboard, once or refilled every day,
  week, month or year. Activating spends one, with no card and no code. With
  none left it buys one (the `report_activation` plan, less a promotion code),
  which goes to the balance and is spent at once. One bought for a report that
  can't go live any more stays in the balance, and whoever paid is emailed.
  This replaces the free activations a day that admins set on the Publishing
  page (#1261) and the refund of a payment that came back late. Reason: the
  user asked for one balance per person or organisation that Autumn refills.
- **Checks are admin-defined yes-or-no questions**, each on a decision model or
  an LLM, with a threshold, a blocking switch and advice for the author. Already
  published is built in: it searches OpenAlex, Openscholar's index and the
  communities, and a model judges whether a hit is the same work. Checks run on
  Jev and the text model. Authors never see model names.
- **Nothing settings-dependent is frozen on a report.** A passed report is
  saved as passed; whether it waits for a reviewer is worked out from the
  settings as they are (`stageOf`). Switching human review off releases what
  waited only for it.
- **Reviewers are Openscholar admins.** From `/settings/admin/publishing` they
  approve, decline, withdraw and reinstate any report whatever its checks said,
  approve or decline changes to a live one, and edit a report's details
  directly without the checks, in the author's own form. A late Decline never
  withdraws a report that has gone live: withdrawing is its own decision.
- **A live report is corrected by its author and the checks run again.** The
  changes go live at once only when every check passes and review is off;
  otherwise the report stays as it was until a reviewer decides. A report
  approved over a check needs a reviewer again when it changes.
- **Registration is Crossref, Zenodo or both**, set by admins with the form a
  community uses. A report's route is fixed when its DOI is reserved. Nothing
  launches without an ISSN; until then the byline reads "pending".
- **A withdrawn report keeps its address**, which shows a Withdrawn page, and
  its DOI keeps leading there.
- **Emails.** The team's inbox hears of a review request, a report or changes
  waiting for review, a refused registration, a check or a PDF that couldn't be
  read, and a report going live. The author hears of each reviewer decision,
  and when the report or its changes go live. Every link opens the thing the
  email names.
- **State lives in the address**, and every navigation is a history step
  (`lib/url-state/step-back.ts`). Paging scrolls to the top with nuqs's own
  option.
- **Paper pages** (every paper): the bar holds Ask about this paper, Cite,
  Share and Read PDF; one row under the header holds Save, Add to collection
  and Add to community, each named.
- **Out of scope:** paying, publishing into a community from the flow,
  citation counts on a report's page, checks that read only the PDF after an
  ISSN change.

## What the build reuses

| Need | Existing code |
|---|---|
| Who may act in a workspace | `convex/workspaces/actor.ts` (`actorIn`, `requireMakerOrAdmin`) |
| Who is an Openscholar admin | `convex/admins/access.ts` (`requireAdmin`) |
| User actions and the assistant's registry | `convex/lib/userActions.ts`, `userActionRegistry.ts` |
| Registrar accounts and their secrets | `convex/evidenceLibraries/publicationValidators.ts`, `publicationCredentialVerification.ts`, `convex/lib/crypto.ts`, and the community's `PublicationForm` |
| PDF upload | Convex file storage, as `convex/extraction/uploads.ts` |
| PDF text | `convex/extraction/pdfjs_extract.ts` |
| Yes-or-no and LLM calls | `lib/ai/decisions.ts`, `convex/ai/serverModel.ts` |
| Mail | `convex/lib/invitationDelivery.ts`, laid out by `lib/contact.ts` (`labelledEmail`) |
| Paper identity | `lib/papers/paper-ref.ts` gains the source `report` (`report:R…`) |
| Lists | `components/command-center/entry.tsx`, `CommandCenterPagination` |
| Communities asking about a DOI | `/api/v1/evidence-libraries/papers/resolve` (`convex/http.ts`) |

Crossref and Zenodo deposits are new in Openscholar: a community's are made by
new-el's publication worker. A report's are made through the package that
worker uses, `@opendeved/doi-sync-core` (its Crossref and Zenodo clients and
its record mapping), from `convex/reports/registrar.ts`, in that worker's order
(`reuse-crossref`: Crossref, then Zenodo archives under the Crossref DOI;
`mint-zenodo`: Zenodo, then Crossref). Every call to Zenodo sends Openscholar's
User-Agent, because zenodo.org answers 403 to Node's default one (fixed for
credential checks in #1186). The package is a public GitHub dependency with a
build step, as in new-el.

## Data

New tables, all in `convex/reports/`. Nothing existing changes shape, so there
is no migration.

- `reportSettings`: one row. The switch, human review, the series (name, ISSN,
  byline), registrar settings with their credentials encrypted, the two default
  limits, the metadata model, the checks with their version, and the agreement
  with its version.
- `reportCheckVersions`, `reportAgreementVersions`: each version's text, kept
  because a report records which it was checked and signed under.
- `reportStarts`: one row per report started, by workspace and time. The count
  of a day's rows is read with a cap of the limit.
- `reports`: one row per report, by key, by workspace and by DOI: what a list
  shows of it (owner, workspace, step, status, signature, PDF and cover files,
  where its changes and its registrations stand).
- `reportDetails`: a report's details, its checks' answers, its author's
  request for a review and changes that wait, one row per report.
- `reportFiles`: which report each stored file belongs to.
- `reportReviews`: each reviewer's decision on a report.
- `reportEmails`: each email written about a report, sent or not.
- `reportKeys`: the counter keys are handed out from.

A live report's PDF and cover are public; a report that isn't live serves its
files to its workspace and to admins only.

## Slices

Each is one pull request into `dev`, behind the settings switch, which starts
off. Order matters only where stated.

1. **Paper page actions and history helpers** (#1200). The shared changes the
   mock made outside Publish: the paper page's bar and row, `SaveControl`
   named, `step-back.ts`, `onBackClick` on the page shells. Check:
   `npm run verify -- shift` on a paper page.
2. **Settings and limits** (#1201). Tables, admin functions and
   `/settings/admin/publishing` Settings, with the workspace limit rule.
   Checks: Convex tests for the limit arithmetic and for who may read and
   write; the page in the browser on a throwaway Convex project.
3. **Publishing a report** (#1202). The author's flow from agreement to ready,
   Your reports, discard, and the checks as a Convex action. Checks: Convex
   tests for every state change and refusal the mock's scripts cover
   (`stageOf`, stale writes, the wrong workspace, a member who isn't an admin);
   the flow in the browser with a real PDF.
4. **Reviewing and corrections** (#1203, #1204). The admin list and dialog,
   every decision, edit details, and an author's changes to a live report. Depends on 3.
5. **Registration** (#1205). Activate, Crossref and Zenodo deposits with
   retries, redeposit on a correction, withdrawal and reinstatement told to the
   registrars. Check: one report through both sandboxes, read back from each.
   Depends on 3.
6. **A report as a paper** (#1206). `report:` paper keys, the page at
   `/papers/R…`, Cite, Save and collections, the Withdrawn page, and the answer
   `papers/resolve` gives a community for a report's DOI. Depends on 3.
7. **Emails** (#1207). Each event sent through the mail service. Check: the
   Clerk and mail logs for a test account's report.
8. **Languages** (#1208). Every string in `messages/` for the 13 locales.
9. **Communities take a report by DOI** (OpenDevEd/new-el#814). new-el asks Openscholar first
   for a DOI, keeps the record as Openscholar's, takes the PDF from Openscholar
   and follows corrections and withdrawal on sync. Depends on 6.

## Checks and gates

- Each slice: its focused tests, `npx tsc --noEmit`, `npm run check:user-actions`,
  `npm run check:convex-rules`, `npm run check:ui-rules`, and `verify shift` on
  the routes it touches.
- Unmerged Convex changes are tried on a throwaway Convex project, never on
  `convex-e2e` or shared dev.
- Final gate: one report from agreement to live on shared dev with the switch
  on for a test workspace, its emails read, its page opened signed out, then
  the switch off again.

## Completion

The milestone is done when a person on shared dev can publish a report end to
end with both registrars on sandbox, a reviewer can decide on it, a community
can add it by DOI, and `lib/publish-mock/`, `components/publish-mock/`,
`app/actions/publish-mock.ts` and `.publish-mock` exist nowhere.

## Left out of the first build

- A report registered with Zenodo alone: its DOI would be Zenodo's to reserve
  at signing, and `sign` refuses that route until it is built.
- A series deposit with its ISSN at Crossref (`report-paper_series_metadata`),
  which `@opendeved/doi-sync-core` doesn't make yet. A report is deposited as a
  report-paper with the series as its institution.
- A saved copy of a report following its corrections (#1219).
- Funders, references and related links in the Crossref deposit (#1221): the
  package deposits none of them yet, so the details form marks those sections
  as Openscholar's alone.

## Known risks

- Sandbox DOIs don't resolve on doi.org, so on dev a report is reachable only
  through Openscholar.
- An edit to a live report has three places to reach: Crossref (redeposit),
  Zenodo (edit the published record) and each community that added it.
- The series has no ISSN yet. When it gets one the byline changes, and the
  byline check then fails on changes to reports published before it.
- Firefox settles the Publish card a few pixels after load. The shared shell's
  toolbar does it, on dev too.
