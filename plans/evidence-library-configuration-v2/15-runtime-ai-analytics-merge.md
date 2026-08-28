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

- new-el `main` = `720a3c45` (after #140, #141, #142), then `95ac3fc0` after
  the merge in #143. Every OpenScholar
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
   attention.

   **Revised 2026-08-28 (lane A).** AI search and deep research are *not*
   shown. The runtime refuses both without `search.embedder`
   (`schema.ts` "AI search requires an embedder", on `main` and on
   `ai-modernization`), and OpenScholar always assembles
   `search.embedder: null` (`lib/evidence-libraries/configuration/assembly.ts`
   sets it from `managed.searchEmbedder`, which nothing fills). A switch that
   can never be turned on is UI the runtime cannot honour, so the AI card
   holds only the master switch, the key and the model. Add the two
   dependants when the platform gives libraries an embedder.
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
`contract-lock.json`, `rules.ts` and a new `ai.ts` (+ tests),
`assembly.ts` (the provider-key hook),
`components/evidence-libraries/configuration/sections/ai-section.tsx` (new),
`analytics-section.tsx`, `configuration-workspace.tsx` (rail), a new
`convex/evidenceLibraries/aiProviderKey.ts` (credential row, removal and the
assembly hook), `configurationDeployment.ts`, `configurationDeploymentActions.ts`,
`applicationSetup.ts`, `applicationSetupActions.ts`, `runtimeConfiguration.ts`,
their tests, `messages/*.json`. `section-registry.ts` and
`features-section.tsx` need no change: `ai` is already a registry section, and
the dependants stay hidden (see Decision 2).

**Re-pinned 2026-08-28** to new-el `main` `95ac3fc0` (the merge of
`codex/merge-ai-modernization`). The contract gained exactly three things:
`openrouter` in the AI provider enum and the model catalog,
`analytics.posthog.uiHost`, and `analytics.consentPolicyVersion`. The
temporary flags that stood in for them while the merge was open are gone and
every test that waited for the catalog now runs.

The AI switch stays disabled with "Your library software does not offer AI
answers yet" when the pinned catalog has no OpenRouter models, so a library on
older software can never be given a setting it refuses.

## Live check on the shared platform — 2026-08-28

Run after #117 merged (`dev` `b9f25939`, shared backend pushed,
`EL_RUNTIME_COMMIT_SHA=95ac3fc0`) on throwaway library `el-gate-0828b`
(`r17490kcjpfbc2ht9qn9cagj8x8dbrk3`), then deleted through the app; the
Coolify app was gone afterwards.

