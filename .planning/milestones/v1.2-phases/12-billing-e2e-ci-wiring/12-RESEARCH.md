# Phase 12: Billing E2E CI Wiring - Research

**Researched:** 2026-02-28
**Domain:** GitHub Actions CI configuration, Playwright CLI scripting, npm scripts
**Confidence:** HIGH

## Summary

Phase 12 is a pure CI wiring and npm-scripts task with zero new application code. All three success criteria map to simple, well-understood edits: adding one line to `package.json`, adding two env vars to three CI job env blocks, and adding one CI step to those same three jobs. The entire phase should reduce to a single plan (`12-01`) that executes all three changes.

The main research finding is that the `globalSetup` in `playwright.config.ts` calls `ensureDisposableClerkUser()`, which requires `E2E_CLERK_USER_EMAIL` and `E2E_CLERK_USER_PASSWORD`. These are NOT listed in the phase success criteria but WILL be needed by billing CI jobs for the Playwright invocation to succeed -- the global setup runs unconditionally for all projects. This is a gap that planning must address.

The billing E2E tests also require a running Next.js server (the `webServer` block in `playwright.config.ts`). The e2e-auth CI job handles this by letting Playwright spawn the server via `npm run build && npm run start`. The billing jobs will need the same pattern plus all required environment variables for the server to boot (Clerk URL vars, Convex URL, etc.).

**Primary recommendation:** Add the `test:billing:e2e` npm script, wire `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` into the three billing CI job env blocks, and add a Playwright E2E step after the Vitest step in each job. Also add `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`, and remaining server-required env vars so global setup and the Next.js dev server do not fail silently.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | `^1.58.2` (already installed) | E2E test runner | Already used in project; billing project already configured |
| GitHub Actions | N/A | CI orchestration | Already the project's CI platform |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `actions/setup-node@v4` | v4 | Node.js setup in CI | Already used in all existing CI jobs |
| `actions/upload-artifact@v4` | v4 | Artifact upload for test results | Already used in e2e-auth job; should be added to billing E2E step |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `playwright test --project=billing` | `playwright test e2e/billing/` | `--project=billing` is the correct flag since the config defines a named project; directory path would bypass project-level config (timeout=180s, workers=1, locale=en-US) |

**Installation:** None required. All dependencies already present.

## Architecture Patterns

### Current CI Job Structure (billing-live)

```
billing-live:
  env: [Convex, Stripe vars] ← Missing Clerk keys
  steps:
    - checkout
    - setup-node
    - validate secrets
    - install deps
    - Run billing preflight + required live regressions (Vitest)
    - Upload artifacts
                             ← Missing: install playwright, run E2E, upload E2E artifacts
```

### Target CI Job Structure (billing-live)

```
billing-live:
  env: [Convex, Stripe vars, + CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, ...]
  steps:
    - checkout
    - setup-node
    - validate secrets
    - install deps
    - Run billing preflight + required live regressions (Vitest)
    - Upload Vitest artifacts
    - Install Playwright browsers   ← New
    - Run billing E2E tests         ← New (npm run test:billing:e2e)
    - Upload E2E artifacts          ← New
```

### Pattern: npm script for Playwright project

```json
// package.json scripts section
"test:billing:e2e": "playwright test --project=billing"
```

This follows the same convention as the existing `"test:e2e:auth": "playwright test e2e/auth.spec.ts --config=playwright.config.ts"`. No `--config` flag is needed because `playwright.config.ts` is the default config.

### Pattern: Playwright browser install in CI

From the existing `e2e-auth` job in `ci.yml` (line 85):

```yaml
- name: Install Playwright browser
  run: npx playwright install --with-deps chromium
```

The billing E2E tests use the same chromium browser (no additional browsers needed). This step must be added to all three billing CI jobs.

### Pattern: E2E_BASE_URL for billing CI jobs

The `playwright.config.ts` reads `E2E_BASE_URL` (defaulting to `http://127.0.0.1:3000`). The `e2e-auth` job sets `E2E_BASE_URL: http://127.0.0.1:3000` explicitly. Billing jobs should do the same.

