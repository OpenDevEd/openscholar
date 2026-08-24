# Evidence Library configuration prompts

Run these prompts in order. Work in `/Users/mcharrad/Documents/Github/openscholar/dev-self` on branch `dev`. Read `AGENTS.md`, `00-README.md`, and the named plan first. Preserve unrelated local files. Use hosted Clerk and hosted Convex. Do not start PM2 or a local Convex server. Do not push unless the user asks.

## Plan 03

Implement `03-route-shell-and-anchor-rail.md`. Search the repository before adding code. Start with failing permission and route tests. Build the owner-only configuration route with Identity, Branding, and Languages links. Deny members instead of building a read-only copy. Run the focused tests, TypeScript, and the real local browser through `npm run dev`. Commit each working unit with a conventional commit.

## Plan 04

Implement `04-brand-content-and-collection-editors.md`. Use the pinned schema and catalogs. Add only the approved identity, read-only public address, logo and favicon URL, colour, and language fields. Do not build a general schema form or an upload service. Test labels, errors, keyboard use, and the language relationship. Run the focused tests, TypeScript, and browser check. Commit each working unit.

## Plan 05

Implement `05-discovery-and-platform-editors.md`. Refresh the contract from `OpenDevEd/new-el/main`, then add save and reload for the visible groups. Reuse the existing Evidence Library draft and binding code. Build one pure complete-config assembler from visible values and explicit managed inputs. Do not use placeholders for missing credentials or platform values. Test stale saves, authorization, deterministic output, and structural validation. Push Convex with `npm run convex:push` and inspect the deployed function spec. Commit each working unit.

## Plan 06

Implement `06-validation-publish-rollback-handoff.md` after issues #18 and `OpenDevEd/new-el#54` provide the authenticated service contract. Add validation, no-deploy preview, immutable requested revisions, safe retry, operation receipts, and exact health readback. Route new libraries to #26 and running libraries to #65. Do not add rollback UI or app-release management. Test failures before the real development activation. Commit each working unit.

## Plan 07

Implement `07-accessibility-browser-and-release-gates.md`. Add the focused axe and Playwright journey. Use real Clerk, hosted Convex, and Coolify app `rzbo9als0hdnr4gegtx97qos`. Prove save and reload, permission denial, validation, preview without deployment, activation, safe retry, and failure without losing the active revision. Remove dead or deferred code. Run every final check listed in the plan and record exact results.
