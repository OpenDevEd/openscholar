# 01 — Schema field for the toggle + capability helper

## Goal

Add the per-thread `webSearchEnabled` field on `extractionJobs` and the pure-logic capability helper that the UI and backend will consume to decide whether the toggle is operable for the active model. Zero new tables, zero new columns on `models` (per `00-README.md` §5 — `supportedParameters` already exists).

## Scope

In:
- `convex/schema.ts`: extend the `extractionJobs` table validator with `webSearchEnabled: v.optional(v.boolean())`.
- New file `lib/chat/web-search-capability.ts`: pure function `modelSupportsWebSearch(model: { supportedParameters?: string[] }): boolean`.
- New file `lib/chat/web-search-capability.test.ts`: vitest unit tests for the helper.

Out:
- Models-table changes (none — use existing `supportedParameters`).
- Capability helper for native engine vs Exa engine routing — out of scope (see plan 04, OpenRouter factory hardcodes `engine: "auto"`).
- Mutation that sets the new field — see plan 03.
- Any read of the field — see plan 06.

## Design

The toggle is an opt-in surfaced once per thread. We store it on the `extractionJobs` row that already carries every other chat-thread setting (model id, sources, etc.). Optional; default false (omitted) to avoid touching every existing dev row.

The capability helper is the single contract the UI (plan 07) and backend (plan 06) both read. Any future change to capability semantics (native engine gating, model deny-list) flows through this one function.

### Helper contract

```ts
// lib/chat/web-search-capability.ts
export function modelSupportsWebSearch(model: { supportedParameters?: string[] | null } | null | undefined): boolean {
  if (!model) return false;
  const params = model.supportedParameters;
  if (!params || params.length === 0) return false;
  return params.includes("tools");
}
```

Why `tools` and not a more specific predicate:
- OpenRouter's plugin / `:online` mechanism is universal across chat models, but our project uses the server-tool path (Path A) and the custom-tool path (Path B); both require the model to emit tool calls.
- The OpenRouter `/api/v1/models` endpoint exposes `supported_parameters: string[]`. Models with tool calling have `"tools"` in that array. No `"web_search"` entry exists; `"tools"` is the right gate. (Verified: research agent 6.)

## TDD sequence

R1 — RED: write `web-search-capability.test.ts` with cases:
- empty/missing `supportedParameters` → `false`
- `["tools"]` → `true`
- `["tools","tool_choice","web_search_options"]` → `true`
- `["web_search_options"]` only (Perplexity Sonar shape) → `false`
- `null` model → `false`
- `undefined` model → `false`

G1 — GREEN: implement `modelSupportsWebSearch` to satisfy R1. Commit `test(chat): [plan-01] add web-search capability helper tests` then `feat(chat): [plan-01] modelSupportsWebSearch helper` as separate commits per CLAUDE.md (one commit per TDD green).

Phase B (test-after, single unit, single commit):
U1 — Add the schema field and run `npx convex codegen` if applicable so the generated `dataModel` types pick it up. Commit `feat(chat): [plan-01] webSearchEnabled field on extractionJobs`.

## Files touched

- `convex/schema.ts` — add `webSearchEnabled: v.optional(v.boolean())` inside the `extractionJobs` defineTable. Insert near `chatModelId` for proximity to other chat-mode fields.
- `lib/chat/web-search-capability.ts` — new (~10 LOC).
- `lib/chat/web-search-capability.test.ts` — new (~40 LOC).

## Migration stance

Additive optional field. No backfill, no widen-then-narrow. Existing rows omit the property and read as `undefined`, which the consumers treat as `false`.

If a deployed dev environment somehow rejects the schema validator after the change (e.g. because someone wrote a literal `null` to the field manually), wipe `extractionJobs` rows of mode `"chat"` via the Convex dashboard or a dev-gated admin helper.

## Test plan

- `lib/chat/web-search-capability.test.ts` — vitest unit, 6 cases above.
- Manual: open the Convex dashboard after the schema change; confirm the new field appears as nullable on the `extractionJobs` schema view.
- No integration test needed at this slice — consumers are added in later plans.

## Acceptance criteria

- [ ] `modelSupportsWebSearch(...)` exists at `lib/chat/web-search-capability.ts` and exports a single named function.
- [ ] All six TDD cases pass.
- [ ] `extractionJobs.webSearchEnabled` is in the schema as `v.optional(v.boolean())`.
- [ ] `npx convex codegen` (or the project's equivalent typegen) succeeds with no warnings about the new field.
- [ ] `tsc --noEmit` clean.
- [ ] No existing test regresses (`npm test` or project's test script).

## Known pitfalls

- **Do not place the field outside `extractionJobs`**. Resist the urge to make a new `chatThreadSettings` table — the existing chat thread is one-to-one with `extractionJobs` (mode `"chat"`).
- **Do not infer capability from model id substring** (e.g. `id.startsWith("anthropic/")`). The matrix changes; lean on `supportedParameters`.
- **Do not import `Doc<"models">` into `lib/chat/`** — `lib/` is framework-agnostic. Type the helper's input as a structural minimum: `{ supportedParameters?: string[] | null }`.
- **Do not add `capabilities.webSearch?: boolean`** to the `models` table even though it would feel natural. It would shadow `supportedParameters` and create a sync trap (forgetting to update both during seeding). Use the helper.
