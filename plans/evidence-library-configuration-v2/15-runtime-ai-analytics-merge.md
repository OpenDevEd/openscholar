# Plan 15 — Merge the AI and analytics modernisation into the runtime

## Goal

Every library runs the Evidence Library `ai-modernization` work: the new AI
assistant (OpenRouter), the consent-aware analytics with the compact cookie
dialog, and everything else on that branch. OpenScholar exposes what the
runtime now supports: an AI section with **OpenRouter only** (switch, API
key, default model), and two analytics settings the branch adds. Then the
logo sizing bug is fixed on the runtime: a library's logo never leaves the
height of its bar, whatever its shape.

## Facts checked on 2026-08-28

- new-el `main` = `720a3c45` (after #140, #141, #142). Every OpenScholar
  library builds from `OpenDevEd/new-el` at `EL_RUNTIME_COMMIT_SHA` on
  `main` (`convex/evidenceLibraries/coolifyClient.ts:28-30`).
- Three branches carry the modernisation:
  - `ai-modernization`: 69 commits ahead of `main`, 37 behind; merge-base
    2026-08-27. It already merged the analytics work ("merge: add runtime
    analytics modernization", `581fd59a`) and `main` ("merge: update AI
    modernization with main", `636f0efc`). **This is the branch to merge.**
  - `codex/ai-modernization`: 23 ahead, 538 behind, base 2026-07-23 — a
    stale copy of the same line. Not merged.
  - `codex/coolify-analytics-modernization` (= `coolify`): 25 ahead, 538
    behind — the stale copy plus the two analytics commits that
    `ai-modernization` already contains. Not merged.
- Files changed on both sides since the merge-base (conflicts to expect):
  `src/proxy.ts` (our admin gate and reserved routes), `src/app/api/redirects/[...path]/route.ts`
  (our repaired query), `src/db/database-schema.ts` (our `itemInstitution`),
  `tests/acceptance/fixture/Caddyfile`, `tests/unit/runtime-generation-routes.test.ts`,
  `tools/runRuntimeAcceptance.ts` (our new steps). 199 files, +20 845/−6 335
  on the branch overall.
- Config schema changes on the branch (`src/config/library-config/schema.ts`,
  `catalogs.ts`): a new `openrouter` entry in `PLATFORM_AI_MODEL_CATALOG`
  (`active`, `large`, `small` model lists), `analytics.posthog.uiHost`
  (optional HTTPS origin; needs `host`), `analytics.consentPolicyVersion`
  (integer ≥ 1, default 1). The AI shape itself is already on `main`:
  `ai.providers[]` = `{ provider, enabled, apiKey (secret), defaultModel,
  largeModel?, smallModel? }`, enabled ⇒ key and default model required,
  models validated against the catalog.
- OpenScholar today: the Features section hides the AI group (plan 07
  decision); the Analytics section knows PostHog `host` + `key` and Google
  `measurementId`; `ai.providers[].apiKey` is a write-only pointer handled by
  the credentials store (plan 02/07: per-group Zotero keys are injected at
  assembly; the same mechanism carries provider keys).
- Logo sizing (checked on `ai-stuff-lib.opendev.space`, 2026-08-28): the
  header, footer and cookie-dialog logos are `<img class="h-auto max-h-full
  w-auto max-w-full">` inside a parent with **no height of its own**, so the
  image renders at its intrinsic 150×150 and the parent grows to 150 px —
  the bar's padding is ignored and a square logo leaves the bar. A landscape
  logo would be as tall as its intrinsic height too.

## Decisions

1. **Merge `ai-modernization` into `main` with a merge commit**, resolving
   the six conflicts in favour of keeping both: our admin gate order and
   reserved-routes helper in `src/proxy.ts`, our redirect query, our
   `itemInstitution` table, our acceptance steps, plus everything the branch
   adds. Never take "theirs" wholesale on those files. Delete the two stale
   branches afterwards (`codex/ai-modernization`,
   `codex/coolify-analytics-modernization`, and `coolify` if identical).
2. **OpenScholar AI section, OpenRouter only.** One section "AI" under
   Discovery with: a master switch "AI answers" (`features.ai`), the
   OpenRouter API key (write-only credential, stored encrypted, injected at
   assembly into `ai.providers[0].apiKey`; the field shows "Key saved" with
   Replace/Remove like Zotero keys), and "Default model" picked from the
   runtime's `openrouter.active` catalog (pinned contract, not a live list).
   Large/small models take the runtime defaults and are not shown. No
   credits path, no other providers, no embeddings note. `ai.providers` is
   written as exactly one entry `{ provider: "openrouter", enabled, apiKey,
   defaultModel }`. Rules: AI on without a key or a model → section needs
   attention; `features.aiSearch`/deep research dependants follow the
   existing feature-dependency rules.
3. **Analytics gains two fields**: "PostHog UI host" (optional; only when a
   PostHog host is set; hint: where session recordings open) and "Consent
   policy version" (a number; hint: raise it when your cookie text changes
   so visitors are asked again). Nothing else changes; consent stays
   runtime-side.
4. **Contract re-pin** to the merged `main` commit
   (`node scripts/sync-evidence-library-config-contract.mjs --commit <sha>`)
   before the OpenScholar sections change; the schema limits for the new
   fields come from the pinned schema.
5. **Logo sizing in the runtime** (after the merge, so it lands on the
   merged components): the bar owns the height, the image fits inside.
   Header: the logo box is `h-10` (mobile `h-9`) with the bar's padding
   around it; `<img class="block h-full w-auto max-w-[12rem] object-contain">`.
   Footer: the same rule with the footer's own box (`h-12`, `max-w-[14rem]`).
   Cookie dialog: `h-8`, `max-w-[9rem]`. Square, landscape and portrait
   logos all fit: height is fixed by the box, width follows the aspect ratio
   up to the cap, and `object-contain` never crops. Intrinsic SVG sizes stop
   mattering. Institution and funder logos on record pages use the same
   pattern with their own boxes. Proven with three fixtures (square,
   3:1 landscape, 1:2 portrait) in a browser test that measures the image
   box against the bar.
6. **Deployment order**: merge runtime → re-pin → OpenScholar PR (AI +
   analytics) → `convex:push` → set `EL_RUNTIME_COMMIT_SHA` to the merged
   commit → publish a test library with AI on and check the assistant
   answers through OpenRouter (the platform's test key from the shared
   env, never committed) → logo PR merged → bump again → check the three
   logo shapes on the test library → tear down.

## Lanes

| Lane | Repo | Branch | Owns |
|---|---|---|---|
| M · Runtime merge | new-el | `codex/merge-ai-modernization` | the merge commit and conflict resolution only; then, in a second PR `codex/logo-fit`, the logo sizing (header, footer, cookie dialog, record-page institution/funder logos, tests, docs) |
| A · OpenScholar | openalex-count | `codex/ai-openrouter-analytics` | contract re-pin (`lib/evidence-libraries/configuration/generated/**`, `contract-lock.json`), `section-registry.ts`, `rules.ts`, new `sections/ai-section.tsx`, `sections/analytics-section.tsx`, `features-section.tsx` (AI group), `convex/evidenceLibraries/credentials*.ts` and assembly for the provider key, their tests, `messages/*.json` keys under `evidenceLibraryConfiguration.ai` and `.analytics` |

Lane A starts on the contract as it stands (the AI provider shape is already
on `main`) and re-pins once lane M's merge lands; the OpenRouter catalog
list arrives with that re-pin.

## Test-first steps

### Lane M

1. Merge; resolve; `npm run check:changed` must pass (Fallow gates only
   changed lines — the branch's own dead code, if any, must be fixed, not
   suppressed). Unit tests green. `npm run test:acceptance` with own image
   tags must pass end to end; poll it in one loop.
2. Logo PR: `tests/unit/brand-logo.test.tsx` (or the closest existing
   component test) renders the header, footer and cookie logo boxes and
   asserts the box height class and the image's fit classes via `data-*`
   or roles, plus a Playwright check in the acceptance admin suite that
   measures `img.getBoundingClientRect()` against its bar for the three
   fixture shapes (square, landscape, portrait) — height ≤ box height,
   width ≤ cap.

### Lane A

1. `lib/evidence-libraries/configuration/rules.test.ts`: AI on without key
   → problem; without model → problem; model outside the catalog → problem;
   off → no problems; `ai.providers` serialises to one OpenRouter entry.
2. Credentials: the OpenRouter key is stored encrypted, never returned by
   `getDraft`, injected at assembly into `ai.providers[0].apiKey`; Remove
   deletes the row; test with the existing credential fixtures.
3. Component tests for the AI section (switch, key field states, model
   picker from the catalog) and the two analytics fields (UI host hidden
   without a host; version accepts integers ≥ 1).
4. Configuration workspace test: the AI section appears in the rail under
   Discovery with the state dot.

## Deployability gate

- Lane M: Fallow pass, unit green, acceptance green, PR to `main`, no merge.
  Logo PR the same, plus the measurement test output in the PR body.
- Lane A: `npx tsc --noEmit`; `npx vitest run convex/evidenceLibraries
  lib/evidence-libraries tests/components/evidence-libraries
  tests/components/evidence-library-configuration-workspace.test.tsx`;
  `npm run schema:check:evidence-library-config`; `npx convex dev --once`
  on the lane; browser on the lane port: the AI section with the key saved
  and a model chosen, Save, and the assembled config (`readinessSetup`
  fixture or the lane's dev tool) carrying the OpenRouter entry; screenshots
  in `/tmp/ai-section/`. PR to `dev`, no merge.
- Integration owner: the order in Decision 6, with a real library on the
  shared platform: AI answers through OpenRouter, cookie dialog compact,
  PostHog with UI host, and the three logo shapes inside their bars.

## Known risks

- The merge is large (199 files). Anything that changes the acceptance
  fixtures (`Caddyfile`, `runRuntimeAcceptance.ts`) must keep our added
  steps (institutions, redirects, admin redirect, legal text).
- The branch's `docs/ai-modernization-contract.md` describes three
  credential paths (own keys, OpenRouter, OpenScholar credits). Only
  OpenRouter is built; the OpenScholar UI must not promise the others.
- OpenRouter keys are secrets: never in `getDraft`, never in logs, never in
  the assembled config that leaves the deploy action.
- `consentPolicyVersion` changing re-asks every visitor for consent; the
  hint must say so.

## Files that change

Lane M: merge commit; then `src/components/**` (header, footer, cookie
dialog, record page brand images), their tests, `docs/evidence-library-customization-map.md`.

Lane A: `lib/evidence-libraries/configuration/generated/**`,
`contract-lock.json`, `section-registry.ts`, `rules.ts` (+ tests),
`components/evidence-libraries/configuration/sections/ai-section.tsx` (new),
`analytics-section.tsx`, `features-section.tsx`, `configuration-workspace.tsx`
(rail), `convex/evidenceLibraries/credentials.ts`, `configurationDeploymentActions.ts`
(assembly), their tests, `messages/*.json`.