### Anti-Patterns to Avoid

- **Don't use `--project=default` for billing**: The `default` project explicitly ignores billing files (`testIgnore: "**/billing/**"`).
- **Don't omit the Playwright browser install step**: CI environments don't have Chromium pre-installed; the Vitest-only billing jobs don't currently need it, but the new E2E step does.
- **Don't add `--config=playwright.config.ts` to the npm script**: It's the default config location and adding it is redundant noise.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser install in CI | Custom curl/apt install | `npx playwright install --with-deps chromium` | Official Playwright CLI handles OS-specific deps |
| Project-scoped test run | Custom glob of billing spec files | `playwright test --project=billing` | Project config in `playwright.config.ts` applies correct timeout, workers, locale |

## Common Pitfalls

### Pitfall 1: globalSetup requires E2E_CLERK_USER_EMAIL and E2E_CLERK_USER_PASSWORD

**What goes wrong:** `npx playwright test --project=billing` triggers `globalSetup` (`e2e/global.setup.ts`), which calls `ensureDisposableClerkUser()`. This function calls `requireEnv("E2E_CLERK_USER_EMAIL")` and will throw if the variable is missing. The billing CI jobs currently do not set these vars.

**Why it happens:** `globalSetup` is defined at the config root level and runs for ALL Playwright invocations, regardless of which project is selected.

**How to avoid:** Add `E2E_CLERK_USER_EMAIL` and `E2E_CLERK_USER_PASSWORD` to the billing CI job env blocks (using `${{ secrets.E2E_CLERK_USER_EMAIL }}` and `${{ secrets.E2E_CLERK_USER_PASSWORD }}`). The billing fixture creates its OWN fresh users per test; the global setup user is only needed for `auth.spec.ts` but runs unconditionally.

**Alternative:** Modify `global.setup.ts` to make `ensureDisposableClerkUser()` conditional (e.g., skip if `E2E_CLERK_USER_EMAIL` is not set). This is a code change vs. a CI env change. Given Phase 12's scope is CI wiring only, adding the env vars to CI is simpler and safer.

**Warning signs:** CI failure at `globalSetup` step with message: `Missing required E2E environment variable: E2E_CLERK_USER_EMAIL`.

### Pitfall 2: Next.js server missing env vars at boot

**What goes wrong:** The Playwright `webServer` block runs `npm run build && npm run start -- --port 3000`. The billing test server needs `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, and `NEXT_PUBLIC_CONVEX_URL` to build and boot without errors. The billing CI jobs already have `NEXT_PUBLIC_CONVEX_URL` but are missing the Clerk URL vars.

**How to avoid:** Add `NEXT_PUBLIC_CLERK_SIGN_IN_URL` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` (static values `/sign-in` and `/sign-up`) to the billing CI job env blocks.

**Warning signs:** Playwright `webServer` step fails with Next.js build error about missing env vars, or the server boots but redirects all auth flows incorrectly.

### Pitfall 3: Artifact upload path mismatch

**What goes wrong:** Playwright outputs reports to `playwright-report/` and test results to `test-results/`. If the artifact upload path doesn't match, the upload step silently finds no files.

**How to avoid:** Use `path: playwright-report` and `if-no-files-found: ignore` (matching the `e2e-auth` job pattern).

### Pitfall 4: billing-live-extended and billing-nightly are separate jobs

**What goes wrong:** Only adding the E2E wiring to `billing-live` but not `billing-live-extended` (in `ci.yml`) or `billing-live-extended-nightly` (in `billing-nightly.yml`).

**How to avoid:** Apply identical env and step additions to all three billing CI job definitions across both workflow files.

## Code Examples

### npm script to add to package.json

```json
"test:billing:e2e": "playwright test --project=billing"
```

Place it after `"test:billing:extended:ci"` in the scripts block, following the billing test naming convention.

### Env vars to add to billing CI jobs

