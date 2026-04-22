# Plan 05 — Shared Live State And Model Catalog

## Goal

Consolidate repeated small subscriptions where the subtree genuinely shares them, and downgrade the AI model catalog from a broad mounted live query to a low-freshness explicit read with a smaller returned shape.

## Scope

In scope:

- introduce subtree-scoped provider sharing for repeated small live state where there is a real common owner,
- hoist duplicate `useSubscriptionState` / `getMyBalance` usage where appropriate,
- hoist repeated extraction-side small queries such as bucket limits or chat-model lists when the subtree already has a common owner,
- remove duplicate child-level `getCollectionsWithCounts` reads where the parent already owns the same data,
- replace the AI settings page’s live whole-catalog models query with an explicit low-freshness read and smaller result shape.

Out of scope:

- changing server-side billing business logic,
- redesigning settings pages,
- adding a new cache/state library.

## Design

1. **Use provider-style sharing only where the subtree already exists.**
   Mirror the `FeatureFlagProvider` pattern for repeated small live state, but do not create a root-global provider unless the data is truly app-shell-wide.

2. **Prefer one live query over several sibling live queries.**
   For subscription state, balance, bucket limits, chat-model lists, or collections counts, the first fix is surface-local sharing, not adding more hooks.

3. **Downgrade the AI model catalog to a low-freshness explicit read.**
   The AI settings page does not need live model-catalog reactivity. Replace `useQuery(api.models.queries.list, ...)` with an explicit read path and a projected response shape containing only the fields the settings UI needs.

4. **Keep the repo package-free.**
   Use existing Convex/Next/provider primitives only.

5. **Do not over-globalize.**
   A provider is only warranted if there is a real common subtree owner. Otherwise, the parent page should own the query and pass data down.

## TDD sequence

1. Add red tests for the new provider/selector behavior where a shared subtree is introduced.
2. Add red tests for the smaller model-catalog query/result shape and the AI settings page’s explicit-read behavior.
3. Green the provider/model work.
4. Add/update component tests proving duplicate child-level queries are gone from the targeted surfaces.

## Files touched

- subtree provider files under `components/providers/` or feature-local providers
- `lib/auth/use-subscription-state.ts` consumers
- extraction/library page/component consumers of repeated small queries
- `app/settings/ai/page.tsx`
- `convex/models/queries.ts`
- relevant tests

## Migration stance

None.

- No schema changes expected.
- No compatibility dual path after each surface is cut over.

## Test plan

- Provider/component tests for shared small live state.
- Query tests for the smaller model-catalog response.
- AI settings page tests for explicit-read loading/search behavior.
- Manual smoke:
  - settings/billing still renders correct plan/balance state,
  - extraction bucket/chat surfaces still read limits/models correctly,
  - library collection actions still render collection counts,
  - AI settings page still allows provider/model selection.

## Acceptance criteria

- Targeted repeated small queries are hoisted/shared instead of being mounted redundantly in sibling consumers.
- AI settings no longer mounts a live whole-catalog `models.list` subscription.
- The AI model catalog read returns only the fields the page uses.
- No new package is added.

## Known pitfalls

- Do not create a root-global provider for data that only one page subtree needs.
- Preloaded Convex queries still resume live subscriptions; do not mistake preloading for deduplication.
- Keep settings/catalog reads explicit and low-freshness; do not accidentally make them mounted live queries again.

