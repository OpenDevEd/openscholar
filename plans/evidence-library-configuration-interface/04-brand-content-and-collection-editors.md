# Plan 04 — Brand, Content, and Collection Editors

## Goal

Implement the owner-editable brand/content half of the real configuration contract with reusable accessible controls and explicit section saves.

## Scope

Sections: `identity`, `institutions`, `theme`, `navigation`, `footer`, `contact`, `legal`, `localization`, `content`, `collections`, and `gapMaps`.

- Build reusable field, error, repeater, reorder and catalog-choice primitives.
- Render constraints/options from the generated contract and presentation registry.
- Save one section at a time with optimistic edit-version checking.
- Show structural validation without reproducing Evidence Library cross-field rules.

## Design

1. Each section is a keyed editor initialized from the queried draft snapshot. Do not mirror later Convex results into local state.
2. Scalar controls use native/uncontrolled form values where practical. Dynamic arrays use a local reducer whose state is owned only by that section editor.
3. Save is an explicit submit handler. It builds a section payload, validates structurally, calls one mutation with expected `editVersion`, and displays the returned version/conflict.
4. Generic primitives are presentation-only and use JSON Pointer metadata; section-specific assemblers own domain wording and compound rules.
5. Repeaters provide add/remove/reorder keyboard actions, deterministic focus movement and stable item keys.
6. Invalid prototype values are not preserved: `baseUrl` is origin-only, `logoStyles` is declarations-only, layout/catalog values come from the generated catalog, and gap maps require HTML URLs.
7. All visible copy is localized in every existing locale. Missing translations fail tests rather than falling back silently.

## TDD sequence

1. Red/green pure path-to-control and form-value coercion tests; commit.
2. Red/green generic scalar field behavior and accessible error linkage; commit.
3. Red/green dynamic-list add/remove/reorder/focus behavior; commit.
4. Red/green Identity/Institutions/Theme editors and section-save persistence; commit per section group.
5. Red/green Navigation/Footer/Contact/Legal/Localization/Content editors; commit per logical group.
6. Red/green Collections/Gap maps editors, including catalog/live-value boundaries.
7. Run axe/component suites, then refactor repeated assemblers.

## Files touched

- `components/evidence-libraries/configuration/{field,field-error,dynamic-list,catalog-select,section-save-status}.tsx`
- section editors under `components/evidence-libraries/configuration/sections/`
- `lib/evidence-libraries/configuration/{form-data,path-operations,section-codecs}.ts`
- `convex/evidenceLibraries/mutations.ts` only if section-save contract needs a planned adjustment
- component/pure/Convex tests
- `messages/{en-GB,en-US,fr,hi,ja,zh}.json`

## Migration stance

None unless the exact Plan 02 mutation contract is wrong. Any required schema deviation must update Plan 02 first and be committed before code changes.

## Test plan

```bash
npm test -- lib/evidence-libraries/configuration tests/components/evidence-libraries convex/evidenceLibraries
npx pm2 logs convex --lines 5 --nostream
npx pm2 logs next --lines 5 --nostream
```

Add axe coverage for representative scalar, repeater and invalid-section states.

## Deployability gate

This plan touches `components/` and may touch `convex/`:

- Convex: latest `✔ Convex functions ready!`, no newer `✖ Error`.
- Next: recent `✓ Compiled`/clean `✓ Ready`, no module/type/compile error.
- Recheck both gates after every relevant commit.

## Acceptance criteria

- All 11 scoped sections render from real contract/catalog metadata.
- Save/reload preserves each section and stale saves yield an actionable conflict.
- Every invalid control is connected through `aria-invalid` and `aria-describedby`.
- Repeaters are fully keyboard operable with predictable focus.
- No prototype-only value or fake secret is present.
- Locale completeness, component tests, axe and PM2 gates pass.

## Known pitfalls

- Do not build a universal JSON Schema form renderer; the product needs intentional UI.
- Do not assert CSS classes.
- Live collection/institution values are runtime data, not static catalog enums.
- Avoid unstable array-index keys.
- Do not call mutations from validation effects or watched state.