- Compact cookie dialog: **pass** (two toggles, three buttons, new wording).
- OpenRouter key never reaches the browser: **pass** (139 payloads, page HTML,
  storage and every live-library response searched; the key exists only in the
  app's `LIBRARY_CONFIG_JSON` on the server).
- AI answer streams through OpenRouter: **pass on a record with a PDF**
  ("Ask AI → Summarise", `POST /api/ai` → `200 text/event-stream`, Gemini 3.7
  Flash).
- Header logo 150×150 in a 104 px bar: **expected failure**, fixed by new-el
  #144 (`codex/logo-fit`), not yet merged.

### Decided 2026-08-28: the platform embedder was never written

The library-wide assistant (the "Ask AI" box beside search, `POST /api/ai/chat`)
is gated on `features.aiSearch`, and OpenScholar always wrote `aiSearch: false`
because the runtime refuses it without `search.embedder`. The real cause: the
embedder is a platform value (Outline decisions 2026-08-18 and 2026-08-20 —
Perplexity `pplx-embed-v1-0.6b` through OpenRouter, `rest` source,
`https://openrouter.ai/api/v1/embeddings`, 1024 dimensions, OpenScholar writes
it, owners never see it), and `assembly.ts` has the hook
(`managed.searchEmbedder`) but nothing ever fills it. Accepting `aiSearch:
false` as a "deviation" in Decision 2 was wrong. That deviation is withdrawn.

## Decision 7 — platform embedder (lane E)

1. When `features.ai` is on, assembly writes the platform embedder block:

   ```json
   {
     "source": "rest",
     "url": "https://openrouter.ai/api/v1/embeddings",
     "apiKey": "<platform key>",
     "dimensions": 1024,
     "request": { "model": "perplexity/pplx-embed-v1-0.6b",
                  "input": ["{{text}}", "{{..}}"] },
     "response": { "data": [{ "embedding": "{{embedding}}" }, "{{..}}"] }
   }
   ```

   **Corrected 2026-08-28 (lane E).** The model is *not* a top-level field.
   The pinned `rest` embedder allows only `source`, `url`, `apiKey`,
   `dimensions`, `request`, `response` and `headers`, and refuses anything
   else (`library-config.schema.json`, `search.embedder`; new-el
   `restEmbedderSchema`, `schema.ts:711-723`, is `.strict()`). The model
   belongs inside `request`, because the runtime copies `request` straight
   into the Meilisearch embedder setting
   (`src/lib/search-index/embedder-settings.ts:72-84`). `{{..}}` is
   Meilisearch's repeat marker, so one call embeds a batch. There are no
   headers: Meilisearch sends the key as `Authorization: Bearer`.

   The block is copied from Outline "08 — Development and Verification
   Runbooks" (id `30b7169b-1530-424a-a374-80478d1bee56`, "Turning on the
   Similar Resources embedder", checked 2026-08-20 on new-el `openscholar`),
   the only place it exists. It is **not** in the new-el repository: nothing
   in the working tree, `docs/`, or any commit on any branch contains
   `pplx-embed`, and `87e6815a` only guards the record title in the document
   template. When `features.ai` is off the block is `null`.
2. The key is a platform secret read at assembly on the server:
   `EL_EMBEDDING_OPENROUTER_KEY` when set, otherwise `OPENROUTER_API_KEY`.
   Never in `getDraft`, saved rows, logs or the client. Its fingerprint joins
   the existing AI-key snapshot check only if the key can change mid-publish
   (it is an env value, so no).
3. `features.aiSearch` follows the AI answers switch (on ⇔ `features.ai`).
   Deep research stays off; exposing it is a separate decision.
4. Rules: assembly refuses to publish with AI on when neither key exists
   ("The platform has no embedding key yet."), the same way missing mail is
   refused before any Coolify resource exists.
5. Tests: assembly emits the block only with AI on; key source precedence;
   `aiSearch` derived; the assembled config validates against the pinned
   schema with the embedder present; `getDraft` and operation records carry
   no key.
6. Deployability gate: `npx convex dev --once` on the lane; publish a lane
   library with AI on and confirm the runtime manifest holds the `rest`
   block and `aiSearch: true`; on the shared platform after merge, the
   library-wide "Ask AI" answers (the live check that failed on
   `el-gate-0828b`).

### The deployment record holds every platform secret — checked 2026-08-28

A review of #120 asked lane E to keep the embedding key off the publish
operation record and inject it only when writing `LIBRARY_CONFIG_JSON` to
Coolify. Checked in the code, the answer is that the embedding key is stored
exactly like every other platform secret, and lane E changes nothing about
that:

- `configurationDeployment.ts:748` stores `aiProviderKey` on the target, but
  that field is only a fingerprint — `{ present, id, digest }`
  (`validators.ts:17-26`). #117 already keeps the OpenRouter key itself off
  the record as a separate field.
- The one place any secret sits on the record is `encryptedRuntimeConfig`
  (`configurationDeployment.ts:760`), the whole assembled configuration
  encrypted with `ENCRYPTION_KEY`. It has always held the database URL with
  its password, the Meilisearch key, the storage service-role key, the
  authentication secret, the machine credential and, when the platform mail
  service is set up, the SMTP password. #117 added the OpenRouter answer key
  to the same place. Lane E adds the embedding key there too.

So the OpenRouter key does travel the same path, and lane E matches that
mechanism exactly, as the review asked in its second case. Removing only the
two AI keys would leave six older secrets in the same row and change nothing
an attacker could reach.

Making the target secret-free is worth doing, but it is its own piece of
work: the bytes sent to Coolify are hashed (`runtimeConfigSha256`) and
compared against what Coolify saved, so any re-injection has to reproduce the
exact same JSON, and all seven secrets have to move together. Lane E does not
attempt it. What lane E does instead, and proves in
`configurationDeployment.test.ts`, is that no owner-facing query
(`getDraft`, `listLibraryOverviews`, `listVersions`) ever carries either key
after a real publish.

Lane E · OpenScholar · `codex/platform-embedder` (worktree `../ai-sprint`,
Convex lane `calm-labrador-815`, port 3013). Files:
`lib/evidence-libraries/configuration/assembly.ts` (+ tests),
`convex/evidenceLibraries/configurationDeploymentActions.ts` and
`applicationSetup*.ts` (managed values), `owner-rules.ts` / `ai.ts`
(`aiSearch` derivation), `messages/*.json` if any copy changes.