```yaml
CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
NEXT_PUBLIC_CLERK_SIGN_IN_URL: /sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL: /sign-up
E2E_CLERK_USER_EMAIL: ${{ secrets.E2E_CLERK_USER_EMAIL }}
E2E_CLERK_USER_PASSWORD: ${{ secrets.E2E_CLERK_USER_PASSWORD }}
E2E_BASE_URL: http://127.0.0.1:3000
```

The last four (`NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`, `E2E_BASE_URL`) are not in the phase success criteria but are required for the Playwright invocation to succeed.

### Steps to append to each billing CI job

```yaml
- name: Install Playwright browser
  run: npx playwright install --with-deps chromium

- name: Run billing E2E tests
  run: npm run test:billing:e2e

- name: Upload billing E2E report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: billing-e2e-report-${{ github.job }}
    path: playwright-report
    if-no-files-found: ignore
```

The artifact name uses `${{ github.job }}` to avoid name conflicts between the three billing jobs.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate playwright config per project | Named projects in single `playwright.config.ts` | Playwright v1.20+ | `--project=billing` targets isolated config without separate file |

## Open Questions

1. **Should billing E2E run on PRs or only on main pushes?**
   - What we know: `billing-live` runs on PRs (no `if:` condition); `billing-live-extended` only runs on `push` to main (has `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`). The new E2E step inherits the parent job's trigger.
   - What's unclear: Whether running billing E2E on every PR is desired -- it requires a live Convex+Stripe environment.
   - Recommendation: Follow the success criteria literally -- "A new CI step in billing jobs" means add to all three jobs as-is, matching their existing trigger conditions.

2. **Should global.setup.ts be made conditional for billing-only runs?**
   - What we know: `ensureDisposableClerkUser()` is only needed for `auth.spec.ts` (the `default` project). It runs even during `--project=billing`.
   - What's unclear: Whether the phase scope includes modifying `global.setup.ts`.
   - Recommendation: Add `E2E_CLERK_USER_EMAIL` and `E2E_CLERK_USER_PASSWORD` to billing CI jobs (simpler, no code change). If those secrets aren't available in the billing environment, modify `global.setup.ts` to skip the call when the env vars are absent.

3. **Does `billing-live` need `continue-on-error: true` for the E2E step?**
   - What we know: `billing-live-extended` has `continue-on-error: true` at the job level. `billing-live` does not.
   - What's unclear: Whether the E2E step should block or be advisory.
   - Recommendation: Default to blocking (no `continue-on-error`) for `billing-live` to match its existing behavior. The `billing-live-extended` job already has `continue-on-error: true` at the job level, so its E2E step is non-blocking by default.

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection:
  - `/Users/mcharrad/Documents/Github/openalex-count/.github/workflows/ci.yml` -- existing CI jobs, env blocks, and steps
  - `/Users/mcharrad/Documents/Github/openalex-count/.github/workflows/billing-nightly.yml` -- nightly job structure
  - `/Users/mcharrad/Documents/Github/openalex-count/playwright.config.ts` -- billing project definition, webServer config, globalSetup reference
  - `/Users/mcharrad/Documents/Github/openalex-count/e2e/global.setup.ts` -- `ensureDisposableClerkUser` env var requirements
  - `/Users/mcharrad/Documents/Github/openalex-count/e2e/billing/fixtures.ts` -- `CLERK_SECRET_KEY` requirement in billing fixture
  - `/Users/mcharrad/Documents/Github/openalex-count/package.json` -- existing npm scripts, missing `test:billing:e2e`

### Secondary (MEDIUM confidence)

- Phase 12 success criteria from `ROADMAP.md` -- canonical statement of what must be true

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Directly verified from codebase and existing patterns
- Architecture: HIGH - CI job structure verified from `ci.yml` and `billing-nightly.yml`; npm script pattern from `package.json`
- Pitfalls: HIGH - `globalSetup` env var requirements verified from `e2e/global.setup.ts` source

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable CI/Playwright config -- unlikely to change)
