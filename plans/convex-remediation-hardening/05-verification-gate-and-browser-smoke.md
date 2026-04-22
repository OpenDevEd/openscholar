# Plan 05 — Verification Gate And Browser Smoke

## Goal

Make the corrective work durable by adding a repeatable verification gate that catches the class of failure that escaped the first remediation.

## Scope

- Targeted verification script or documented command matrix for this surface.
- Playwright smoke coverage for the highest-signal page-level contracts.
- Typecheck and pm2-log checks folded into the execution checklist.
- Update local testing docs for this remediation slice if needed.

## Design

1. **Verification command**
   - Create one documented command sequence or helper script that runs:
     - targeted Vitest for plans 01-04,
     - relevant Playwright smoke,
     - `pnpm tsc --noEmit`,
     - optional pm2 log spot-check instructions.
2. **Browser smoke**
   - At minimum cover the library collection total/range contract.
   - Add one additional smoke if setup cost is justified and data fixtures already exist.
3. **Execution doctrine**
   - The remediation is not “done” until the gate is green.
   - If full repo typecheck is still blocked by out-of-scope issues, stop and write an explicit blocker note rather than silently accepting noise.

## TDD sequence

1. Add failing Playwright smoke(s) first where practical.
2. Add any missing npm script or verification helper.
3. Run the full gate red.
4. Fix remaining issues until the gate is green.

## Files touched

- `package.json`
- `playwright.config.ts` only if new project wiring is needed
- `e2e/**/*.spec.ts` for the new smoke
- Optional `scripts/` helper if a verification wrapper is justified
- Any README or local execution notes needed to keep the gate discoverable

## Migration stance

- None.
- This plan changes process, coverage, and local verification only.

## Test plan

- The new verification command itself
- All targeted Vitest suites from plans 01-04
- New Playwright smoke(s)
- `pnpm tsc --noEmit`
- `pm2 logs convex --lines 120 --nostream` spot-check after the final green run

## Acceptance criteria

- There is one obvious verification path for this remediation slice.
- Library count/range behavior is covered in a real browser.
- Typecheck is part of the gate, not an optional follow-up.
- Any remaining blocker is documented explicitly instead of being buried under green unit tests.

## Known pitfalls

- Do not bloat the Playwright surface; keep it to high-signal smokes.
- Do not hide repo type noise behind a narrower command without documenting the tradeoff.
- The gate must be easy enough to run that future work actually uses it.
