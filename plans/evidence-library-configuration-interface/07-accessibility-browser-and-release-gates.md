# Plan 07 — Accessibility, Browser, and Release Gates

## Goal

Close the interface with full keyboard, accessibility, responsive, authenticated-browser, visual and deployment verification.

## Scope

- Audit and repair all editor states and 24 sections.
- Add complete axe/component/Playwright coverage.
- Verify the production build, the remote Convex deployment, the local Next.js app, and isolated Evidence Library activation.
- Remove placeholders, obsolete prototype assumptions and dead code.
- Record final verification evidence.

## Design

1. Every section heading is focusable after validation navigation; the summary is a live alert only when a user-triggered validation result changes.
2. Every invalid field has accessible name, `aria-invalid`, described error text and a stable section/path contract.
3. Repeaters preserve logical focus after add/remove/reorder and expose keyboard actions.
4. The rail works at desktop, tablet and mobile widths with reduced motion.
5. Loading, missing, forbidden, read-only, stale-draft conflict, offline/transient failure, rejected validation, publishing and rollback states all have explicit observable behavior.
6. Visual screenshots cover light/dark and desktop/mobile, but screenshot review never replaces behavioral assertions.

## TDD sequence

1. Red/green component axe matrix for representative control/state families.
2. Red/green keyboard/focus tests for rail, validation jump, repeaters, dialogs and conflict recovery.
3. Red/green Playwright owner/member/cross-user route matrix.
4. Red/green save/reload/conflict and all-section smoke.
5. Red/green validate/publish/idempotent replay/failure/rollback with isolated runtime.
6. Capture and review visual screenshots; fix source, then rerun behavioral suites.
7. Search for placeholder values, duplicate schema catalogs, forbidden effects, class-string assertions and dead components; delete them.
8. Run the final build, targeted suites, remote deployment checks, and browser readback.

## Files touched

- existing Plan 03–06 UI/backend files as defects require
- `tests/a11y/evidence-library-configuration.axe.test.tsx`
- `e2e/evidence-library-configuration.spec.ts`
- Playwright fixtures/helpers only where reused broadly
- final verification notes in this plan file

## Migration stance

None expected. Any schema correction must revise its owning earlier plan before implementation. No compatibility workaround is allowed during final QA.

## Test plan

```bash
npm test -- lib/evidence-libraries/configuration convex/evidenceLibraries tests/components/evidence-libraries tests/a11y/evidence-library-configuration.axe.test.tsx
npm run build
npx playwright test e2e/evidence-library-configuration.spec.ts --config=playwright.config.ts
npx convex function-spec | rg 'evidenceLibraries'
npm run convex:push
npm run dev:web
```

Run Playwright against the production build for final acceptance, not only the Turbopack dev server.

## Deployability gate

- Convex latest: `✔ Convex functions ready!`; no newer `✖ Error`.
- Next: recent clean compile/ready and HTTP 200 on the exact configuration route; no module/type/compile error.
- Deployed function spec includes exact validators.
- The Plan 06 receipt-and-health contract reports the exact activated revision and resolved-manifest digest; do not expect digest from today's revision-only health route.

## Acceptance criteria

- Zero axe violations without disabled structural rules.
- Full keyboard operation and deterministic focus recovery.
- Desktop/mobile and light/dark screenshots match OpenScholar design language.
- Owner, member and denied-user behavior is proven.
- Save/reload/conflict/validate/publish/replay/failure/rollback journeys pass.
- No secret appears in DOM, serialized query output, logs or screenshots.
- No forbidden application-state `useEffect`, manual schema copy, prototype fake value, dead code or class-string test remains.
- All build, browser, function-spec and runtime gates pass.

## Known pitfalls

- JSDOM cannot prove sticky positioning, scroll spy or responsive overflow.
- Dev-server success does not prove production-build behavior.
- Axe cannot replace keyboard and screen-reader semantics review.
- Historical log errors must be distinguished from the latest success line.
- Do not weaken tests to match implementation defects.
